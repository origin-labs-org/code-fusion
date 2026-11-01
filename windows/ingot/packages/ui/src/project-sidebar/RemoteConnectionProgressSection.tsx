import { useEffect, useState } from "react";
import { Check, Copy, LoaderCircle } from "lucide-react";
import { buildRemoteHostWorkspaceIdentity, parseRemoteWorkspaceIdentity } from "@origin-ai/cf-shared";
import type { RemoteProjectHost } from "@/project-sidebar/contract.js";
import { cn } from "@/components/lib/utils.js";
import { toast } from "@/components/ui/toast.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { useBaseWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { useRemoteDevicePresentationInput } from "@/hooks/useSourceServerStatuses.js";
import { useSourceServerOperationLogs } from "@/hooks/useSourceServerOperationLogs.js";
import {
  classifyRemoteConnectionError,
  type RemoteConnectionStatus,
} from "@/lib/remoteConnectionPresentation.js";
import { resolveRemoteOperationProgress } from "@/remote-connection/RemoteConnectionConnectingStep.js";

function sourceServerIdForHost(host: RemoteProjectHost): string | undefined {
  if (host.target?.kind === "server") return undefined;
  return parseRemoteWorkspaceIdentity(buildRemoteHostWorkspaceIdentity(host.id, "/"))
    ?.sourceServerId;
}

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

export function RemoteConnectionProgressSection({
  host,
  status,
  error,
}: {
  host: RemoteProjectHost;
  status: RemoteConnectionStatus;
  error?: string;
}) {
  const { intl } = useCfIntl();
  const management = useBaseWorkspaceServices().sourceServerManagementService;
  const sourceServerId = sourceServerIdForHost(host);
  const device = useRemoteDevicePresentationInput(sourceServerId);
  const connecting = status === "connecting" && sourceServerId !== undefined;
  const profileId = connecting ? device?.profileId : undefined;
  const { logsByProfileId } = useSourceServerOperationLogs(
    management,
    profileId ? [profileId] : [],
  );
  const now = useNow(connecting);
  const [copiedError, setCopiedError] = useState<string>();
  const msg = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id }, values);

  if (connecting) {
    const progress = resolveRemoteOperationProgress(
      profileId ? (logsByProfileId[profileId] ?? []) : [],
    );
    const seconds =
      progress.startedAt === undefined
        ? undefined
        : Math.max(0, Math.floor((now - progress.startedAt) / 1000));
    const meta = [
      msg("remote.progress.step", { current: progress.index + 1, total: progress.total }),
      ...(seconds === undefined
        ? []
        : [
            seconds < 60
              ? msg("remote.progress.elapsedSeconds", { seconds })
              : msg("remote.progress.elapsedMinutesSeconds", {
                  minutes: Math.floor(seconds / 60),
                  seconds: seconds % 60,
                }),
          ]),
      ...(device?.recoveryAttempt
        ? [
            msg("workspaceSidebar.recoveringAutomaticShort", {
              attempt: device.recoveryAttempt,
              limit: device.recoveryLimit ?? 3,
            }),
          ]
        : []),
    ];
    return (
      <div
        data-testid="remote-connection-progress"
        className="mt-3 rounded-lg bg-progress-surface px-2.5 py-2"
      >
        <div className="flex items-center gap-2 font-medium text-progress-surface-foreground">
          <LoaderCircle
            aria-hidden="true"
            className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none"
          />
          <span className="min-w-0 break-words">
            {msg(progress.titleId)}
            {progress.percent === undefined ? null : ` ${progress.percent}%`}
          </span>
        </div>
        <div className="mt-2 flex gap-1" aria-hidden="true">
          {Array.from({ length: progress.total }, (_, index) => {
            const state =
              index < progress.index ? "complete" : index === progress.index ? "active" : "pending";
            return (
              <div
                key={index}
                data-progress-segment={state}
                className="h-1 flex-1 overflow-hidden rounded-full bg-foreground/10"
              >
                <div
                  className={cn(
                    "h-full rounded-full bg-progress-surface-foreground transition-[width] duration-200",
                    state === "active" &&
                      progress.percent === undefined &&
                      "animate-pulse motion-reduce:animate-none",
                  )}
                  style={{
                    width:
                      state === "complete"
                        ? "100%"
                        : state === "active"
                          ? `${progress.percent ?? 100}%`
                          : "0%",
                  }}
                />
              </div>
            );
          })}
        </div>
        <div className="mt-1.5 break-words text-remote-foreground-muted">{meta.join(" · ")}</div>
      </div>
    );
  }

  if (!error || (status !== "failed" && status !== "offline")) return null;
  const reason = classifyRemoteConnectionError({
    errorCode: device?.errorCode,
    error,
    target: host.target ?? undefined,
  });
  return (
    <div
      data-testid="remote-connection-failure"
      className="mt-3 rounded-lg bg-destructive-surface px-2.5 py-2 text-destructive-surface-foreground"
    >
      <div className="break-words font-medium">{msg(reason.titleId, reason.values)}</div>
      <div className="mt-0.5 break-words">{msg(reason.reasonId, reason.values)}</div>
      <button
        type="button"
        data-testid="remote-connection-copy-error"
        className="mt-1.5 inline-flex items-center gap-1 hover:underline"
        onClick={() => {
          void navigator.clipboard
            .writeText(error)
            .then(() => setCopiedError(error))
            .catch((cause) => {
              logger.warn("[project-sidebar] 复制连接错误失败", cause);
              toast(String(cause));
            });
        }}
      >
        {copiedError === error ? (
          <Check aria-hidden="true" className="size-3.5" />
        ) : (
          <Copy aria-hidden="true" className="size-3.5" />
        )}
        {msg(copiedError === error ? "remote.progress.copied" : "remote.progress.copyError")}
      </button>
    </div>
  );
}
