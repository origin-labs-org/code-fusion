import { useState } from "react";
import { Smartphone } from "lucide-react";
import type { WebRemoteControlStatus } from "@origin-ai/cf-shared";
import {
  buildWebRemoteControlEntryViewTelemetry,
  parseRemoteWorkspaceIdentity,
} from "@origin-ai/cf-shared";
import { Button } from "@/components/ui/button.js";
import { cn } from "@/components/lib/utils.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { useResolvedRemoteWorkspaceSessionId } from "@/hooks/useResolvedRemoteWorkspaceSessionId.js";
import { useOptionalPlatform } from "@/hooks/usePlatform.js";
import { useWebRemoteControlStatus } from "@/hooks/useWebRemoteControlStatus.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { reportAppTelemetryEvent } from "@/lib/appTelemetry.js";
import { WebRemoteControlDialog } from "@/web-remote-control/index.js";
import { useWebRemoteControlFeatureEnabled } from "@/WebRemoteControlFeatureProvider.js";

type FormatMessage = ReturnType<typeof useCfIntl>["intl"]["formatMessage"];

export function getWebRemoteControlTriggerPresentation(
  status: Pick<WebRemoteControlStatus, "status" | "mobileConnected">,
  formatMessage: FormatMessage,
): { iconClassName: string; tooltip: string } {
  if (status.status === "error") {
    return {
      iconClassName: "text-destructive",
      tooltip: formatMessage({ id: "webRemoteControl.triggerStatus.error" }),
    };
  }

  if (status.status === "active") {
    return {
      iconClassName: "text-success",
      tooltip: formatMessage({
        id: "webRemoteControl.triggerStatus.connected",
      }),
    };
  }

  if (status.status === "starting") {
    return {
      iconClassName: "text-warning",
      tooltip: formatMessage({
        id: "webRemoteControl.triggerStatus.starting",
      }),
    };
  }

  if (status.status === "connecting") {
    return {
      iconClassName: "text-warning",
      tooltip: formatMessage({
        id: "webRemoteControl.triggerStatus.connecting",
      }),
    };
  }

  if (status.status === "running") {
    return {
      iconClassName: "text-warning",
      tooltip: formatMessage({ id: "webRemoteControl.triggerStatus.waiting" }),
    };
  }

  return {
    iconClassName: "text-foreground-subtle",
    tooltip: formatMessage({ id: "webRemoteControl.triggerStatus.idle" }),
  };
}

export function WorkspaceWebRemoteControlTrigger({
  workspacePath,
  workspaceIdentity,
  remoteSessionId,
  initialTaskId,
  compact = false,
  className,
}: {
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  initialTaskId?: string;
  compact?: boolean;
  className?: string;
}) {
  const enabled = useWebRemoteControlFeatureEnabled();

  if (!enabled) {
    return null;
  }

  return (
    <WorkspaceWebRemoteControlTriggerContent
      workspacePath={workspacePath}
      workspaceIdentity={workspaceIdentity}
      remoteSessionId={remoteSessionId}
      initialTaskId={initialTaskId}
      compact={compact}
      className={className}
    />
  );
}

function WorkspaceWebRemoteControlTriggerContent({
  workspacePath,
  workspaceIdentity,
  remoteSessionId,
  initialTaskId,
  compact = false,
  className,
}: {
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  initialTaskId?: string;
  compact?: boolean;
  className?: string;
}) {
  const { intl } = useCfIntl();
  const platform = useOptionalPlatform();
  const mappedRemoteSessionId = useResolvedRemoteWorkspaceSessionId(
    workspacePath,
    remoteSessionId,
    workspaceIdentity,
  );
  const currentRemoteSessionId = mappedRemoteSessionId ?? undefined;
  const [webRemoteControlOpen, setWebRemoteControlOpen] = useState(false);
  const remoteControlStatus = useWebRemoteControlStatus();
  const triggerPresentation = getWebRemoteControlTriggerPresentation(
    remoteControlStatus,
    intl.formatMessage,
  );

  return (
    <>
      <ControlHintTooltip
        title={intl.formatMessage({ id: "webRemoteControl.trigger" })}
        description={triggerPresentation.tooltip}
        side="top"
        align="center"
        triggerClassName={compact ? undefined : "w-full"}
      >
        <Button
          variant="ghost"
          onClick={() => {
            if (platform) {
              void reportAppTelemetryEvent(
                platform,
                buildWebRemoteControlEntryViewTelemetry({
                  workspaceKind:
                    workspaceIdentity?.trim() || currentRemoteSessionId ? "remote" : "local",
                  remoteKind: workspaceIdentity
                    ? parseRemoteWorkspaceIdentity(workspaceIdentity)?.kind
                    : undefined,
                }),
                "web-remote-control-entry",
              );
            }
            logger.info("[WorkspaceWebRemoteControlTrigger] 打开 Web 远程控制弹层", {
              workspacePath,
              workspaceIdentity: workspaceIdentity ?? "none",
              remoteSessionId: currentRemoteSessionId ?? "none",
              initialTaskId: initialTaskId ?? "none",
            });
            setWebRemoteControlOpen(true);
          }}
          size={compact ? "icon-lg" : "lg"}
          aria-label={intl.formatMessage({ id: "webRemoteControl.trigger" })}
          className={cn(
            compact
              ? "text-foreground hover:bg-surface-hover hover:text-foreground"
              : "w-full justify-start gap-2 text-foreground hover:bg-surface-hover hover:text-foreground",
            className,
          )}
        >
          {}
          <Smartphone className={cn("size-4", triggerPresentation.iconClassName)} />
          {compact ? (
            <span className="sr-only">
              {intl.formatMessage({ id: "webRemoteControl.trigger" })}
            </span>
          ) : (
            intl.formatMessage({ id: "webRemoteControl.trigger" })
          )}
        </Button>
      </ControlHintTooltip>
      <WebRemoteControlDialog
        open={webRemoteControlOpen}
        onOpenChange={setWebRemoteControlOpen}
        workspacePath={workspacePath}
        workspaceIdentity={workspaceIdentity}
        remoteSessionId={currentRemoteSessionId}
        initialTaskId={initialTaskId}
      />
    </>
  );
}
