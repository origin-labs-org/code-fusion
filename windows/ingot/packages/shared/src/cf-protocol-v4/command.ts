import { createSessionRequestedConfigSchema } from "./create-session-config.js";
import { localTtftContextSchema, localTtftClockSchema } from "../localTtft.js";
import { conversationQuotesSchema } from "../conversationSelection.js";
import { z } from "zod";
import { conversationRowTargetSchema, timestampSchema } from "./core.js";
import { attachmentRefSchema } from "./attachment-ref.js";
import { v4ConversationFileRewindPreviewResultSchema } from "./transport.js";
import { modelSelectionSchema } from "../model-selection.js";
import { modelExecutionSchema } from "../model-execution.js";
import { submissionModeSchema } from "./submission.js";
import { botGroupInputSourceSchema, cfAutomationBotDeliveryTargetSchema } from "../bots.js";
import { DYNAMIC_WORKFLOW_MODES } from "../dynamic-workflow-feature.js";
import {
  amendWorkflowRunSettingsPayloadSchema,
  amendWorkflowRunSettingsResultSchema,
} from "./workflow-run-settings-command.js";
import {
  workspaceHookReviewCommandTargetSchema,
  workspaceHookReviewDecisionSchema,
  workspaceHookTrustRevokeTargetSchema,
  requestWorkspaceHookReviewTargetSchema,
} from "./workspace-hook-review.js";
import {
  cfBrowserAmbientContextSchema,
  cfProtocolMcpServerSchema,
} from "../cf-protocol/index.js";
import { highspeedMessageMetaSchema } from "../highspeed.js";
import { sharedContextRefSchema } from "./shared-context-ref.js";
import { conversationInputSourceSchema } from "./input-intent.js";
export type { SharedContextRef } from "./shared-context-ref.js";
export * from "./workflow-command-rejections.js";

function requireModelSelectionForExecution(
  payload: { modelSelection?: unknown; modelExecution?: unknown },
  context: z.RefinementCtx,
): void {
  if (payload.modelExecution && !payload.modelSelection) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "modelExecution requires modelSelection",
      path: ["modelExecution"],
    });
  }
}

export const commandPayloadSchemas = {
  createSession: z.object({
    sessionId: z.string().min(1).optional(),
    additionalDirectories: z.array(z.string().min(1)).max(256).optional(),
    workspaceId: z.string(),
    permissionScope: z.literal("session").optional(),
    firstInput: z
      .object({
        text: z.string(),
        attachments: z.array(attachmentRefSchema).optional(),
        modelSelection: modelSelectionSchema.optional(),
        mode: submissionModeSchema.optional(),
        planEnabled: z.boolean().optional(),
      })
      .optional(),
    config: createSessionRequestedConfigSchema.optional(),
    mcpServers: z.array(cfProtocolMcpServerSchema).optional(),
    offPeakToolEnabled: z.boolean().optional(),
    dynamicWorkflowEnabled: z.boolean().optional(),
    dynamicWorkflowMode: z.enum(DYNAMIC_WORKFLOW_MODES).optional(),
  }),
  createSelectionSideSession: z.object({
    firstInput: z
      .object({
        text: z.string().trim().min(1),
        modelSelection: modelSelectionSchema.optional(),
      })
      .optional(),
  }),
  sendText: z
    .object({
      text: z.string(),
      attachments: z.array(attachmentRefSchema).optional(),
      requestedDelivery: z.enum(["startNow", "queue", "guide"]).optional(),
      browserAmbientContext: cfBrowserAmbientContextSchema.optional(),
      context_refs: z.array(sharedContextRefSchema).max(1).optional(),
      source: conversationInputSourceSchema.optional(),
      heldQueueDisposition: z.enum(["clearQueueAndSend", "keepQueueAndSend"]).optional(),
      expectedHeldQueueItemIds: z.array(z.string().min(1)).optional(),
      modelSelection: modelSelectionSchema.optional(),
      mode: submissionModeSchema.optional(),
      planEnabled: z.boolean().optional(),
      modelExecution: modelExecutionSchema.optional(),
      // docs/highspeed/highspeed-access-mode-migration.md。
      highspeedMeta: highspeedMessageMetaSchema.optional(),
      automationId: z.string().min(1).optional(),
      offPeakTaskId: z.string().min(1).optional(),
      offPeakRunType: z.enum(["init", "resume"]).optional(),
      botDeliveryTarget: cfAutomationBotDeliveryTargetSchema.optional(),
      inputOrigin: z.enum(["desktop", "mobile"]).optional(),
      botGroupSource: botGroupInputSourceSchema.optional(),
      conversationQuotes: conversationQuotesSchema.optional(),
      toolDisallowlist: z.array(z.string().min(1)).optional(),
    })
    .superRefine((payload, context) => {
      if (payload.automationId && payload.offPeakTaskId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "automationId and offPeakTaskId are mutually exclusive",
        });
      }
      if (payload.offPeakRunType && !payload.offPeakTaskId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "offPeakRunType requires offPeakTaskId",
          path: ["offPeakRunType"],
        });
      }
      requireModelSelectionForExecution(payload, context);
    }),
  sendGoalCommand: z.object({
    text: z.string(),
    displayText: z.string().optional(),
    modelSelection: modelSelectionSchema.optional(),
    mode: submissionModeSchema.optional(),
    planEnabled: z.boolean().optional(),
    heldQueueDisposition: z.enum(["clearQueueAndSend", "keepQueueAndSend"]).optional(),
    expectedHeldQueueItemIds: z.array(z.string().min(1)).optional(),
  }),
  stop: z.object({
    expectedForegroundExecutionId: z.string().min(1).optional(),
  }),
  compact: z.object({}),
  forkAssistant: z.object({ target: conversationRowTargetSchema }),
  applyFileRewind: z.object({ target: conversationRowTargetSchema }),
  editUserQuery: z
    .object({
    target: conversationRowTargetSchema,
    newText: z.string(),
      conversationQuotes: conversationQuotesSchema.optional(),
    attachments: z.array(attachmentRefSchema).optional(),
      modelSelection: modelSelectionSchema.optional(),
      modelExecution: modelExecutionSchema.optional(),
      highspeedMeta: highspeedMessageMetaSchema.optional(),
    workspaceMode: z.enum(["preserve", "rewind"]).optional(),
    })
    .superRefine(requireModelSelectionForExecution),
  retryTurn: z.object({ target: conversationRowTargetSchema }),
  setAssistantFeedback: z.object({
    target: conversationRowTargetSchema,
    feedback: z.enum(["like", "dislike"]).nullable(),
  }),
  setHighspeedMetrics: z.object({
    target: conversationRowTargetSchema,
    regularTps: z.number().positive(),
    outputTokens: z.number().int().nonnegative(),
    durationMs: z.number().nonnegative(),
    highspeedTps: z.number().positive(),
    savedDurationMs: z.number().nonnegative(),
    modelDurationMs: z.number().nonnegative().optional(),
    toolDurationMs: z.number().nonnegative().optional(),
    otherDurationMs: z.number().nonnegative().optional(),
  }),
  sendQueuedNow: z
    .object({
      queueItemId: z.string(),
      modelSelection: modelSelectionSchema.optional(),
      modelExecution: modelExecutionSchema.optional(),
      highspeedMeta: highspeedMessageMetaSchema.optional(),
    })
    .superRefine(requireModelSelectionForExecution),
  editQueueItem: z.object({ queueItemId: z.string(), newText: z.string() }),
  reorderQueueItem: z.object({
    queueItemId: z.string(),
    beforeQueueItemId: z.string().nullable(),
  }),
  deleteQueueItem: z.object({ queueItemId: z.string() }),
  setAutoDrain: z.object({ autoDrain: z.boolean() }),
  resolveInteraction: z.object({
    interactionId: z.string(),
    answer: z.object({
      optionId: z.string().optional(),
      freeText: z.string().optional(),
      action: z.enum(["accept", "decline", "cancel"]).optional(),
      content: z.record(z.string(), z.unknown()).optional(),
    }),
  }),
  respondWorkspaceHookReview: workspaceHookReviewCommandTargetSchema.extend({
    decision: workspaceHookReviewDecisionSchema,
  }),
  toggleWorkspaceHookReviewItem: workspaceHookReviewCommandTargetSchema.extend({
    reviewItemId: z.string().trim().min(1),
    enabled: z.boolean(),
  }),
  revokeWorkspaceHookTrust: z.union([
    workspaceHookReviewCommandTargetSchema.extend({
      reviewItemIds: z.array(z.string().trim().min(1)).min(1),
    }),
    workspaceHookTrustRevokeTargetSchema,
  ]),
  requestWorkspaceHookReview: requestWorkspaceHookReviewTargetSchema,
  snoozeInteractionAutoResolution: z.object({
    interactionId: z.string(),
  }),
  switchModelConfig: z.object({
    provider: z.string(),
    model: z.string(),
    thought: z.string(),
  }),
  switchCollaborationMode: z.object({
    mode: z.enum(["build", "edit", "plan", "yolo", "guarded"]),
  }),
  setFollowupMode: z.object({ mode: z.enum(["queue", "guide"]) }),
  pauseGoal: z.object({}),
  resumeGoal: z.object({}),
  cancelBackgroundWork: z.object({ workId: z.string() }),
  resumeWorkflowRun: z.object({ workId: z.string(), name: z.string().optional() }),
  startSavedWorkflow: z.object({
    name: z.string().min(1),
    scope: z.enum(["project", "global"]).optional(),
    args: z.record(z.string(), z.unknown()).optional(),
  }),
  amendWorkflowRunSettings: amendWorkflowRunSettingsPayloadSchema,
  renameSession: z.object({ title: z.string() }),
  deleteSession: z.object({}),
  discardSharedContext: z.object({ contextId: z.string().trim().min(1) }).strict(),
} as const;

export type CommandType = keyof typeof commandPayloadSchemas;
export type CommandPayloadMap = {
  [T in CommandType]: T extends "sendText"
    ? z.infer<(typeof commandPayloadSchemas)[T]> &
        import("../cf-task-types-core.js").CfBackgroundTurnAttribution
    : z.infer<(typeof commandPayloadSchemas)[T]>;
};

export const commandTypeSchema = z.enum(
  Object.keys(commandPayloadSchemas) as [CommandType, ...CommandType[]],
);

// not_running / cancel_not_supported。
export const BACKGROUND_WORK_CANCEL_REJECTED_FAULT_PREFIX =
  "fault.command.backgroundWorkCancelRejected." as const;

export const COMMANDS_REQUIRING_BASE_REVISION: ReadonlySet<CommandType> = new Set([
  "applyFileRewind",
  "forkAssistant",
  "editUserQuery",
  "retryTurn",
  "setAssistantFeedback",
  "sendQueuedNow",
  "editQueueItem",
  "reorderQueueItem",
  "deleteQueueItem",
  "setAutoDrain",
  "switchModelConfig",
  "switchCollaborationMode",
  "setFollowupMode",
  "pauseGoal",
  "resumeGoal",
]);

export const ROW_TARGETING_COMMANDS: ReadonlySet<CommandType> = new Set([
  "applyFileRewind",
  "forkAssistant",
  "editUserQuery",
  "retryTurn",
  "setAssistantFeedback",
  "setHighspeedMetrics",
]);

export const commandEnvelopeSchema = z.object({
  ttft: localTtftContextSchema.optional(),
  commandId: z.string(),
  clientId: z.string(),
  sessionId: z.string().nullable(),
  baseRevision: z.number().optional(),
  baseLogEpoch: z.string().trim().min(1).optional(),
  type: commandTypeSchema,
  payload: z.unknown(),
  issuedAt: timestampSchema,
});
export type CommandEnvelope = z.infer<typeof commandEnvelopeSchema>;

export function parseCommandEnvelope(
  value: unknown,
): { ok: true; envelope: CommandEnvelope } | { ok: false; error: z.ZodError } {
  const envelope = commandEnvelopeSchema.safeParse(value);
  if (!envelope.success) return { ok: false, error: envelope.error };
  const payload = commandPayloadSchemas[envelope.data.type].safeParse(envelope.data.payload);
  if (!payload.success) return { ok: false, error: payload.error };
  if (
    (COMMANDS_REQUIRING_BASE_REVISION.has(envelope.data.type) &&
      envelope.data.baseRevision === undefined) ||
    (ROW_TARGETING_COMMANDS.has(envelope.data.type) && envelope.data.baseLogEpoch === undefined)
  ) {
    return {
      ok: false,
      error: new z.ZodError([
        {
          code: "custom",
          path: [envelope.data.baseRevision === undefined ? "baseRevision" : "baseLogEpoch"],
          message: "CAS commands require baseRevision and baseLogEpoch",
        },
      ]),
    };
  }
  return {
    ok: true,
    envelope: { ...envelope.data, payload: payload.data },
  };
}

// ── ACK ──
export const commandResultSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.enum(["createSession", "createSelectionSideSession", "forkAssistant"]),
    sessionId: z.string(),
    input: z
      .object({
        delivery: z.enum(["startNow", "queue", "guide"]),
        inputId: z.string(),
        messageId: z.string().optional(),
      })
      .optional(),
  }),
  z.object({
    type: z.literal("resolveInteraction"),
    resolvedBy: z.object({
      clientId: z.string(),
      optionId: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal("applyFileRewind"),
    applied: z.boolean(),
    preview: v4ConversationFileRewindPreviewResultSchema,
    response: z.string(),
  }),
  z.object({
    type: z.literal("editUserQuery"),
    disposition: z.enum(["rewind", "fork", "blocked"]),
    sessionId: z.string().min(1),
    reasonCode: z.string().min(1).optional(),
    preview: v4ConversationFileRewindPreviewResultSchema.optional(),
  }),
  z.object({
    // startSavedWorkflow accepted ACK：
    type: z.literal("startSavedWorkflow"),
    runId: z.string().min(1),
    toolCallId: z.string().min(1),
  }),
  amendWorkflowRunSettingsResultSchema,
  z.object({
    type: z.literal("inputAccepted"),
    delivery: z.enum(["startNow", "queue", "guide"]),
    inputId: z.string(),
    messageId: z.string().optional(),
  }),
  z.object({
    type: z.literal("inputDisposition"),
    delivery: z.enum(["startNow", "queue", "guide"]),
  }),
]);
export type CommandResult = z.infer<typeof commandResultSchema>;

export const commandAckSchema = z.object({
  
  memoryEnabled: z.boolean().optional(),
  ttftExcluded: z.literal("capacity").optional(),
  commandId: z.string(),
  status: z.enum(["accepted", "rejected", "stale", "duplicate", "noop", "failed"]),
  reasonCode: z.string().optional(),
  message: z.string().optional(),
  revisionAtDecision: z.number(),
  result: commandResultSchema.optional(),
});
export type CommandAck = z.infer<typeof commandAckSchema>;

// ── commands/query ──
export const commandKeySchema = z
  .object({
    sessionId: z.string().nullable(),
    commandId: z.string().min(1),
  })
  .strict();
export type CommandKey = z.infer<typeof commandKeySchema>;

export const commandsQueryParamsSchema = z
  .object({
    commands: z.array(commandKeySchema).min(1).max(64),
    clock: z.literal(true).optional(),
  })
  .strict()
  .refine(
    (params) => !params.clock || params.commands.every((key) => key.sessionId === null),
    "clock probes cannot query session commands",
  );
export type CommandsQueryParams = z.infer<typeof commandsQueryParamsSchema>;

export const commandQueryItemSchema = z
  .object({
    key: commandKeySchema,
    result: z.union([commandAckSchema, z.literal("unknown")]),
  })
  .strict();
export type CommandQueryItem = z.infer<typeof commandQueryItemSchema>;

export const commandsQueryResultSchema = z
  .object({
    results: z.array(commandQueryItemSchema).min(1).max(64),
    clock: localTtftClockSchema.optional(),
  })
  .strict();
export type CommandsQueryResult = z.infer<typeof commandsQueryResultSchema>;
