// ============================================================
// ============================================================

import { z } from "zod";

//
const namePatternSchema = z
  .object({
    head: z.string().min(1).max(128).optional(),
    tail: z.string().min(1).max(128).optional(),
  })
  .strict();

const workflowEdgeSchema = z
  .object({
    from: z.string().min(1).max(64),
    to: z.string().min(1).max(64),
    back: z.literal(true).optional(),
  })
  .strict();

const toolCallCreateWorkflowCausalityGraphSchema = z
  .object({
    steps: z
      .array(
        z
          .object({
            id: z.string().min(1).max(64),
            kind: z.enum(["ask", "world-read", "hole"]),
            label: z.string().min(1).max(128),
            labelPattern: namePatternSchema.optional(),
            line: z.number().int().positive().optional(),
            column: z.number().int().positive().optional(),
            lane: z.string().min(1).max(64),
            lanes: z.array(z.string().min(1).max(64)).max(32).optional(),
            source: z.string().min(1).max(64).optional(),
            phase: z.string().min(1).max(64).optional(),
            repeat: z.enum(["stack", "serial"]).optional(),
            fill: z.string().min(1).max(64).optional(),
          })
          .strict(),
      )
      .max(64),
    lanes: z
      .array(
        z
          .object({
            id: z.string().min(1).max(64),
            name: z.string().min(1).max(128).optional(),
            namePattern: namePatternSchema.optional(),
            line: z.number().int().positive().optional(),
            column: z.number().int().positive().optional(),
          })
          .strict(),
      )
      .max(32),
    participants: z
      .array(
        z
          .object({
            id: z.string().min(1).max(64),
            phase: z.string().min(1).max(64),
            lane: z.string().min(1).max(64),
            steps: z.array(z.string().min(1).max(64)).min(1).max(64),
            member: z
              .object({ index: z.number().int().nonnegative(), of: z.number().int().positive() })
              .strict()
              .optional(),
            many: z.literal(true).optional(),
          })
          .strict(),
      )
      .max(64),
    handoffs: z
      .array(
        workflowEdgeSchema
          .extend({ types: z.array(z.string().min(1).max(128)).min(1).max(8).optional() })
          .strict(),
      )
      .max(256),
    phases: z
      .array(
        z
          .object({
            id: z.string().min(1).max(64),
            name: z.string().min(1).max(128).optional(),
            line: z.number().int().positive().optional(),
            column: z.number().int().positive().optional(),
            alongside: z.array(z.string().min(1).max(64)).min(1).max(32).optional(),
            fill: z.string().min(1).max(64).optional(),
          })
          .strict(),
      )
      .max(32)
      .optional(),
    phaseEdges: z.array(workflowEdgeSchema).max(128).optional(),
    phaseStreams: z
      .array(z.object({ from: z.string().min(1).max(64), to: z.string().min(1).max(64) }).strict())
      .max(128)
      .optional(),
    holes: z
      .array(
        z
          .object({
            siteId: z.string().min(1).max(64),
            name: z.string().min(1).max(128),
            type: z.string().min(1).max(128),
            phase: z.string().min(1).max(64).optional(),
            tail: z.boolean().optional(),
          })
          .strict(),
      )
      .max(32)
      .optional(),
    exits: z.array(z.string().min(1).max(64)).max(32).optional(),
    sink: z.array(z.string().min(1).max(64)).max(64).optional(),
    truncated: z.boolean().optional(),
  })
  .strict();
export type ToolCallCreateWorkflowCausalityGraph = z.infer<
  typeof toolCallCreateWorkflowCausalityGraphSchema
>;

export const toolCallCreateWorkflowDisplaySchema = z
  .object({
    kind: z.literal("create_workflow"),
    ok: z.boolean(),
    errorCount: z.number().int().nonnegative(),
    diagnostics: z
      .array(
        z
          .object({
            line: z.number().int().nonnegative(),
            column: z.number().int().nonnegative(),
            code: z.number().int().nonnegative(),
            message: z.string().min(1).max(2_048),
          })
          .strict(),
      )
      .max(100),
    causalityGraph: toolCallCreateWorkflowCausalityGraphSchema.optional(),
    truncated: z.boolean().optional(),
    fill: z
      .object({
        siteId: z.string().min(1).max(64),
        name: z.string().min(1).max(128),
        draftPath: z.string().min(1).max(1_024).optional(),
        line: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type ToolCallCreateWorkflowDisplay = z.infer<typeof toolCallCreateWorkflowDisplaySchema>;
