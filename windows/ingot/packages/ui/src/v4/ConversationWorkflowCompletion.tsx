import { useMemo } from "react";
import type { WorkflowRunArtifactSummary } from "@origin-ai/cf-shared/cf-protocol-v4";
import {
  WorkflowCompletionCard,
  type WorkflowCompletionFigures,
} from "@/components/workflow-timeline/WorkflowCompletionCard.js";
import {
  completionArtifactLayout,
  completionPreviewIds,
} from "@/components/workflow-timeline/WorkflowCompletionArtifacts.js";
import type { WorkflowCompletionArtifact } from "@/components/workflow-timeline/WorkflowArtifactTile.js";
import {
  useWorkflowRunArtifacts,
  type WorkflowRunArtifactView,
} from "@/hooks/useWorkflowRunArtifacts.js";
import {
  WorkflowRunSaveSlotsBoundary,
  type WorkflowRunSaveSlots,
  type WorkflowRunSaveSlotsHost,
} from "@/project-workflow/WorkflowRunSaveControls.js";
import type { ConversationRowRenderContext } from "@/v4/conversationRowContext.js";
import { WorkflowArtifactTilePreview } from "@/app-shell/workflow-artifacts/WorkflowArtifactTilePreview.js";
import { useHasV4Conversation } from "@/v4/V4ConversationContext.js";
import type { WorkflowTurnCompletion } from "@/v4/workflowTurnCompletion.js";

export function ConversationWorkflowCompletion({
  completion,
  context,
  turnKey,
}: {
  completion: WorkflowTurnCompletion;
  context: ConversationRowRenderContext;
  turnKey: string;
}) {
  const hasConversation = useHasV4Conversation();
  const sessionId = context.sessionId ?? undefined;
  const { summary } = completion;
  const run = summary?.run;
  const candidates = context.workflowSaveCandidatesByRunId?.get(completion.runId);

  const figures: WorkflowCompletionFigures = {
    ...(completion.durationMs === undefined ? {} : { durationMs: completion.durationMs }),
    ...(run === undefined
      ? {}
      : {
          tokens: run.usage.spentTokens,
          subagents: run.actors.length,
          ...(run.phases !== undefined && run.phases.length > 0
            ? { phases: run.phases.length }
            : {}),
        }),
  };
  const onOpenRun =
    context.onOpenWorkflowRun && sessionId && summary?.toolCallId
      ? () =>
          context.onOpenWorkflowRun?.({
            parentSessionId: sessionId,
            toolCallId: summary.toolCallId!,
            runId: completion.runId,
            workflowName: completion.name,
          })
      : undefined;
  const openArtifactFrom =
    context.onOpenWorkflowArtifact && sessionId
      ? (artifacts: readonly WorkflowCompletionArtifact[]) => (artifactId: string) => {
          const artifact = artifacts.find((candidate) => candidate.id === artifactId);
          context.onOpenWorkflowArtifact?.({
            parentSessionId: sessionId,
            runId: completion.runId,
            artifactId,
            ...(artifact?.title === undefined ? {} : { title: artifact.title }),
            ...(artifact?.contentType === undefined ? {} : { contentType: artifact.contentType }),
            ...(artifact?.sourcePath === undefined ? {} : { sourcePath: artifact.sourcePath }),
          });
        }
      : undefined;
  const onOpenArtifact = openArtifactFrom?.(completion.artifacts);

  const saveHost: WorkflowRunSaveSlotsHost = {
    sessionId: sessionId ?? undefined,
    workspacePath: context.workspacePath,
    ...(context.workspaceIdentity === undefined
      ? {}
      : { workspaceIdentity: context.workspaceIdentity }),
    ...(context.workspaceRemoteSessionId === undefined
      ? {}
      : { remoteSessionId: context.workspaceRemoteSessionId }),
    runId: completion.runId,
    runName: completion.name,
    ...(candidates === undefined ? {} : { candidates }),
    canSave: context.onSendWorkflowSaveRequest !== undefined,
    ...(context.onSendWorkflowSaveRequest === undefined
      ? {}
      : { sendLead: context.onSendWorkflowSaveRequest }),
  };

  const shared = {
    artifactsTruncated: completion.artifactsTruncated,
    figures,
    name: completion.name,
    testIdKey: turnKey,
    ...(onOpenRun === undefined ? {} : { onOpenRun }),
    ...(onOpenArtifact === undefined ? {} : { onOpenArtifact }),
  };

  if (!hasConversation || sessionId === undefined) {
    return <WorkflowCompletionCard {...shared} artifacts={completion.artifacts} />;
  }
  return (
    <WorkflowRunSaveSlotsBoundary host={saveHost}>
      {(slots) => (
        <WorkflowCompletionWithData
          completion={completion}
          live={run?.artifacts}
          sessionId={sessionId}
          shared={withSaveSlots(shared, slots)}
          theme={context.theme}
          {...(openArtifactFrom === undefined ? {} : { openArtifactFrom })}
        />
      )}
    </WorkflowRunSaveSlotsBoundary>
  );
}

function withSaveSlots<T extends object>(shared: T, slots: WorkflowRunSaveSlots | null): T {
  if (slots === null) return shared;
  return {
    ...shared,
    ...(slots.leading === null ? {} : { headerLeading: slots.leading }),
    ...(slots.trailing === null ? {} : { headerTrailing: slots.trailing }),
  };
}

function mergeCompletionArtifacts(
  base: readonly WorkflowCompletionArtifact[],
  views: readonly WorkflowRunArtifactView[],
): WorkflowCompletionArtifact[] {
  const byId = new Map(views.map((view) => [view.id, view] as const));
  const merged = base.map((artifact) => {
    const view = byId.get(artifact.id);
    if (view === undefined) return artifact;
    byId.delete(artifact.id);
    return {
      ...artifact,
      version: Math.max(artifact.version ?? 1, view.version),
      ...(view.contentType === undefined ? {} : { contentType: view.contentType }),
      ...(view.bytes === undefined ? {} : { bytes: view.bytes }),
      ...(view.sourcePath === undefined ? {} : { sourcePath: view.sourcePath }),
      ...(view.spec === undefined ? {} : { spec: view.spec }),
      ...(view.description === undefined ? {} : { description: view.description }),
      ...(view.primary === true ? { primary: true as const } : {}),
      itemCount: view.itemCount,
    } satisfies WorkflowCompletionArtifact;
  });
  for (const view of byId.values()) {
    merged.push({
      id: view.id,
      kind: view.kind,
      version: view.version,
      itemCount: view.itemCount,
      ...(view.title === undefined ? {} : { title: view.title }),
      ...(view.contentType === undefined ? {} : { contentType: view.contentType }),
      ...(view.bytes === undefined ? {} : { bytes: view.bytes }),
      ...(view.sourcePath === undefined ? {} : { sourcePath: view.sourcePath }),
      ...(view.spec === undefined ? {} : { spec: view.spec }),
      ...(view.description === undefined ? {} : { description: view.description }),
      ...(view.primary === true ? { primary: true as const } : {}),
    });
  }
  return merged;
}

function WorkflowCompletionWithData({
  completion,
  live,
  openArtifactFrom,
  sessionId,
  shared,
  theme,
}: {
  completion: WorkflowTurnCompletion;
  live: readonly WorkflowRunArtifactSummary[] | undefined;
  
  openArtifactFrom?: (
    artifacts: readonly WorkflowCompletionArtifact[],
  ) => (artifactId: string) => void;
  sessionId: string;
  shared: Omit<Parameters<typeof WorkflowCompletionCard>[0], "artifacts" | "renderPreview">;
  theme: ConversationRowRenderContext["theme"];
}) {
  const state = useWorkflowRunArtifacts({
    sessionId,
    runId: completion.runId,
    ...(live === undefined ? {} : { live }),
  });
  const artifacts = useMemo(
    () => mergeCompletionArtifacts(completion.artifacts, state.artifacts),
    [completion.artifacts, state.artifacts],
  );
  const artifactsTruncated = shared.artifactsTruncated === true && !state.complete;
  const renderPreview = (artifact: WorkflowCompletionArtifact) => (
    <WorkflowArtifactTilePreview
      artifact={artifact}
      key={`${artifact.id}:${artifact.version ?? 1}`}
      runId={completion.runId}
      sessionId={sessionId}
      theme={theme}
    />
  );
  const previewIds = useMemo(
    () => completionPreviewIds(completionArtifactLayout(artifacts, artifactsTruncated)),
    [artifacts, artifactsTruncated],
  );
  const onOpenArtifact = openArtifactFrom?.(artifacts);
  return (
    <WorkflowCompletionCard
      {...shared}
      {...(onOpenArtifact === undefined ? {} : { onOpenArtifact })}
      artifactsTruncated={artifactsTruncated}
      artifacts={artifacts}
      renderPreview={(artifact) =>
        previewIds.has(artifact.id) ? renderPreview(artifact) : undefined
      }
    />
  );
}
