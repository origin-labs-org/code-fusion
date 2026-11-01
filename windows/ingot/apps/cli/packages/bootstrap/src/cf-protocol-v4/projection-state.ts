import type {
  ActionAvailability,
  ConversationDelta,
  ConversationSnapshot,
  GoalState,
  InputRouting,
  SessionActionAvailability,
  SessionControl,
  StatePatch,
} from "@origin-ai/cf-shared/cf-protocol-v4";

export const HYDRATION_TRACE_ID = "hydrate-trace";

export function createInitialConversationSnapshot(
  sessionId: string,
  logEpoch: string,
): ConversationSnapshot {
  return {
    protocolVersion: 1,
    sessionId,
    logEpoch,
    seq: 0,
    revision: 0,
    control: {
      phase: "draft",
      sessionEnded: false,
      canStop: false,
      stopState: "idle",
      stopTargetKind: "unknown",
      activeWorks: [],
      lastError: null,
      apiRetry: null,
    },
    availability: computeAvailability({
      phase: "draft",
      goalStatus: null,
      compacting: false,
      goalVerifying: false,
      queueLength: 0,
      autoDrain: true,
    }),
    inputRouting: computeInputRouting(
      {
        phase: "draft",
        goalStatus: null,
        compacting: false,
        goalVerifying: false,
        queueLength: 0,
        autoDrain: true,
      },
      "queue",
    ),
    meta: { title: "", titleSource: "default" },
    config: {
      provider: "",
      model: "",
      thought: "",
      thoughtLevels: [],
      followupMode: "queue",
      mode: "build",
    },
    modelTransition: null,
    usage: {
      contextWindow: null,
      cumulative: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    },
    queue: { items: [], autoDrain: true },
    pendingInteractions: [],
    pendingCommands: [],
    backgroundWorks: [],
    subagents: { revision: 0, childSessionIds: [], running: [], endedTotal: 0 },
    goal: null,
    plan: null,
    workspaceHookAdmission: null,
    rows: { window: [], totalCount: 0, firstRowId: null },
  };
}

const ALLOWED: ActionAvailability = { allowed: true };

function denied(reasonCode: string): ActionAvailability {
  return { allowed: false, reasonCode };
}

export interface AvailabilityContext {
  phase: SessionControl["phase"];
  goalStatus: GoalState["status"] | null;
  compacting: boolean;
  goalVerifying: boolean;
  queueLength: number;
  autoDrain: boolean;
}

export function computeAvailability(context: AvailabilityContext): SessionActionAvailability {
  const { phase, goalStatus, compacting } = context;
  const running = phase === "running" || phase === "prewarming";
  const compact = compacting
    ?
      denied("compactOperationLock")
    : phase === "draft"
      ?
        denied("idleCannotCompact")
      :
        ALLOWED;
  return {
    fork: compacting
      ? denied("compactOperationLock")
      : phase === "draft"
        ? denied("forkTargetNotStable")
        : ALLOWED,
    compact,
    switchModelConfig: ALLOWED,
    setFollowupMode: ALLOWED,
    queueEdit: ALLOWED,
    sendQueuedNow: compacting
      ? denied("compactOperationLock")
      : running
        ? ALLOWED
        : denied("sendQueuedNowRequiresRunning"),
    pauseGoal:
      goalStatus === "active" || goalStatus === "verifying" || goalStatus === "notSatisfied"
        ? ALLOWED
        : denied(goalStatus === null ? "noGoalToPause" : "goalNotActive"),
    resumeGoal:
      goalStatus === "paused"
        ? ALLOWED
        : denied(goalStatus === null ? "noGoalToResume" : "goalNotPaused"),
  };
}

export function computeInputRouting(
  context: AvailabilityContext,
  followupMode: "queue" | "guide",
): InputRouting {
  // formal-proof: compactingAcceptsFutureInput
  if (context.compacting) {
    return { mode: "enqueue", reasonCode: "compactingAcceptsFutureInput" };
  }
  if (context.goalVerifying) {
    return { mode: "enqueue", reasonCode: "goalVerifierAcceptsFutureInput" };
  }
  if (context.phase === "running" || context.phase === "prewarming") {
    return { mode: followupMode === "guide" ? "guide" : "enqueue" };
  }
  const completed =
    context.phase === "completedSuccess" || context.phase === "completedInterrupted";
  if (completed && context.queueLength > 0 && !context.autoDrain) {
    return { mode: "choice", reasonCode: "heldQueueInputRequiresChoice" };
  }
  return { mode: "startNow" };
}

const REVISION_BEARING_PATCH_KEYS: ReadonlyArray<keyof StatePatch> = [
  "control",
  "availability",
  "inputRouting",
  "meta",
  "config",
  "queue",
  "pendingInteractions",
  "backgroundWorks",
  "subagents",
  "goal",
  "plan",
];

export function deltaBumpsRevision(delta: ConversationDelta): boolean {
  switch (delta.op) {
    case "row.appended":
    case "row.upserted":
    case "row.removed":
      return true;
    case "row.delta":
      return false;
    case "state.updated":
      return REVISION_BEARING_PATCH_KEYS.some((key) => delta.patch[key] !== undefined);
    case "pluginUi.resourceUpdated":
    case "pluginUi.resourceListChanged":
    case "pluginUi.instanceClosed":
    case "pluginUi.appToolCall":
    case "workflowRun.updated":
    case "workflowRun.removed":
      return false;
  }
}
