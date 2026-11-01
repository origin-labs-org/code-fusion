import type { TimelinePill } from "@/components/workflow-timeline/timeline-model.js";
import { WorkflowRunDigest } from "@/components/workflow-timeline/WorkflowRunDigest.js";
import type { WorkflowRunSettingsHost } from "@/components/workflow-timeline/WorkflowRunSettingsPopover.js";
import { WorkflowSettingsChangeRow } from "@/components/workflow-timeline/WorkflowSettingsChangeRow.js";
import { isWorkflowRunConfigurable } from "@/components/workflow-timeline/workflowRunSettings.js";
import { useWorkflowSubagentModelProviderName } from "@/hooks/useWorkflowSubagentModelProviderName.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import type { ConversationRowRenderContext } from "@/v4/conversationRowContext.js";
import type { WorkflowTurnDigest } from "@/v4/workflowTurnDigests.js";
import { resolveWorkflowRunOpenToolCallId } from "@/v4/workflowRunCardJoin.js";

export function ConversationWorkflowDigests({
  context,
  digests,
  turnKey,
}: {
  digests: readonly WorkflowTurnDigest[];
  context: ConversationRowRenderContext;
  turnKey: string;
}) {
  const { intl } = useCfIntl();
  const subagentModelProviderName = useWorkflowSubagentModelProviderName(
    context.workspacePath,
    context.workspaceIdentity,
  );
  if (digests.length === 0) return null;
  const fallbackName = intl.formatMessage({ id: "chat.toolCall.workflow.fallbackName" });
  return (
    <div className="flex flex-col gap-3" data-testid={`workflow-run-digests-${turnKey}`}>
      {digests.map((digest) => {
        const { runId, summary } = digest;
        const name = digest.name ?? fallbackName;
        const sessionId = context.sessionId;
        if (digest.rowOnly && digest.settings !== undefined) {
          return (
            <WorkflowSettingsChangeRow
              amend={digest.settings.amend}
              key={digest.key}
              {...(digest.settings.at === undefined ? {} : { at: digest.settings.at })}
              {...(subagentModelProviderName === undefined
                ? {}
                : { providerName: subagentModelProviderName })}
            />
          );
        }
        const onOpenRun =
          context.onOpenWorkflowRun && sessionId
            ? (landing?: { phaseId: string }) =>
                context.onOpenWorkflowRun?.({
                  parentSessionId: sessionId,
                  toolCallId: resolveWorkflowRunOpenToolCallId(digest.toolCallId, summary),
                  runId,
                  workflowName: name,
                  ...(landing === undefined ? {} : { phaseId: landing.phaseId }),
                })
            : undefined;
        const onResume =
          context.onResumeWorkflowRun && summary?.resumable
            ? () => context.onResumeWorkflowRun?.(runId, name)
            : undefined;
        const onCancel =
          context.onCancelBackgroundWork && summary?.status === "running"
            ? () => context.onCancelBackgroundWork?.(runId)
            : undefined;
        const onOpenPill =
          context.onOpenWorkflowActor && sessionId && summary?.run
            ? (pill: TimelinePill) => {
                const slot = pill.slot;
                if (slot === undefined) return;
                const actorSessionId = pill.instance?.sessionId;
                const actorName = pill.runtimeName ?? pill.lane.name;
                context.onOpenWorkflowActor?.({
                  parentSessionId: sessionId,
                  ordinal: slot.ordinal,
                  runId,
                  siteId: slot.siteId,
                  ...(actorSessionId === undefined ? {} : { actorSessionId }),
                  ...(actorName === undefined ? {} : { actorName }),
                });
              }
            : undefined;
        const onOpenWorkspace =
          context.onOpenWorkflowWorkspace && sessionId && summary?.run
            ? (pill: TimelinePill) => {
                const phaseId = pill.workspace?.phaseId;
                if (phaseId === undefined) return;
                context.onOpenWorkflowWorkspace?.({
                  parentSessionId: sessionId,
                  toolCallId: resolveWorkflowRunOpenToolCallId(digest.toolCallId, summary),
                  runId,
                  workflowName: name,
                  phaseId,
                });
              }
            : undefined;
        const onOpenArtifact =
          context.onOpenWorkflowArtifact && sessionId
            ? (artifactId: string) => {
                const artifact = summary?.run?.artifacts?.find(
                  (candidate) => candidate.id === artifactId,
                );
                context.onOpenWorkflowArtifact?.({
                  parentSessionId: sessionId,
                  runId,
                  artifactId,
                  ...(artifact?.title === undefined ? {} : { title: artifact.title }),
                  ...(artifact?.contentType === undefined
                    ? {}
                    : { contentType: artifact.contentType }),
                });
              }
            : undefined;
        const pendingQuestions = context.workflowRunPendingQuestionsByRunId?.get(runId)?.size ?? 0;
        const amendSettings = context.onAmendWorkflowRunSettings;
        const settingsHost: WorkflowRunSettingsHost | undefined =
          amendSettings !== undefined && isWorkflowRunConfigurable(summary?.run)
            ? {
                workspacePath: context.workspacePath,
                ...(context.workspaceIdentity
                  ? { workspaceIdentity: context.workspaceIdentity }
                  : {}),
                ...(context.workspaceRemoteSessionId
                  ? { remoteSessionId: context.workspaceRemoteSessionId }
                  : {}),
                ...(context.workflowSessionModel === undefined
                  ? {}
                  : { sessionModel: context.workflowSessionModel }),
                apply: (change) => amendSettings(runId, change),
              }
            : undefined;
        const card = (
          <WorkflowRunDigest
            graph={digest.graph}
            {...(digest.holeLabels === undefined ? {} : { holeLabels: digest.holeLabels })}
            key={digest.key}
            name={name}
            pendingQuestions={pendingQuestions}
            runId={runId}
            summary={summary}
            testIdKey={`${turnKey}-${digest.toolCallId}`}
            {...(subagentModelProviderName === undefined ? {} : { subagentModelProviderName })}
            {...(onOpenRun === undefined ? {} : { onOpenRun })}
            {...(onResume === undefined ? {} : { onResume })}
            {...(onCancel === undefined ? {} : { onCancel })}
            {...(onOpenPill === undefined ? {} : { onOpenPill })}
            {...(onOpenWorkspace === undefined ? {} : { onOpenWorkspace })}
            {...(onOpenArtifact === undefined ? {} : { onOpenArtifact })}
            {...(settingsHost === undefined ? {} : { settingsHost })}
          />
        );
        if (digest.settings === undefined) return card;
        return (
          <div className="flex flex-col gap-1.5" key={digest.key}>
            <WorkflowSettingsChangeRow
              amend={digest.settings.amend}
              {...(digest.settings.at === undefined ? {} : { at: digest.settings.at })}
              {...(subagentModelProviderName === undefined
                ? {}
                : { providerName: subagentModelProviderName })}
            />
            {card}
          </div>
        );
      })}
    </div>
  );
}
