import { memo, useEffect, useMemo } from "react";
import { HourglassIcon } from "lucide-react";
import type { MessageFileLinkTarget } from "@/components/ai-elements/message.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import type { CodeViewerSource } from "@/lib/codeViewer.js";
import type { WorkflowActorSessionSidePaneTab } from "@/lib/workspaceSidePane.js";
import { workflowActorStartState } from "@/app-shell/workflowRunPanel.js";
import type { PaneWorkspaceScope } from "@/v4/paneLayoutStore.js";
import { SessionPane } from "@/v4/SessionPane.js";
import { useConversationProjection } from "@/v4/useConversationProjection.js";
import { useV4Conversation, V4PaneConversationProvider } from "@/v4/V4ConversationContext.js";

interface WorkflowActorSessionSidePaneProps {
  tab: WorkflowActorSessionSidePaneTab;
  focused: boolean;
  onOpenBrowserUrl?: (url: string) => void;
  onOpenCodeViewer?: (source: CodeViewerSource) => void;
  onOpenFileLink?: (target: MessageFileLinkTarget) => void;
}

function WorkflowActorNotStarted() {
  const { intl } = useCfIntl();
  return (
    <div
      className="flex h-full flex-col items-center justify-center px-6 text-center"
      data-testid="workflow-actor-not-started"
    >
      <HourglassIcon className="size-8 text-foreground-subtlest" />
      <p className="mt-3 text-ui-base font-medium text-foreground">
        {intl.formatMessage({ id: "chat.toolCall.workflow.run.actor.notStarted.title" })}
      </p>
      <p className="mt-1 text-ui-base text-foreground-subtle">
        {intl.formatMessage({ id: "chat.toolCall.workflow.run.actor.notStarted.body" })}
      </p>
    </div>
  );
}

const WorkflowActorSessionContent = memo(function WorkflowActorSessionContent({
  tab,
  focused,
  onOpenBrowserUrl,
  onOpenCodeViewer,
  onOpenFileLink,
}: WorkflowActorSessionSidePaneProps) {
  const { layer } = useV4Conversation();

  const lease = useMemo(() => layer.acquire(tab.parentSessionId), [layer, tab.parentSessionId]);
  useEffect(() => () => lease.release(), [lease]);

  const snapshot = useConversationProjection(lease).snapshot;
  const gate = useMemo(
    () =>
      workflowActorStartState(snapshot?.workflowRuns?.runs, {
        runId: tab.runId,
        siteId: tab.siteId,
        ordinal: tab.ordinal,
        ...(tab.actorSessionId === undefined ? {} : { actorSessionId: tab.actorSessionId }),
      }),
    [snapshot?.workflowRuns, tab.actorSessionId, tab.ordinal, tab.runId, tab.siteId],
  );

  if (gate.state === "notStarted" || gate.sessionId === undefined) {
    return <WorkflowActorNotStarted />;
  }

  return (
    <SessionPane
      paneId={tab.id}
      sessionId={gate.sessionId}
      readOnly
      allowWorkspaceFileRewind
      focused={focused}
      telemetryVisible={focused}
      workspacePath={tab.workspacePath}
      workspaceIdentity={tab.workspaceIdentity}
      remoteSessionId={tab.remoteSessionId}
      onOpenBrowserUrl={onOpenBrowserUrl}
      onOpenCodeViewer={onOpenCodeViewer}
      onOpenFileLink={onOpenFileLink}
    />
  );
});

export const WorkflowActorSessionSidePane = memo(function WorkflowActorSessionSidePane({
  tab,
  focused,
  onOpenBrowserUrl,
  onOpenCodeViewer,
  onOpenFileLink,
}: WorkflowActorSessionSidePaneProps) {
  const scope = useMemo<PaneWorkspaceScope>(
    () => ({
      workspacePath: tab.workspacePath,
      ...(tab.workspaceIdentity ? { workspaceIdentity: tab.workspaceIdentity } : {}),
      ...(tab.remoteSessionId ? { remoteSessionId: tab.remoteSessionId } : {}),
    }),
    [tab.remoteSessionId, tab.workspaceIdentity, tab.workspacePath],
  );

  return (
    <V4PaneConversationProvider scope={scope}>
      <WorkflowActorSessionContent
        tab={tab}
        focused={focused}
        onOpenBrowserUrl={onOpenBrowserUrl}
        onOpenCodeViewer={onOpenCodeViewer}
        onOpenFileLink={onOpenFileLink}
      />
    </V4PaneConversationProvider>
  );
});
