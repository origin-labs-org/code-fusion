import { memo, useCallback, useState } from "react";
import {
  TID_V4_WORKSPACE_HOOK_PENDING_BANNER,
  TID_V4_WORKSPACE_HOOK_PENDING_DISMISS,
  TID_V4_WORKSPACE_HOOK_PENDING_REVIEW,
} from "@origin-ai/cf-shared/test-ids";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { setPendingSettingsSectionIntent } from "@/lib/settingsNavigation.js";
import { logger } from "@/logger.js";
import { runUserAction } from "@/lib/userActionTelemetry.js";
import { useOptionalTabStore } from "@/store/TabStoreProvider.js";
import {
  findWorkspaceHookCommandBinding,
  useWorkspaceHookReviewStore,
  type WorkspaceHookCommandBinding,
} from "@/store/workspaceHookReviewStore.js";
import { sendWorkspaceHookCommand } from "@/settings/workspaceHookReviewCommands.js";

class WorkspaceHookPendingDismissStore {
  private dismissed = new Set<string>();

  
  dismiss(sessionId: string, bundleDigest: string): void {
    this.dismissed.add(this.key(sessionId, bundleDigest));
  }

  
  isDismissed(sessionId: string, bundleDigest: string): boolean {
    return this.dismissed.has(this.key(sessionId, bundleDigest));
  }

  
  clear(): void {
    this.dismissed.clear();
  }

  private key(sessionId: string, bundleDigest: string): string {
    return `${sessionId}:${bundleDigest}`;
  }
}

export const workspaceHookPendingDismissStore = new WorkspaceHookPendingDismissStore();

export interface WorkspaceHookAdmissionInfo {
  pendingCount: number;
  bundleDigest: string;
  workspaceIdentity?: string;
}

export interface WorkspaceHookPendingBannerProps {
  sessionId: string;
  workspacePath: string;
  workspaceIdentity?: string;
  admission: WorkspaceHookAdmissionInfo | null;
}

export const WorkspaceHookPendingBanner = memo(function WorkspaceHookPendingBanner({
  sessionId,
  workspacePath,
  workspaceIdentity,
  admission,
}: WorkspaceHookPendingBannerProps) {
  const { intl } = useCfIntl();
  const openSettingsTab = useOptionalTabStore((state) => state.openSettingsTab);
  const commandBindings = useWorkspaceHookReviewStore((state) => state.commandBindings);
  const [, setDismissRevision] = useState(0);

  const handleReview = useCallback(() => {
    setPendingSettingsSectionIntent("hooks");
    openSettingsTab?.();

    const binding = findWorkspaceHookCommandBinding(
      commandBindings,
      workspacePath,
      workspaceIdentity,
    );
    if (binding && admission) {
      const payload = {
        sessionId,
        workspaceIdentity: admission.workspaceIdentity ?? workspaceIdentity ?? workspacePath,
        bundleDigest: admission.bundleDigest,
      };
      void sendWorkspaceHookCommand(
        binding as Pick<WorkspaceHookCommandBinding, "sendCommand" | "onCommandSettled">,
        sessionId,
        "requestWorkspaceHookReview",
        payload,
      ).catch((error) => {
        logger.warn("[workspace-hook-pending] requestWorkspaceHookReview 发送失败", {
          sessionId,
          bundleDigest: admission.bundleDigest,
          error,
        });
      });
    }
  }, [
    admission,
    commandBindings,
    openSettingsTab,
    sessionId,
    workspaceIdentity,
    workspacePath,
  ]);

  const handleDismiss = useCallback(() => {
    if (admission) {
      runUserAction({
        input: { featureId: "conversation.blocking.hook", action: "dismiss", trigger: "button" },
        operation: () => {
          workspaceHookPendingDismissStore.dismiss(sessionId, admission.bundleDigest);
          setDismissRevision((revision) => revision + 1);
        },
        completed: { resultSource: "local_commit" },
        failureStage: "hook_dismiss",
      });
    }
  }, [admission, sessionId]);

  if (!admission || admission.pendingCount <= 0) {
    return null;
  }

  if (workspaceHookPendingDismissStore.isDismissed(sessionId, admission.bundleDigest)) {
    return null;
  }

  return (
    <div
      role="status"
      data-testid={TID_V4_WORKSPACE_HOOK_PENDING_BANNER}
      className="mb-3 flex w-full shrink-0 flex-wrap items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-ui-base text-foreground backdrop-blur-md"
    >
      <p className="min-w-0 flex-1">
        {intl.formatMessage(
          { id: "chat.workspaceHookPending.message" },
          { count: admission.pendingCount },
        )}
      </p>
      <button
        type="button"
        data-testid={TID_V4_WORKSPACE_HOOK_PENDING_REVIEW}
        className="shrink-0 rounded-md bg-primary px-2.5 py-1 text-primary-foreground hover:bg-primary/80"
        onClick={handleReview}
      >
        {intl.formatMessage({ id: "chat.workspaceHookPending.review" })}
      </button>
      <button
        type="button"
        data-testid={TID_V4_WORKSPACE_HOOK_PENDING_DISMISS}
        className="shrink-0 rounded-md px-2 py-1 text-foreground-subtle hover:bg-hover"
        onClick={handleDismiss}
      >
        {intl.formatMessage({ id: "chat.workspaceHookPending.dismiss" })}
      </button>
    </div>
  );
});
