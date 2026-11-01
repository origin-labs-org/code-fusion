import {
  isSameWebRemoteControlTarget,
  isReusableWebRemoteControlSession,
  getStatusLabel,
  getStatusDetail,
  getStatusDotClassName,
  getWebRemoteControlStatusTagLabel,
  isSameWebRemoteControlStatus,
  getFailureDescription,
} from "@/web-remote-control/domain/presentation.js";
import { memo, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import type { BotProvider, WebRemoteControlStatus } from "@origin-ai/cf-shared";
import {
  Bot as BotIcon,
  CopyIcon,
  LoaderCircle,
  MonitorSmartphone,
  Smartphone,
  Unplug,
  XIcon,
} from "lucide-react";
import { BotsDialog } from "@/BotsDialog.js";
import { ProviderIcon } from "@/BotsDialog/shared.js";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { toast } from "@/components/ui/toast.js";
import { useCfStore } from "@/store/StoreProvider.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useOAuth } from "@/hooks/useOAuth.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { getBotProviderRegionTagLabelId } from "@/botsUi.js";

type RemoteControlBotProvider = Extract<BotProvider, "weixin" | "feishu" | "lark" | "telegram">;

const REMOTE_CONTROL_BOT_ENTRIES: Array<{
  provider: RemoteControlBotProvider;
}> = [
  { provider: "weixin" },
  { provider: "feishu" },
  { provider: "lark" },
  { provider: "telegram" },
];

function WebRemoteControlLoginButton({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const { intl } = useCfIntl();
  const hasUser = useCfStore((state) => Boolean(state.user));
  const requestLoginEntry = useCfStore((state) => state.requestLoginEntry);
  const { activeProvider, loadingProviders, refreshProviders } = useOAuth();

  return (
    <Button
      type="button"
      data-testid="web-remote-control-login"
      className="enabled:cursor-pointer"
      disabled={loadingProviders}
      onClick={() => {
        if (hasUser && !activeProvider) {
          toast(intl.formatMessage({ id: "login.oauth.loginFailure" }));
          void refreshProviders();
          return;
        }
        onOpenChange(false);
        requestLoginEntry(activeProvider ?? undefined, "app-login");
      }}
    >
      {intl.formatMessage({ id: "webRemoteControl.authRequired.login" })}
    </Button>
  );
}

export const WebRemoteControlDialog = memo(function WebRemoteControlDialogComponent({
  open,
  onOpenChange,
  workspacePath,
  workspaceIdentity,
  remoteSessionId,
  initialTaskId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  initialTaskId?: string;
}) {
  const platform = usePlatform();
  const { intl } = useCfIntl();
  const [status, setStatus] = useState<WebRemoteControlStatus>({
    status: "idle",
  });
  const [loading, setLoading] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [botsDialogOpen, setBotsDialogOpen] = useState(false);
  const [botEntryProvider, setBotEntryProvider] = useState<RemoteControlBotProvider | null>(null);

  const statusLabel = useMemo(
    () => getStatusLabel(status, intl.formatMessage),
    [intl.formatMessage, status],
  );
  const statusDetail = useMemo(
    () => getStatusDetail(status, intl.formatMessage),
    [intl.formatMessage, status],
  );
  const failureDescription = useMemo(
    () => getFailureDescription(status.failure, intl.formatMessage),
    [intl.formatMessage, status.failure],
  );
  const statusTagLabel = useMemo(
    () => getWebRemoteControlStatusTagLabel(status, intl.formatMessage),
    [intl.formatMessage, status],
  );
  const statusDotClassName = getStatusDotClassName(status);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;

    const syncWebRemoteControlStatus = async () => {
      setLoading(true);

      try {
        const currentStatus = await platform.getWebRemoteControlStatus();
        let nextStatus: WebRemoteControlStatus;
        if (
          currentStatus.status === "auth-required" ||
          isSameWebRemoteControlTarget(
            currentStatus,
            workspacePath,
            workspaceIdentity,
            remoteSessionId,
          ) ||
          isReusableWebRemoteControlSession(currentStatus)
        ) {
          nextStatus = currentStatus;
        } else {
          const startResult = await platform.startWebRemoteControl({
            workspacePath,
            workspaceIdentity,
            remoteSessionId,
            initialTaskId,
          });
          nextStatus = startResult.status === "cancelled" ? { status: "idle" } : startResult;
        }

        if (!cancelled) {
          setStatus(nextStatus);
          logger.info("[WebRemoteControlDialog] Web remote control status synchronized", {
            workspacePath,
            workspaceIdentity: workspaceIdentity ?? "none",
            remoteSessionId: remoteSessionId ?? "none",
            initialTaskId: initialTaskId ?? "none",
            status: nextStatus.status,
            sessionId: nextStatus.sessionId ?? "none",
          });
        }
      } catch (error) {
        const currentStatus = await platform.getWebRemoteControlStatus().catch(() => null);
        if (currentStatus?.status === "auth-required") {
          if (!cancelled) setStatus(currentStatus);
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        if (!cancelled) {
          setStatus({
            status: "error",
            workspacePath,
            remoteSessionId,
            error: message,
          });
          toast(intl.formatMessage({ id: "webRemoteControl.startFailed" }, { error: message }));
        }
        logger.error("[WebRemoteControlDialog] 启动 Web 远程控制失败", {
          workspacePath,
          workspaceIdentity: workspaceIdentity ?? "none",
          remoteSessionId: remoteSessionId ?? "none",
          initialTaskId: initialTaskId ?? "none",
          error: message,
        });
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void syncWebRemoteControlStatus();

    return () => {
      cancelled = true;
    };
  }, [intl, open, platform, remoteSessionId, workspaceIdentity, workspacePath, initialTaskId]);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;

    const pollWebRemoteControlStatus = async () => {
      try {
        const nextStatus = await platform.getWebRemoteControlStatus();
        if (cancelled) {
          return;
        }

        const shouldApplyStatus =
          isSameWebRemoteControlTarget(
            nextStatus,
            workspacePath,
            workspaceIdentity,
            remoteSessionId,
          ) ||
          isReusableWebRemoteControlSession(nextStatus) ||
          nextStatus.status === "auth-required" ||
          nextStatus.status === "idle" ||
          nextStatus.status === "error";
        if (!shouldApplyStatus) {
          return;
        }

        setStatus((currentStatus) =>
          isSameWebRemoteControlStatus(currentStatus, nextStatus) ? currentStatus : nextStatus,
        );
      } catch {
      }
    };

    const intervalId = window.setInterval(() => {
      void pollWebRemoteControlStatus();
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [open, platform, remoteSessionId, workspaceIdentity, workspacePath]);

  useEffect(() => {
    if (!status.qrUrl) {
      setQrDataUrl(null);
      return;
    }

    let cancelled = false;
    setQrDataUrl(null);

    void QRCode.toDataURL(status.qrUrl, {
      margin: 1,
      width: 320,
    })
      .then((dataUrl: string) => {
        if (!cancelled) {
          setQrDataUrl(dataUrl);
        }
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        logger.error("[WebRemoteControlDialog] 生成二维码失败", message);
      });

    return () => {
      cancelled = true;
    };
  }, [status.qrUrl]);

  const handleCopyLink = async () => {
    if (!status.connectUrl) {
      return;
    }

    try {
      await navigator.clipboard.writeText(status.connectUrl);
      toast(intl.formatMessage({ id: "webRemoteControl.copyLink.copied" }));
      logger.info("[WebRemoteControlDialog] 已复制 Web 远程控制链接", {
        workspacePath,
        remoteSessionId: remoteSessionId ?? "none",
        sessionId: status.sessionId ?? "none",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast(intl.formatMessage({ id: "webRemoteControl.copyLinkFailed" }, { error: message }));
      logger.error("[WebRemoteControlDialog] 复制 Web 远程控制链接失败", message);
    }
  };

  const handleStop = async () => {
    setLoading(true);
    try {
      await platform.stopWebRemoteControl();
      setStatus({ status: "idle" });
      onOpenChange(false);
      toast(intl.formatMessage({ id: "webRemoteControl.stopSuccess" }));
      logger.info("[WebRemoteControlDialog] Web remote control turned off", {
        workspacePath,
        remoteSessionId: remoteSessionId ?? "none",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast(intl.formatMessage({ id: "webRemoteControl.stopFailed" }, { error: message }));
      logger.error("[WebRemoteControlDialog] Failed to turn off Web remote control", message);
    } finally {
      setLoading(false);
    }
  };

  const handleDialogOpenChange = (nextOpen: boolean) => {
    logger.info("[WebRemoteControlDialog] Dialog visibility state changed", {
      workspacePath,
      remoteSessionId: remoteSessionId ?? "none",
      nextOpen,
    });
    onOpenChange(nextOpen);
  };

  const handleDismiss = () => {
    logger.info("[WebRemoteControlDialog] 用户点击右上角关闭按钮", {
      workspacePath,
      remoteSessionId: remoteSessionId ?? "none",
      sessionId: status.sessionId ?? "none",
      status: status.status,
    });
    handleDialogOpenChange(false);
  };

  const handleOpenBotEntry = (provider: RemoteControlBotProvider) => {
    setBotEntryProvider(provider);
    setBotsDialogOpen(true);
    logger.info("[WebRemoteControlDialog] Open Bot Channel configuration portal", {
      workspacePath,
      workspaceIdentity: workspaceIdentity ?? "none",
      provider,
    });
  };

  const handleOpenBotsDialog = () => {
    setBotEntryProvider(null);
    setBotsDialogOpen(true);
    logger.info("[WebRemoteControlDialog] Open Bots general configuration portal", {
      workspacePath,
      workspaceIdentity: workspaceIdentity ?? "none",
    });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleDialogOpenChange}>
        <DialogContent
          showCloseButton={false}
          className="max-h-[calc(100vh-6rem)] max-w-4xl gap-0 overflow-hidden rounded-2xl p-0"
        >
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="absolute top-2 right-2 enabled:cursor-pointer [app-region:no-drag]"
            onClick={handleDismiss}
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </Button>
          <div
            data-testid="web-remote-control-dialog-scroll"
            className="max-h-[calc(100vh-6rem)] min-h-0 overflow-y-auto p-5"
          >
            <DialogHeader className="space-y-2 pr-8">
              <div className="flex items-center gap-2">
                <div className="flex size-10 items-center justify-center rounded-lg border border-border bg-surface text-primary">
                  <MonitorSmartphone className="size-5" />
                </div>
                <div className="space-y-1">
                  <DialogTitle>{intl.formatMessage({ id: "webRemoteControl.title" })}</DialogTitle>
                  <DialogDescription>
                    {intl.formatMessage({ id: "webRemoteControl.description" })}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div
              data-testid="web-remote-control-main-grid"
              className="mt-5 grid gap-4 md:grid-cols-[minmax(0,1.45fr)_minmax(300px,1fr)]"
            >
              <section
                data-testid="web-remote-control-scan-card"
                className="flex min-h-[360px] flex-col rounded-xl border border-border bg-card p-4"
              >
                {status.status === "auth-required" ? (
                  <div
                    data-testid="web-remote-control-auth-required"
                    className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-6 text-center"
                  >
                    <MonitorSmartphone className="size-8 text-foreground-subtle" />
                    <div className="space-y-2">
                      <h3 className="text-ui-base font-medium text-foreground">
                        {intl.formatMessage({ id: "webRemoteControl.authRequired.title" })}
                      </h3>
                      <p className="text-ui-base/relaxed text-foreground-subtle">
                        {intl.formatMessage({ id: "webRemoteControl.authRequired.description" })}
                      </p>
                    </div>
                    <WebRemoteControlLoginButton onOpenChange={onOpenChange} />
                  </div>
                ) : (
                  <>
                    <div className="mb-4 flex items-start gap-2">
                      <Smartphone className="mt-0.5 size-4 shrink-0 text-foreground-subtle" />
                      <div className="min-w-0 space-y-1">
                        <div className="text-ui-base font-medium text-foreground">
                          {intl.formatMessage({
                            id: "webRemoteControl.mobileQr.title",
                          })}
                        </div>
                        <p className="text-ui-base/relaxed text-foreground-subtle">
                          {intl.formatMessage({
                            id: "webRemoteControl.mobileQr.description",
                          })}
                        </p>
                      </div>
                    </div>
                    <div
                      data-testid="web-remote-control-connection-card"
                      className="mb-3 rounded-lg bg-surface px-3 py-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex min-w-0 items-center gap-2">
                            <div className="text-ui-base font-medium text-foreground">
                              {statusLabel}
                            </div>
                            <div className="flex min-w-0 items-center gap-1.5 rounded-full bg-card px-2 py-0.5 text-ui-xs font-medium text-foreground-subtle">
                              <span
                                className={`size-1.5 shrink-0 rounded-full ${statusDotClassName}`}
                              />
                              <span className="truncate">{statusTagLabel}</span>
                            </div>
                          </div>
                          <div className="text-ui-base/relaxed text-foreground-subtle">
                            {statusDetail}
                          </div>
                        </div>
                        {loading ? (
                          <LoaderCircle className="size-4 animate-spin text-foreground-subtle" />
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            size="default"
                            className="shrink-0 gap-2 enabled:cursor-pointer"
                            onClick={() => void handleStop()}
                            disabled={status.status === "idle"}
                          >
                            <Unplug className="size-3.5" />
                            {intl.formatMessage({ id: "webRemoteControl.stop" })}
                          </Button>
                        )}
                      </div>
                      {failureDescription ? (
                        <div className="mt-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-ui-base/relaxed text-destructive">
                          <p>{failureDescription}</p>
                          {status.failure?.message &&
                          status.failure.message !== failureDescription ? (
                            <p className="mt-1 text-ui-xs/relaxed opacity-80">
                              {status.failure.message}
                            </p>
                          ) : null}
                        </div>
                      ) : status.error ? (
                        <p className="mt-3 text-ui-base/relaxed text-destructive">{status.error}</p>
                      ) : null}
                      <div
                        data-testid="web-remote-control-copy-link-row"
                        className="mt-3 flex min-h-10 flex-wrap items-center gap-3 border-t border-border pt-3"
                      >
                        <div className="min-w-48 flex-1 text-ui-base/relaxed text-foreground-subtle">
                          {intl.formatMessage({
                            id: "webRemoteControl.copyLink.description",
                          })}
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="default"
                          className="shrink-0 gap-2 enabled:cursor-pointer"
                          onClick={() => void handleCopyLink()}
                          disabled={!status.connectUrl || loading}
                        >
                          <CopyIcon className="size-3.5" />
                          {intl.formatMessage({ id: "webRemoteControl.copyLink" })}
                        </Button>
                      </div>
                    </div>
                    <div className="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-dashed border-border bg-background-alt p-4">
                      {qrDataUrl ? (
                        <img
                          src={qrDataUrl}
                          alt={intl.formatMessage({ id: "webRemoteControl.qrAlt" })}
                          className="size-64 max-w-full rounded-lg bg-white p-3"
                        />
                      ) : (
                        <div className="flex flex-col items-center gap-3 text-center text-ui-base text-foreground-subtle">
                          <LoaderCircle className="size-5 animate-spin" />
                          <span>
                            {intl.formatMessage({
                              id: "webRemoteControl.generating",
                            })}
                          </span>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </section>

              <section className="flex min-h-[360px] flex-col rounded-xl border border-border bg-card p-4">
                <div className="mb-4 flex items-start gap-2">
                  <BotIcon className="mt-0.5 size-4 shrink-0 text-foreground-subtle" />
                  <div className="min-w-0 space-y-1">
                    <div className="text-ui-base font-medium text-foreground">
                      {intl.formatMessage({
                        id: "webRemoteControl.botChannel.title",
                      })}
                    </div>
                    <p className="text-ui-base/relaxed text-foreground-subtle">
                      {intl.formatMessage({
                        id: "webRemoteControl.botChannel.description",
                      })}
                    </p>
                  </div>
                </div>
                <div className="grid min-h-0 flex-1 gap-3">
                  {REMOTE_CONTROL_BOT_ENTRIES.map((entry) => {
                    const regionTagLabelId = getBotProviderRegionTagLabelId(entry.provider);

                    return (
                      <button
                        key={entry.provider}
                        type="button"
                        className="flex min-h-0 cursor-pointer items-start gap-3 rounded-lg border border-transparent bg-surface px-3 py-3 text-left transition-colors hover:border-input-border-focused hover:bg-surface-hover focus-visible:border-input-border-focused"
                        onClick={() => handleOpenBotEntry(entry.provider)}
                      >
                        {}
                        <ProviderIcon provider={entry.provider} className="size-12 shrink-0" />
                        <span className="min-w-0 flex-1 space-y-1">
                          <span className="flex min-w-0 items-center gap-1.5 text-ui-base font-medium text-foreground">
                            <span className="min-w-0 truncate">
                              {intl.formatMessage({
                                id: `webRemoteControl.botChannel.${entry.provider}.title`,
                              })}
                            </span>
                            {regionTagLabelId ? (
                              <span className="inline-flex h-5 shrink-0 items-center rounded-full border border-border px-2 text-ui-xs font-medium leading-none text-foreground-subtle">
                                {intl.formatMessage({ id: regionTagLabelId })}
                              </span>
                            ) : null}
                          </span>
                          <span className="block text-ui-base/relaxed text-foreground-subtle">
                            {intl.formatMessage({
                              id: `webRemoteControl.botChannel.${entry.provider}.description`,
                            })}
                          </span>
                          <span className="block text-ui-base font-medium text-primary">
                            {intl.formatMessage({
                              id: "webRemoteControl.botChannel.configure",
                            })}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    data-testid="web-remote-control-open-bots"
                    className="w-full justify-center gap-2 enabled:cursor-pointer"
                    onClick={handleOpenBotsDialog}
                  >
                    <BotIcon className="size-3.5" />
                    {intl.formatMessage({
                      id: "webRemoteControl.botChannel.manageBots",
                    })}
                  </Button>
                </div>
              </section>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <BotsDialog
        open={botsDialogOpen}
        onOpenChange={setBotsDialogOpen}
        entryProvider={botEntryProvider}
      />
    </>
  );
});
