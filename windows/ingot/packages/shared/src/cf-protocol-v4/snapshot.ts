/* oxlint-disable max-lines -- v4 snapshot schema is a frozen cross-process contract; additions stay grouped here. */
import { z } from "zod";
import { sharedContextImportStateSchema } from "./shared-context-import.js";
export { sharedContextImportStateSchema } from "./shared-context-import.js";
import { conversationInputDispatchSchema, conversationInputIntentSchema } from "./input-intent.js";
import {
  cfContextUsageBreakdownSchema,
  cfInteractionRequestOriginSchema,
  cfPermissionResponseSchema,
  cfSessionContextCacheUsageSchema,
} from "../cf-protocol-legacy-types.js";
import { timestampSchema } from "./core.js";
import { conversationRowSchema } from "./rows.js";
import { toolCallDisplaySchema } from "./toolDisplay.js";

import { workspaceHookReviewRequestPayloadSchema } from "./workspace-hook-review.js";
import { workflowRunsStateSchema } from "./workflow-runs.js";
import { sessionConfigStateSchema, sessionModelTransitionSchema } from "./session-config.js";
export {
  sessionConfigStateSchema,
  sessionModelTransitionSchema,
  type SessionConfigState,
  type SessionModelTransition,
} from "./session-config.js";
// ── SessionControl ──
export const sessionPhaseSchema = z.enum([
  "draft",
  "prewarming",
  "running",
  "completedSuccess",
  "completedInterrupted",
  "error",
]);
export type SessionPhase = z.infer<typeof sessionPhaseSchema>;

export const stopTargetKindSchema = z.enum([
  "assistant",
  "tool",
  "subagent",
  "compact",
  "goalVerifier",
  "goalContinuation",
  "turnSteer",
  "mixed",
  "unknown",
]);
export type StopTargetKind = z.infer<typeof stopTargetKindSchema>;

export const activeWorkSummarySchema = z.object({
  kind: z.enum([
    "primaryTurn",
    "foregroundSubagent",
    "compact",
    "goalVerifier",
    "goalContinuation",
    "turnSteer",
  ]),
  foregroundExecutionId: z.string().min(1).optional(),
  sourceCommandId: z.string().min(1).optional(),
  startedAt: timestampSchema,
});
export type ActiveWorkSummary = z.infer<typeof activeWorkSummarySchema>;

export const errorAttributionSchema = z
  .object({
    source: z.enum(["provider", "runtime", "tool", "network"]).optional(),
    reason: z.string().min(1).max(160).optional(),
    errorPhase: z
      .enum([
        "prepare",
        "configuration",
        "connect",
        "response",
        "stream",
        "parse",
        "validation",
        "unhandled",
      ])
      .optional(),
    exceptionKind: z
      .enum([
        "api_call",
        "generic",
        "protocol",
        "provider_business",
        "transport",
        "type_error",
        "validation",
      ])
      .optional(),
    providerId: z.string().min(1).max(160).optional(),
    modelId: z.string().min(1).max(160).optional(),
    providerKind: z.string().min(1).max(160).optional(),
    transport: z.enum(["http", "sse", "websocket"]).optional(),
    statusCode: z.number().int().min(100).max(599).optional(),
    providerErrorCode: z.string().min(1).max(160).optional(),
    retryable: z.boolean().optional(),
    
    highspeedCardId: z.string().nullable().optional(),
    
    highspeedFallbackUnavailable: z.boolean().optional(),
  })
  .strict();
export type ErrorAttribution = z.infer<typeof errorAttributionSchema>;

export const sessionErrorInfoSchema = z.object({
  code: z.string(),
  message: z.string(),
  recoverable: z.boolean(),
  at: timestampSchema,
  source: z.enum(["provider", "runtime", "tool", "network"]),
  traceId: z.string().optional(),
  detail: z.string().optional(),
  underlyingErrorMessage: z.string().optional(),
  underlyingErrorDetail: z.string().optional(),
  attribution: errorAttributionSchema.optional(),
});
export type SessionErrorInfo = z.infer<typeof sessionErrorInfoSchema>;

export const apiRetryStateSchema = z.object({
  attempt: z.number(),
  maxAttempts: z.number(),
  nextRetryAt: timestampSchema,
  reasonCode: z.string(),
});
export type ApiRetryState = z.infer<typeof apiRetryStateSchema>;

export const sessionControlSchema = z.object({
  phase: sessionPhaseSchema,
  sessionEnded: z.boolean(),
  canStop: z.boolean(),
  stopState: z.enum(["idle", "stoppable", "stopping"]),
  stopTargetKind: stopTargetKindSchema,
  activeWorks: z.array(activeWorkSummarySchema),
  lastError: sessionErrorInfoSchema.nullable(),
  apiRetry: apiRetryStateSchema.nullable(),
});
export type SessionControl = z.infer<typeof sessionControlSchema>;

export const actionAvailabilitySchema = z.discriminatedUnion("allowed", [
  z.object({ allowed: z.literal(true) }),
  z.object({ allowed: z.literal(false), reasonCode: z.string() }),
]);
export type ActionAvailability = z.infer<typeof actionAvailabilitySchema>;

export const sessionActionAvailabilitySchema = z.object({
  fork: actionAvailabilitySchema,
  compact: actionAvailabilitySchema,
  switchModelConfig: actionAvailabilitySchema,
  setFollowupMode: actionAvailabilitySchema,
  queueEdit: actionAvailabilitySchema,
  sendQueuedNow: actionAvailabilitySchema,
  pauseGoal: actionAvailabilitySchema,
  resumeGoal: actionAvailabilitySchema,
});
export type SessionActionAvailability = z.infer<typeof sessionActionAvailabilitySchema>;

export const inputRoutingSchema = z.object({
  mode: z.enum(["startNow", "enqueue", "guide", "reject", "choice"]),
  reasonCode: z.string().optional(),
});
export type InputRouting = z.infer<typeof inputRoutingSchema>;

export const sessionMetaStateSchema = z.object({
  title: z.string(),
  titleSource: z.enum(["default", "generated", "custom"]),
});
export type SessionMetaState = z.infer<typeof sessionMetaStateSchema>;

export type { SharedContextImportState } from "./shared-context-import.js";

export const sessionUsageStateSchema = z.object({
  contextWindow: z
    .object({
      usedTokens: z.number(),
      maxTokens: z.number(),
      autoCompactThresholdTokens: z.number().nullable(),
      cache: cfSessionContextCacheUsageSchema.optional(),
      breakdown: cfContextUsageBreakdownSchema.optional(),
    })
    .nullable(),
  cumulative: z.object({
    inputTokens: z.number(),
    outputTokens: z.number(),
    cacheReadTokens: z.number(),
    cacheWriteTokens: z.number(),
  }),
});
export type SessionUsageState = z.infer<typeof sessionUsageStateSchema>;

export const queueItemSchema = conversationInputIntentSchema.extend({
  dispatch: conversationInputDispatchSchema.extend({
    state: z.enum(["queued", "reserved", "promoting"]),
  }),
  toolDisallowlist: z.array(z.string().min(1)).optional(),
});
export type QueueItem = z.infer<typeof queueItemSchema>;

export const queueStateSchema = z.object({
  items: z.array(queueItemSchema),
  autoDrain: z.boolean(),
  pauseReason: z.enum(["stopped", "manual", "error"]).optional(),
});
export type QueueState = z.infer<typeof queueStateSchema>;

export const MAX_PERMISSION_FEEDBACK_CHARS = 4_096;

export const PERMISSION_FULL_ACCESS_OPTION_ID = "fullAccess";
const permissionOptionSchema = z.object({
  optionId: z.string(),
  label: z.string(),
  kind: z.enum(["allowOnce", "allowAlways", "deny", "custom"]),
  response: cfPermissionResponseSchema.optional(),
});

export const permissionRequestPayloadSchema = z.object({
  kind: z.literal("permission"),
  toolCallId: z.string(),
  toolName: z.string(),
  summary: z.string(),
  detail: z.unknown(),
  freeText: z.boolean().optional(),
  origin: cfInteractionRequestOriginSchema.optional(),
  display: toolCallDisplaySchema.optional().catch(undefined),
  fullAccessOption: permissionOptionSchema
    .extend({
      optionId: z.literal(PERMISSION_FULL_ACCESS_OPTION_ID),
      kind: z.literal("custom"),
    })
    .optional(),
  options: z.array(permissionOptionSchema),
});
export type PermissionRequestPayload = z.infer<typeof permissionRequestPayloadSchema>;

export const userInputOptionPayloadSchema = z.object({
  value: z.string(),
  label: z.string(),
  description: z.string().optional(),
  preview: z.string().optional(),
});
export type UserInputOptionPayload = z.infer<typeof userInputOptionPayloadSchema>;

export const userInputQuestionPayloadSchema = z.object({
  question: z.string(),
  header: z.string(),
  options: z.array(userInputOptionPayloadSchema),
  multiSelect: z.boolean().optional(),
});
export type UserInputQuestionPayload = z.infer<typeof userInputQuestionPayloadSchema>;

export const userInputRequestPayloadSchema = z.object({
  kind: z.literal("userInput"),
  prompt: z.string(),
  freeText: z.boolean(),
  options: z.array(z.object({ optionId: z.string(), label: z.string() })).optional(),
  sensitive: z.boolean().optional(),
  toolName: z.string().optional(),
  toolCallId: z.string().optional(),
  traceId: z.string().optional(),
  input: z.unknown().optional(),
  schema: z.unknown().optional(),
  questions: z.array(userInputQuestionPayloadSchema).optional(),
  currentQuestionIndex: z.number().optional(),
  answerDrafts: z.record(z.string(), z.array(z.string())).optional(),
  origin: cfInteractionRequestOriginSchema.optional(),
});
export type UserInputRequestPayload = z.infer<typeof userInputRequestPayloadSchema>;

export const interactionAutoResolutionSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.enum(["hiddenGrace", "visibleCountdown"]),
    startedAt: timestampSchema,
    visibleAt: timestampSchema,
    deadlineAt: timestampSchema,
  }),
  z.object({
    state: z.literal("snoozed"),
    startedAt: timestampSchema,
    snoozedAt: timestampSchema,
  }),
]);
export type InteractionAutoResolution = z.infer<typeof interactionAutoResolutionSchema>;

export const pendingInteractionSchema = z
  .object({
    interactionId: z.string(),
    kind: z.enum(["permission", "userInput", "workspaceHookReview"]),
    anchorRowId: z.number().nullable(),
    createdAt: timestampSchema,
    autoResolution: interactionAutoResolutionSchema.optional(),
    payload: z.discriminatedUnion("kind", [
      permissionRequestPayloadSchema,
      userInputRequestPayloadSchema,
      workspaceHookReviewRequestPayloadSchema,
    ]),
  })
  .superRefine((interaction, context) => {
    if (interaction.kind !== interaction.payload.kind) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["kind"],
        message: "pending interaction kind must match payload kind",
      });
    }
    if (interaction.kind === "workspaceHookReview" && interaction.autoResolution) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["autoResolution"],
        message: "workspaceHookReview cannot use AskUserQuestion auto-resolution",
      });
    }
    if (
      interaction.payload.kind === "workspaceHookReview" &&
      interaction.interactionId !== interaction.payload.interactionId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["interactionId"],
        message: "workspaceHookReview interaction id must match its immutable payload",
      });
    }
  });
export type PendingInteraction = z.infer<typeof pendingInteractionSchema>;

// ── pendingCommands / backgroundWorks ──
export const commandStateSummarySchema = z.object({
  commandId: z.string(),
  clientId: z.string(),
  type: z.string(),
  state: z.enum(["accepted", "executing"]),
  at: timestampSchema,
});
export type CommandStateSummary = z.infer<typeof commandStateSummarySchema>;

export const backgroundWorkSummarySchema = z.object({
  workId: z.string(),
  kind: z.enum(["bash", "subagent", "workflow"]),
  title: z.string(),
  status: z.enum(["running", "resultPending", "failed", "cancelled"]),
  startedAt: timestampSchema,
  endedAt: timestampSchema.optional(),
  cancellable: z.boolean().optional(),
  blocked: z.boolean().optional(),
  anchorRowId: z.number().nullable(),
  childSessionId: z.string().optional(),
});
export type BackgroundWorkSummary = z.infer<typeof backgroundWorkSummarySchema>;

export const runningSubagentSummarySchema = z.object({
  childSessionId: z.string(),
  agentId: z.string().optional(),
  toolCallId: z.string().optional(),
  subagentType: z.string(),
  title: z.string(),
  summary: z.string().optional(),
  status: z.enum(["running", "waiting", "blocked"]),
  startedAt: timestampSchema.optional(),
});
export type RunningSubagentSummary = z.infer<typeof runningSubagentSummarySchema>;

export const subagentProjectionStateSchema = z.object({
  revision: z.number().int().nonnegative(),
  childSessionIds: z.array(z.string()),
  running: z.array(runningSubagentSummarySchema),
  endedTotal: z.number().int().nonnegative(),
});
export type SubagentProjectionState = z.infer<typeof subagentProjectionStateSchema>;

// ── goal / plan ──
export const planItemSchema = z.object({
  id: z.string(),
  content: z.string(),
  status: z.enum(["pending", "inProgress", "completed"]),
});
export type PlanItem = z.infer<typeof planItemSchema>;

export const goalIterationStateSchema = z.object({
  iteration: z.number().int().positive(),
  items: z.array(planItemSchema),
  updatedAt: timestampSchema,
});
export type GoalIterationState = z.infer<typeof goalIterationStateSchema>;

export const goalStateSchema = z.object({
  targetId: z.string().default(""),
  objective: z.string(),
  summaryTitle: z.string().nullable().default(null),
  timeUsedSeconds: z.number().int().nonnegative().default(0),
  activeRunStartedAtMs: z.number().int().nonnegative().nullable().default(null),
  status: z.enum(["active", "paused", "verifying", "verified", "notSatisfied", "failed"]),
  iteration: z.number(),
  verifications: z.array(
    z.object({
      iteration: z.number(),
      outcome: z.enum(["pass", "notSatisfied", "failed"]),
      at: timestampSchema,
      anchorRowId: z.number().nullable(),
      reason: z.string().optional(),
      nextAction: z.string().optional(),
    }),
  ),
  iterations: z.array(goalIterationStateSchema).default([]),
});
export type GoalState = z.infer<typeof goalStateSchema>;

export const planStateSchema = z.object({
  items: z.array(planItemSchema),
  updatedAt: timestampSchema,
});
export type PlanState = z.infer<typeof planStateSchema>;

export const rowsWindowSchema = z.object({
  window: z.array(conversationRowSchema),
  totalCount: z.number(),
  firstRowId: z.number().nullable(),
});
export type RowsWindow = z.infer<typeof rowsWindowSchema>;

export const workspaceHookAdmissionStateSchema = z.object({
  pendingCount: z.number().int().nonnegative(),
  bundleDigest: z.string(),
  workspaceIdentity: z.string().optional(),
});
export type WorkspaceHookAdmissionSnapshotState = z.infer<typeof workspaceHookAdmissionStateSchema>;

export const runtimeInitializationSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("initializing"), attemptId: z.string().min(1) }),
  z.object({ status: z.literal("ready"), attemptId: z.string().min(1) }),
  z.object({
    status: z.literal("failed"),
    attemptId: z.string().min(1),
    reasonCode: z.string(),
    message: z.string(),
  }),
]);
export type RuntimeInitialization = z.infer<typeof runtimeInitializationSchema>;

export const conversationSnapshotSchema = z.object({
  runtimeInitialization: runtimeInitializationSchema.optional(),
  protocolVersion: z.literal(1),
  sessionId: z.string(),
  logEpoch: z.string(),
  seq: z.number(),
  revision: z.number(),
  control: sessionControlSchema,
  availability: sessionActionAvailabilitySchema,
  inputRouting: inputRoutingSchema,
  meta: sessionMetaStateSchema.default({ title: "", titleSource: "default" }),
  sharedContextImport: sharedContextImportStateSchema.optional(),
  config: sessionConfigStateSchema,
  modelTransition: sessionModelTransitionSchema.nullable().default(null),
  usage: sessionUsageStateSchema,
  queue: queueStateSchema,
  pendingInteractions: z.array(pendingInteractionSchema),
  pendingCommands: z.array(commandStateSummarySchema),
  backgroundWorks: z.array(backgroundWorkSummarySchema),
  subagents: subagentProjectionStateSchema.optional(),
  workflowRuns: workflowRunsStateSchema.optional(),
  goal: goalStateSchema.nullable(),
  plan: planStateSchema.nullable(),
  workspaceHookAdmission: workspaceHookAdmissionStateSchema.nullable().default(null),
  rows: rowsWindowSchema,
});
export type ConversationSnapshot = z.infer<typeof conversationSnapshotSchema>;
