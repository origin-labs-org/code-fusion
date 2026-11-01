import {
  deriveSessionWorkflowActivity,
  type ConversationSnapshot,
  type SessionSummary,
  type SessionsIndexDelta,
  type SessionsIndexSnapshot,
} from "@origin-ai/cf-shared/cf-protocol-v4";

export interface SessionSummaryDeriveExtra {
  workspaceId: string;
  createdAt: number;
  lastActivityAt: number;
  lastOutcome?: SessionSummary["lastOutcome"];
  parentSessionId?: string;
}

const MAX_PREVIEW_CHARS = 120;

export function deriveSessionSummary(
  snapshot: ConversationSnapshot,
  extra: SessionSummaryDeriveExtra,
): SessionSummary {
  let lastAssistantPreview: string | undefined;
  const lastOutcome = extra.lastOutcome;
  const rows = snapshot.rows.window;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (
      !lastAssistantPreview &&
      row &&
      row.kind === "assistantText" &&
      row.text.trim().length > 0
    ) {
      lastAssistantPreview = row.text.slice(0, MAX_PREVIEW_CHARS);
    }
    if (lastAssistantPreview) break;
  }
  const hasBackgroundWork = snapshot.backgroundWorks.some((work) => work.status === "running");
  const workflowActivity = deriveSessionWorkflowActivity({
    workflowRuns: snapshot.workflowRuns,
    backgroundWorks: snapshot.backgroundWorks,
  });
  const pending = snapshot.pendingInteractions.find(
    (interaction) => interaction.kind === "permission" || interaction.kind === "userInput",
  );
  const permissionCount = snapshot.pendingInteractions.filter(
    (interaction) => interaction.kind === "permission",
  ).length;
  const userInputCount = snapshot.pendingInteractions.filter(
    (interaction) => interaction.kind === "userInput",
  ).length;
  const pendingPayload = pending?.payload;
  const pendingToolName =
    pendingPayload && "toolName" in pendingPayload ? pendingPayload.toolName : undefined;
  const pendingInteraction =
    pending &&
    pendingPayload &&
    (pendingPayload.kind === "permission" || pendingPayload.kind === "userInput")
      ? {
          interactionId: pending.interactionId,
          kind: pendingPayload.kind,
          ...(pendingToolName ? { toolName: pendingToolName } : {}),
          ...(pending.autoResolution ? { autoResolution: pending.autoResolution } : {}),
        }
      : undefined;
  return {
    sessionId: snapshot.sessionId,
    workspaceId: extra.workspaceId,
    ...(extra.parentSessionId ? { parentSessionId: extra.parentSessionId } : {}),
    title: snapshot.meta.title,
    titleSource: snapshot.meta.titleSource,
    ...(lastOutcome ? { lastOutcome } : {}),
    phase: snapshot.control.phase,
    sessionEnded: snapshot.control.sessionEnded,
    hasBackgroundWork,
    ...(workflowActivity === undefined ? {} : { workflowActivity }),
    ...(pendingInteraction ? { pendingInteraction } : {}),
    ...(permissionCount > 0 || userInputCount > 0
      ? {
          pendingInteractionSummary: {
            permissionCount,
            userInputCount,
          },
        }
      : {}),
    ...(snapshot.goal ? { goalStatus: snapshot.goal.status } : {}),
    lastActivityAt: extra.lastActivityAt,
    ...(lastAssistantPreview ? { lastAssistantPreview } : {}),
    createdAt: extra.createdAt,
  };
}

function summariesEqual(a: SessionSummary, b: SessionSummary): boolean {
  return (
    a.sessionId === b.sessionId &&
    a.workspaceId === b.workspaceId &&
    a.parentSessionId === b.parentSessionId &&
    a.title === b.title &&
    a.titleSource === b.titleSource &&
    a.lastOutcome === b.lastOutcome &&
    a.phase === b.phase &&
    a.sessionEnded === b.sessionEnded &&
    a.hasBackgroundWork === b.hasBackgroundWork &&
    JSON.stringify(a.workflowActivity ?? null) === JSON.stringify(b.workflowActivity ?? null) &&
    JSON.stringify(a.pendingInteraction ?? null) === JSON.stringify(b.pendingInteraction ?? null) &&
    a.pendingInteractionSummary?.permissionCount === b.pendingInteractionSummary?.permissionCount &&
    a.pendingInteractionSummary?.userInputCount === b.pendingInteractionSummary?.userInputCount &&
    a.goalStatus === b.goalStatus &&
    a.lastActivityAt === b.lastActivityAt &&
    a.lastAssistantPreview === b.lastAssistantPreview &&
    a.createdAt === b.createdAt
  );
}

export class SessionsIndexProjection {
  private readonly summaries = new Map<string, SessionSummary>();

  constructor(
    readonly workspaceId: string,
    readonly logEpoch: string,
  ) {}

  
  upsertFromConversation(
    snapshot: ConversationSnapshot,
    extra: Omit<SessionSummaryDeriveExtra, "workspaceId">,
  ): SessionsIndexDelta[] {
    const summary = deriveSessionSummary(snapshot, {
      workspaceId: this.workspaceId,
      ...extra,
    });
    const prev = this.summaries.get(summary.sessionId);
    if (prev) {
      if (prev.titleSource === "custom" && summary.titleSource !== "custom") {
        summary.title = prev.title;
        summary.titleSource = prev.titleSource;
      } else if (!summary.title && prev.title) {
        summary.title = prev.title;
        if (prev.titleSource === undefined) {
          delete summary.titleSource;
        } else {
          summary.titleSource = prev.titleSource;
        }
      }
      if (prev.createdAt > 0 && summary.createdAt > prev.createdAt) {
        summary.createdAt = prev.createdAt;
      }
      if (!summary.lastAssistantPreview && prev.lastAssistantPreview) {
        summary.lastAssistantPreview = prev.lastAssistantPreview;
      }
      if (summary.phase === "draft" && prev.phase !== "draft") {
        summary.phase = prev.phase;
        summary.sessionEnded = prev.sessionEnded;
        if (summary.goalStatus === undefined && prev.goalStatus !== undefined) {
          summary.goalStatus = prev.goalStatus;
        }
      }
    }
    if (prev && summariesEqual(prev, summary)) return [];
    this.summaries.set(summary.sessionId, summary);
    return [{ op: "session.upserted", session: summary }];
  }

  
  seed(summary: SessionSummary): void {
    this.summaries.set(summary.sessionId, summary);
  }

  
  insertSeedIfMissing(summary: SessionSummary): SessionsIndexDelta[] {
    if (this.summaries.has(summary.sessionId)) return [];
    this.summaries.set(summary.sessionId, summary);
    return [{ op: "session.upserted", session: summary }];
  }

  
  remove(sessionId: string): SessionsIndexDelta[] {
    if (!this.summaries.has(sessionId)) return [];
    this.summaries.delete(sessionId);
    return [{ op: "session.removed", sessionId }];
  }

  has(sessionId: string): boolean {
    return this.summaries.has(sessionId);
  }

  
  getSnapshot(): SessionsIndexSnapshot {
    return {
      protocolVersion: 1,
      workspaceId: this.workspaceId,
      logEpoch: this.logEpoch,
      sessions: [...this.summaries.values()],
    };
  }
}
