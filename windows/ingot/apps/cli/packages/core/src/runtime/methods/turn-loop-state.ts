import { OFF_PEAK_EXECUTION_TOOL_DENYLIST } from "@origin-ai/cf-shared";
import type {
  CompactPhase,
  CompactReason,
  MessageId,
  ModelStreamRecoveryStatus,
  Model,
  ModelSelection,
  OutputStylePromptConfig,
  SessionEvent,
  TraceContext,
  TraceId,
  TurnId,
} from "../deps.js";
import type { ActiveTurnSteeringState } from "../types.js";
import type { ModelToolContract, SubagentRunOptions } from "@origin-ai/cf-contracts";
import type { DrainedPendingInputDiagnostics, ModelExecutionContext } from "../types.js";
import type { TurnMachineImpl } from "../deps.js";
import type { RuntimeMessageEntry } from "../../agent/message-history.js";

export type PendingStreamRecoveryRequest = ModelStreamRecoveryStatus;

export const RAPID_REFILL_TOOL_TURN_THRESHOLD = 3;
export const MAX_CONSECUTIVE_RAPID_REFILLS = 3;
export const AUTOMATION_MUTATION_TOOL_NAMES = ["CronCreate", "CronUpdate", "CronDelete"] as const;
const AUTOMATION_QUERY_ID_PREFIX = "automation-";

export const OFF_PEAK_MUTATION_TOOL_NAMES = OFF_PEAK_EXECUTION_TOOL_DENYLIST;
const OFF_PEAK_QUERY_ID_PREFIX = "offpeak-";

export interface CompactLoopTracking {
  consecutiveRapidRefills: number;
  toolTurnsSinceCompact: number;
}

export interface RapidRefillDecision {
  consecutiveRapidRefills: number;
  shouldBlock: boolean;
  toolTurnsSinceCompact: number;
}

export type CompactAttemptOutcome = "skipped" | "compacted" | "failed";

export type AutoCompactOutcome = CompactAttemptOutcome | "rapid_refill_blocked";

export interface AutoCompactLoopContext {
  getAgentListingTools?: () => readonly { name: string }[];
  compactReason: CompactReason;
  modelStepIndex: number;
  phase: CompactPhase;
  rapidRefill: RapidRefillDecision;
  model: Model;
  turnRequestState: TurnRequestState;
  getContinuationTools?: () => readonly ModelToolContract[];
}

export interface ReactiveCompactLoopContext {
  agentListingTools?: readonly { name: string }[];
  activeEntries?: readonly RuntimeMessageEntry[];
  modelStepIndex: number;
  model: Model;
  rapidRefillCount: number;
  turnRequestState: TurnRequestState;
  getContinuationTools?: () => readonly ModelToolContract[];
}

export interface TurnRequestState {
  entries: readonly RuntimeMessageEntry[];
  outputTokenContinuationCount: number;
}

export interface RegularTurnLoopState {
  offPeakExecutionId?: string;
  activeTurn?: ActiveTurnSteeringState;
  
  automationId?: string;
  
  offPeakTaskId?: string;
  
  automationCreateLimitReached?: boolean;
  anomalyWarningsInjected: number;
  
  backgroundSubagentResultConsumed: boolean;
  
  workflowResultConsumed: boolean;
  compactTracking?: CompactLoopTracking;
  currentUserMessageId: MessageId;
  drainedSteerForNextRequest?: DrainedPendingInputDiagnostics;
  events: SessionEvent[];
  input: string;
  inputId?: string;
  modelResponse: string;
  
  model: Model;
  
  modelSelectionScope?: "execution";
  
  selectionFallback?: ModelExecutionContext["selectionFallback"];
  
  highspeedFallbackUnavailable?: boolean;
  
  highspeedFallbackSelection?: ModelSelection;
  
  subagentModelOverride?: SubagentRunOptions["modelOverride"];
  modelStepCount: number;
  
  historyRoundCount: number;
  completedRealToolResultBatch: boolean;
  reactiveCompactAttemptedInCurrentModelStep: boolean;
  repeatedToolCallSignature?: string;
  repeatedToolCallStreakCount: number;
  pendingStreamRecoveryRequest?: PendingStreamRecoveryRequest;
  stopHookContinuationCount: number;
  
  stableProductStartMessageId?: MessageId;
  
  stableBoundaryAssistantMessageId?: MessageId;
  streamRecoveryRetryCount: number;
  tokenCount: number;
  toolCallCount: number;
  
  turnRequestState: TurnRequestState;
  
  toolDisallowlist?: readonly string[];
  traceId: TraceId;
  turnAbortSignal: AbortSignal;
  turnId: TurnId;
  turnMachine: TurnMachineImpl;
  
  turnOutputStyle?: OutputStylePromptConfig;
  turnTraceContext: TraceContext;
  userMessageId: MessageId;
}

export function isAutomationMutationRestrictedTurn(state: RegularTurnLoopState): boolean {
  if (state.automationId?.trim()) return true;
  if (state.turnTraceContext.queryId?.trim().startsWith(AUTOMATION_QUERY_ID_PREFIX)) return true;

  const disallowedTools = new Set(state.toolDisallowlist ?? []);
  return AUTOMATION_MUTATION_TOOL_NAMES.every((toolName) => disallowedTools.has(toolName));
}

export function isOffPeakCreateRestrictedTurn(state: RegularTurnLoopState): boolean {
  if (state.offPeakTaskId?.trim()) return true;
  if (state.turnTraceContext.queryId?.trim().startsWith(OFF_PEAK_QUERY_ID_PREFIX)) return true;

  const disallowedTools = new Set(state.toolDisallowlist ?? []);
  return disallowedTools.has(OFF_PEAK_MUTATION_TOOL_NAMES[0]);
}

export function evaluateRapidRefill(
  tracking: CompactLoopTracking | undefined,
): RapidRefillDecision {
  const toolTurnsSinceCompact = tracking?.toolTurnsSinceCompact ?? 0;
  const consecutiveRapidRefills =
    tracking && toolTurnsSinceCompact < RAPID_REFILL_TOOL_TURN_THRESHOLD
      ? tracking.consecutiveRapidRefills + 1
      : 0;

  return {
    consecutiveRapidRefills,
    shouldBlock: consecutiveRapidRefills >= MAX_CONSECUTIVE_RAPID_REFILLS,
    toolTurnsSinceCompact,
  };
}

export function recordCompactSuccess(
  state: RegularTurnLoopState,
  decision: RapidRefillDecision,
): void {
  state.compactTracking = {
    consecutiveRapidRefills: decision.consecutiveRapidRefills,
    toolTurnsSinceCompact: 0,
  };
}

export function recordCompletedToolBatch(state: RegularTurnLoopState): void {
  state.reactiveCompactAttemptedInCurrentModelStep = false;
  if (state.compactTracking) {
    state.compactTracking.toolTurnsSinceCompact += 1;
  }
}

export function recordModelHistoryRound(state: RegularTurnLoopState): void {
  state.historyRoundCount += 1;
}

export function recordCompactHistoryRound(state: RegularTurnLoopState): void {
  state.historyRoundCount += 1;
}
