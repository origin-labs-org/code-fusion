// ============================================================
// ============================================================

import { z } from "zod";

import { workflowRunArtifactSummarySchema } from "./workflow-artifacts.js";

export const WORKFLOW_RUNS_LIMITS = {
  
  maxRuns: 8,
  
  maxActors: 1_024,
  maxNodes: 1_024,
  
  maxTotalEntries: 6_144,
  
  maxReports: 64,
  maxReportPreviewLength: 2_048,
  maxResultPreviewLength: 2_048,
  maxErrorLength: 2_048,
  
  maxPendingQuestions: 32,
  
  maxQuestionLength: 2_048,
  
  maxConcurrencyKeyLength: 256,
  
  maxSubagentModelLength: 256,
  
  maxSessionIdLength: 256,
  
  maxConcurrencyCeiling: 1_024,
  
  maxActorNameLength: 128,
  
  maxArtifacts: 32,
  
  maxPhases: 32,
  
  maxPhaseNameLength: 128,
  
  maxHoles: 32,
  
  maxHoleTypeLength: 128,
  
  maxHolePromptLength: 500,
  
  maxInstructionsHeadLength: 240,
  
  maxLastToolNameLength: 64,
  
  maxLastToolTargetLength: 120,
} as const;

export const WORKFLOW_RUNS_LEGACY_LIMITS = {
  maxActors: 256,
  maxNodes: 256,
} as const;

export const workflowRunPhaseSchema = z.object({
  name: z.string().min(1).max(WORKFLOW_RUNS_LIMITS.maxPhaseNameLength),
  rounds: z.number().int().positive(),
});
export type WorkflowRunPhase = z.infer<typeof workflowRunPhaseSchema>;

export const workflowRunUnlistedPhaseSchema = z.object({
  phaseName: z.string().min(1).max(WORKFLOW_RUNS_LIMITS.maxPhaseNameLength).optional(),
  actors: z.number().int().nonnegative(),
  actorsSettled: z.number().int().nonnegative().optional(),
  actorsFailed: z.number().int().nonnegative().optional(),
  settled: z.number().int().nonnegative(),
});
export type WorkflowRunUnlistedPhase = z.infer<typeof workflowRunUnlistedPhaseSchema>;

export const workflowRunUsageSchema = z.object({
  spentTokens: z.number().int().nonnegative(),
  nodesUsed: z.number().int().nonnegative(),
  
  nodesUnlisted: z.number().int().nonnegative().optional(),
  nodesUnlistedSettled: z.number().int().nonnegative().optional(),
});
export type WorkflowRunUsage = z.infer<typeof workflowRunUsageSchema>;

export const workflowRunActorSchema = z.object({
  siteId: z.string().min(1).max(64),
  ordinal: z.number().int().nonnegative(),
  name: z.string().min(1).max(WORKFLOW_RUNS_LIMITS.maxActorNameLength).optional(),
  sessionId: z.string().min(1).max(WORKFLOW_RUNS_LIMITS.maxSessionIdLength).optional(),
  status: z.enum(["waiting", "running", "completed"]),
  
  phaseName: z.string().min(1).max(WORKFLOW_RUNS_LIMITS.maxPhaseNameLength).optional(),
  
  model: z.string().min(1).max(WORKFLOW_RUNS_LIMITS.maxSubagentModelLength).optional(),
});
export type WorkflowRunActor = z.infer<typeof workflowRunActorSchema>;

export const workflowRunNodeLastToolSchema = z.object({
  name: z.string().min(1).max(WORKFLOW_RUNS_LIMITS.maxLastToolNameLength),
  target: z.string().min(1).max(WORKFLOW_RUNS_LIMITS.maxLastToolTargetLength).optional(),
});
export type WorkflowRunNodeLastTool = z.infer<typeof workflowRunNodeLastToolSchema>;

export const workflowRunNodeSchema = z.object({
  siteId: z.string().min(1).max(64),
  ordinal: z.number().int().nonnegative(),
  kind: z.enum(["ask", "world-read"]).optional(),
  phase: z.enum(["queued", "dispatched", "executing", "waiting", "repairing", "nudged", "settled"]),
  outcome: z.enum(["ok", "failed", "cancelled"]).optional(),
  cached: z.boolean().optional(),
  
  actorSiteId: z.string().min(1).max(64).optional(),
  actorOrdinal: z.number().int().nonnegative().optional(),
  
  phaseName: z.string().min(1).max(WORKFLOW_RUNS_LIMITS.maxPhaseNameLength).optional(),
  
  instructionsHead: z
    .string()
    .min(1)
    .max(WORKFLOW_RUNS_LIMITS.maxInstructionsHeadLength)
    .optional(),
  
  turn: z.number().int().positive().optional(),
  toolCalls: z.number().int().nonnegative().optional(),
  lastTool: workflowRunNodeLastToolSchema.optional(),
});
export type WorkflowRunNode = z.infer<typeof workflowRunNodeSchema>;

export const workflowRunConcurrencySchema = z.object({
  key: z.string().min(1).max(WORKFLOW_RUNS_LIMITS.maxConcurrencyKeyLength).optional(),
  cap: z.number().int().positive(),
  ceiling: z.number().int().positive(),
  limit: z.number().int().positive().optional(),
  cooldownMs: z.number().int().nonnegative().optional(),
});
export type WorkflowRunConcurrency = z.infer<typeof workflowRunConcurrencySchema>;

export const workflowRunReportSchema = z.object({
  siteId: z.string().min(1).max(64),
  ordinal: z.number().int().nonnegative(),
  preview: z.string().max(WORKFLOW_RUNS_LIMITS.maxReportPreviewLength),
  
  artifactId: z.string().min(1).max(64).optional(),
});
export type WorkflowRunReport = z.infer<typeof workflowRunReportSchema>;

export const workflowRunPendingQuestionSchema = z.object({
  
  qid: z.string().min(1).max(128),
  actorSiteId: z.string().min(1).max(64).optional(),
  actorOrdinal: z.number().int().nonnegative().optional(),
  actorName: z.string().min(1).max(WORKFLOW_RUNS_LIMITS.maxActorNameLength).optional(),
  question: z.string().min(1).max(WORKFLOW_RUNS_LIMITS.maxQuestionLength),
  context: z.string().min(1).max(WORKFLOW_RUNS_LIMITS.maxQuestionLength).optional(),
  
  askedAt: z.number().int().nonnegative().optional(),
});
export type WorkflowRunPendingQuestion = z.infer<typeof workflowRunPendingQuestionSchema>;

export const workflowRunHoleSchema = z.object({
  siteId: z.string().min(1).max(64),
  ordinal: z.number().int().nonnegative(),
  name: z.string().min(1).max(WORKFLOW_RUNS_LIMITS.maxPhaseNameLength),
  type: z.string().min(1).max(WORKFLOW_RUNS_LIMITS.maxHoleTypeLength).optional(),
  
  prompt: z.string().min(1).max(WORKFLOW_RUNS_LIMITS.maxHolePromptLength).optional(),
  state: z.enum(["waiting", "filled"]),
  since: z.number().int().nonnegative().optional(),
  filledAt: z.number().int().nonnegative().optional(),
  filledBy: z.string().min(1).max(128).optional(),
});
export type WorkflowRunHole = z.infer<typeof workflowRunHoleSchema>;

export const workflowRunSchema = z.object({
  runId: z.string().min(1).max(128),
  
  toolCallId: z.string().min(1).max(128).optional(),
  status: z.enum(["pending", "running", "completed", "errored", "stopped"]),
  
  stopReason: z.enum(["user", "model", "provider", "interrupted", "superseded"]).optional(),
  
  resumedFrom: z.string().min(1).max(128).optional(),
  supersededBy: z.string().min(1).max(128).optional(),
  usage: workflowRunUsageSchema,
  error: z.string().min(1).max(WORKFLOW_RUNS_LIMITS.maxErrorLength).optional(),
  
  resumable: z.literal(true).optional(),
  resultPreview: z.string().max(WORKFLOW_RUNS_LIMITS.maxResultPreviewLength).optional(),
  actors: z.array(workflowRunActorSchema).max(WORKFLOW_RUNS_LIMITS.maxActors),
  nodes: z.array(workflowRunNodeSchema).max(WORKFLOW_RUNS_LIMITS.maxNodes),
  
  reports: z.array(workflowRunReportSchema).max(WORKFLOW_RUNS_LIMITS.maxReports).optional(),
  
  pendingQuestions: z
    .array(workflowRunPendingQuestionSchema)
    .max(WORKFLOW_RUNS_LIMITS.maxPendingQuestions)
    .optional(),
  
  concurrency: workflowRunConcurrencySchema.optional(),
  
  concurrencyCeiling: z
    .number()
    .int()
    .positive()
    .max(WORKFLOW_RUNS_LIMITS.maxConcurrencyCeiling)
    .optional(),
  
  subagentModel: z.string().min(1).max(WORKFLOW_RUNS_LIMITS.maxSubagentModelLength).optional(),
  
  artifacts: z
    .array(workflowRunArtifactSummarySchema)
    .max(WORKFLOW_RUNS_LIMITS.maxArtifacts)
    .optional(),
  
  phases: z.array(workflowRunPhaseSchema).max(WORKFLOW_RUNS_LIMITS.maxPhases).optional(),
  
  currentPhase: z.string().min(1).max(WORKFLOW_RUNS_LIMITS.maxPhaseNameLength).optional(),
  
  phaseNames: z
    .array(z.string().min(1).max(WORKFLOW_RUNS_LIMITS.maxPhaseNameLength))
    .max(WORKFLOW_RUNS_LIMITS.maxPhases)
    .optional(),
  
  phaseAlongside: z
    .array(z.array(z.number().int().nonnegative()).max(WORKFLOW_RUNS_LIMITS.maxPhases))
    .max(WORKFLOW_RUNS_LIMITS.maxPhases)
    .optional(),
  
  phaseHoles: z
    .array(z.number().int().nonnegative())
    .max(WORKFLOW_RUNS_LIMITS.maxPhases)
    .optional(),
  
  holes: z.array(workflowRunHoleSchema).max(WORKFLOW_RUNS_LIMITS.maxHoles).optional(),
  
  unlistedByPhase: z
    .array(workflowRunUnlistedPhaseSchema)
    .max(WORKFLOW_RUNS_LIMITS.maxPhases + 1)
    .optional(),
  
  truncated: z.boolean().optional(),
  
  lastEventSequence: z.number().int().nonnegative(),
});
export type WorkflowRunState = z.infer<typeof workflowRunSchema>;

export const workflowRunsStateSchema = z.object({
  revision: z.number().int().nonnegative(),
  runs: z.array(workflowRunSchema).max(WORKFLOW_RUNS_LIMITS.maxRuns),
});
export type WorkflowRunsState = z.infer<typeof workflowRunsStateSchema>;
