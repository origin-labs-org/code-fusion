import { z } from "zod";
import { timestampSchema } from "./core.js";
import { sessionWorkflowActivitySchema } from "./sessions-index-workflow-activity.js";
import {
  goalStateSchema,
  interactionAutoResolutionSchema,
  sessionMetaStateSchema,
  sessionPhaseSchema,
} from "./snapshot.js";

export const sessionPendingInteractionSummarySchema = z.object({
  interactionId: z.string(),
  kind: z.enum(["permission", "userInput"]),
  toolName: z.string().optional(),
  autoResolution: interactionAutoResolutionSchema.optional(),
});
export type SessionPendingInteractionSummary = z.infer<
  typeof sessionPendingInteractionSummarySchema
>;

export const pendingInteractionSummarySchema = z.object({
  permissionCount: z.number().int().nonnegative(),
  userInputCount: z.number().int().nonnegative(),
});
export type PendingInteractionSummary = z.infer<typeof pendingInteractionSummarySchema>;

export const sessionSummarySchema = z.object({
  sessionId: z.string(),
  workspaceId: z.string(),
  parentSessionId: z.string().optional(),
  title: z.string(),
  titleSource: sessionMetaStateSchema.shape.titleSource.optional(),
  lastOutcome: z.enum(["completed", "error", "interrupted"]).optional(),
  phase: sessionPhaseSchema,
  sessionEnded: z.boolean(),
  hasBackgroundWork: z.boolean(),
  workflowActivity: sessionWorkflowActivitySchema.optional(),
  pendingInteraction: sessionPendingInteractionSummarySchema.optional(),
  pendingInteractionSummary: pendingInteractionSummarySchema.optional(),
  goalStatus: goalStateSchema.shape.status.optional(),
  lastActivityAt: timestampSchema,
  lastAssistantPreview: z.string().optional(),
  createdAt: timestampSchema,
});
export type SessionSummary = z.infer<typeof sessionSummarySchema>;

export const sessionsIndexSnapshotSchema = z.object({
  protocolVersion: z.literal(1),
  workspaceId: z.string(),
  logEpoch: z.string(),
  sessions: z.array(sessionSummarySchema),
});
export type SessionsIndexSnapshot = z.infer<typeof sessionsIndexSnapshotSchema>;

export const sessionsIndexDeltaSchema = z.discriminatedUnion("op", [
  // conflation key = sessionId。
  z.object({ op: z.literal("session.upserted"), session: sessionSummarySchema }),
  z.object({ op: z.literal("session.removed"), sessionId: z.string() }),
]);
export type SessionsIndexDelta = z.infer<typeof sessionsIndexDeltaSchema>;

export const sessionsIndexReconcileParamsSchema = z
  .object({
    workspaceId: z.string().min(1),
    sessionIds: z.array(z.string().min(1)).max(256),
  })
  .strict();
export type SessionsIndexReconcileParams = z.infer<typeof sessionsIndexReconcileParamsSchema>;
export const sessionsIndexReconcileResultSchema = z
  .object({
    sessions: z
      .array(
        z.discriminatedUnion("exists", [
          z
            .object({ sessionId: z.string(), exists: z.literal(false), deleted: z.literal(false) })
            .strict(),
          z
            .object({
              sessionId: z.string(),
              exists: z.literal(true),
              deleted: z.boolean(),
              title: z.string(),
              titleSource: sessionMetaStateSchema.shape.titleSource,
              createdAt: timestampSchema,
              updatedAt: timestampSchema,
              lastOutcome: z.enum(["completed", "error", "interrupted"]).optional(),
            })
            .strict(),
        ]),
      )
      .max(256),
  })
  .strict();
export type SessionsIndexReconcileResult = z.infer<typeof sessionsIndexReconcileResultSchema>;

export function sessionsIndexTopic(workspaceId: string): string {
  return `sessions-index/${workspaceId}`;
}

export function parseSessionsIndexTopic(topic: string): string | null {
  if (!topic.startsWith("sessions-index/")) return null;
  const workspaceId = topic.slice("sessions-index/".length);
  return workspaceId.length > 0 ? workspaceId : null;
}
