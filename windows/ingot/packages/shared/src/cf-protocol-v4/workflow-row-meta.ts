// ============================================================
// ============================================================

import { z } from "zod";
import { toolCallCreateWorkflowDisplaySchema } from "./create-workflow-display.js";
import { WORKFLOW_RUNS_LIMITS } from "./workflow-runs.js";

export const workflowNotificationMetaSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("terminal"),
    status: z.enum(["completed", "errored", "stopped"]),
    stopReason: z.enum(["user", "model", "provider", "interrupted", "superseded"]).optional(),
    summary: z.string().min(1).max(500),
    result: z.string().max(4000).optional(),
    resultForm: z.enum(["prose", "json"]).optional(),
    resultTruncated: z.literal(true).optional(),
    error: z.string().max(2000).optional(),
    reports: z
      .object({
        count: z.number().int().nonnegative(),
        shown: z.number().int().nonnegative(),
        preview: z.array(z.string().max(500)).max(8),
      })
      .optional(),
    artifacts: z
      .array(
        z.object({
          id: z.string().min(1).max(64),
          kind: z.enum(["file", "markdown", "chart", "table", "metrics", "board"]),
          title: z.string().max(120).optional(),
          version: z.number().int().positive(),
          contentType: z.string().max(255).optional(),
          primary: z.literal(true).optional(),
          description: z.string().max(500).optional(),
        }),
      )
      .max(8)
      .optional(),
    artifactsTruncated: z.literal(true).optional(),
    durationMs: z.number().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal("escalation"),
    qid: z.string().min(1),
    actor: z.string().min(1),
    question: z.string().min(1).max(4000),
    context: z.string().max(4000).optional(),
    askedAt: z.number().optional(),
  }),
  z.object({
    kind: z.literal("hole"),
    siteId: z.string().min(1).max(64),
    ordinal: z.number().int().nonnegative(),
    name: z.string().min(1).max(128),
    type: z.string().min(1).max(128),
    prompt: z.string().max(4000).optional(),
    draftPath: z.string().max(1024).optional(),
    line: z.number().int().positive().optional(),
    before: z.string().max(128).optional(),
    after: z.string().max(128).optional(),
    reachedAt: z.number().optional(),
  }),
  z.object({
    kind: z.literal("stall"),
    sinceMs: z.number().int().nonnegative(),
    reason: z.string().max(64).optional(),
    cap: z.number().int().nonnegative().optional(),
  }),
]);
export type WorkflowNotificationMeta = z.infer<typeof workflowNotificationMetaSchema>;

//
export const workflowBlockedMetaSchema = z.object({
  questions: z.number().int().nonnegative(),
  holes: z.number().int().nonnegative(),
  sinceMs: z.number().int().nonnegative(),
});
export type WorkflowBlockedMeta = z.infer<typeof workflowBlockedMetaSchema>;

export const backgroundResultOriginMetaSchema = z.object({
  backgroundSource: z.enum(["bash", "subagent", "workflow"]),
  workId: z.string().min(1),
  title: z.string().min(1),
  workflowNotification: workflowNotificationMetaSchema.optional(),
  workflowBlocked: workflowBlockedMetaSchema.optional().catch(undefined),
});
export type BackgroundResultOriginMeta = z.infer<typeof backgroundResultOriginMetaSchema>;

const workflowSubagentModelTextSchema = z
  .string()
  .min(1)
  .max(WORKFLOW_RUNS_LIMITS.maxSubagentModelLength);

export const workflowSettingsAmendMetaSchema = z.object({
  predecessorRunId: z.string().min(1).max(128).optional(),
  subagentModel: z
    .object({
      from: workflowSubagentModelTextSchema.optional(),
      to: workflowSubagentModelTextSchema.optional(),
    })
    .optional(),
  maxConcurrency: z
    .object({
      from: z.number().int().positive().optional(),
      to: z.number().int().positive().optional(),
    })
    .optional(),
  ceiling: z.number().int().positive().optional(),
});
export type WorkflowSettingsAmendMeta = z.infer<typeof workflowSettingsAmendMetaSchema>;

export const workflowLaunchMetaSchema = z.object({
  runId: z.string().min(1).max(128),
  toolCallId: z.string().min(1).max(128),
  name: z.string().min(1).max(200).optional(),
  scope: z.enum(["project", "global"]).optional(),
  path: z.string().min(1).max(1024).optional(),
  args: z
    .record(z.string(), z.unknown())
    .refine((value) => JSON.stringify(value).length <= 4096, {
      message: "workflowLaunch.args JSON must be ≤ 4096 bytes",
    })
    .optional(),
  description: z.string().max(500).optional(),
  display: toolCallCreateWorkflowDisplaySchema.optional().catch(undefined),
  script: z.string().max(256_000).optional(),
  amend: workflowSettingsAmendMetaSchema.optional(),
});
export type WorkflowLaunchMeta = z.infer<typeof workflowLaunchMetaSchema>;
