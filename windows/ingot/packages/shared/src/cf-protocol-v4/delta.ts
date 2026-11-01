import { mcpAppInstanceSchema } from "../mcp-apps/instance.js";
//
import { z } from "zod";
import { streamablePathSchema } from "./core.js";
import { conversationRowSchema } from "./rows.js";
import { sharedContextImportStateSchema } from "./shared-context-import.js";
import {
  backgroundWorkSummarySchema,
  commandStateSummarySchema,
  goalStateSchema,
  inputRoutingSchema,
  pendingInteractionSchema,
  planStateSchema,
  queueStateSchema,
  runtimeInitializationSchema,
  sessionActionAvailabilitySchema,
  sessionConfigStateSchema,
  sessionControlSchema,
  sessionMetaStateSchema,
  sessionModelTransitionSchema,
  sessionUsageStateSchema,
  subagentProjectionStateSchema,
  workspaceHookAdmissionStateSchema,
} from "./snapshot.js";
import {
  WORKFLOW_RUNS_LIMITS,
  workflowRunActorSchema,
  workflowRunNodeSchema,
  workflowRunSchema,
  workflowRunsStateSchema,
} from "./workflow-runs.js";

export const statePatchSchema = z.object({
  runtimeInitialization: runtimeInitializationSchema.optional(),
  revision: z.number().optional(),
  control: sessionControlSchema.optional(),
  sharedContextImport: sharedContextImportStateSchema.optional(),
  availability: sessionActionAvailabilitySchema.optional(),
  inputRouting: inputRoutingSchema.optional(),
  meta: sessionMetaStateSchema.optional(),
  config: sessionConfigStateSchema.optional(),
  modelTransition: sessionModelTransitionSchema.nullable().optional(),
  usage: sessionUsageStateSchema.optional(),
  queue: queueStateSchema.optional(),
  pendingInteractions: z.array(pendingInteractionSchema).optional(),
  pendingCommands: z.array(commandStateSummarySchema).optional(),
  backgroundWorks: z.array(backgroundWorkSummarySchema).optional(),
  subagents: subagentProjectionStateSchema.optional(),
  workflowRuns: workflowRunsStateSchema.optional(),
  goal: goalStateSchema.nullable().optional(),
  plan: planStateSchema.nullable().optional(),
  workspaceHookAdmission: workspaceHookAdmissionStateSchema.nullable().optional(),
});
export type StatePatch = z.infer<typeof statePatchSchema>;

export const pluginUiResourceSubscriberSchema = z
  .object({
    scopeId: z.string(),
    generation: z.number().int().nonnegative(),
    instance: mcpAppInstanceSchema,
  })
  .strict();

export const workflowRunHeaderSchema = workflowRunSchema.omit({ actors: true, nodes: true });
export type WorkflowRunHeader = z.infer<typeof workflowRunHeaderSchema>;

export const workflowRunHeaderPatchSchema = workflowRunHeaderSchema.partial();
export type WorkflowRunHeaderPatch = z.infer<typeof workflowRunHeaderPatchSchema>;

export const workflowRunHeaderKeySchema = workflowRunHeaderSchema.keyof();
export type WorkflowRunHeaderKey = z.infer<typeof workflowRunHeaderKeySchema>;

export const workflowRunEntryRefSchema = workflowRunActorSchema.pick({
  siteId: true,
  ordinal: true,
});
export type WorkflowRunEntryRef = z.infer<typeof workflowRunEntryRefSchema>;

export const conversationDeltaSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("row.appended"), row: conversationRowSchema }),
  z.object({ op: z.literal("row.upserted"), row: conversationRowSchema }),
  z.object({ op: z.literal("row.removed"), fromRowId: z.number() }),
  z.object({
    op: z.literal("row.delta"),
    rowId: z.number(),
    path: streamablePathSchema,
    append: z.string(),
  }),
  z.object({ op: z.literal("state.updated"), patch: statePatchSchema }),
  z.object({
    op: z.literal("pluginUi.resourceUpdated"),
    pluginId: z.string(),
    serverName: z.string(),
    uri: z.string(),
    subscribers: z.array(pluginUiResourceSubscriberSchema),
  }),
  z.object({
    op: z.literal("pluginUi.resourceListChanged"),
    pluginId: z.string(),
    serverName: z.string(),
    subscribers: z.array(pluginUiResourceSubscriberSchema),
  }),
  z.object({
    op: z.literal("pluginUi.instanceClosed"),
    pluginId: z.string(),
    serverName: z.string(),
    subscribers: z.array(pluginUiResourceSubscriberSchema),
  }),
  z.object({
    op: z.literal("pluginUi.appToolCall"),
    activity: z.boolean().optional(),
    cancelled: z.boolean().optional(),
    pluginId: z.string(),
    serverName: z.string(),
    subscribers: z.array(pluginUiResourceSubscriberSchema),
    callId: z.string(),
    toolName: z.string(),
    arguments: z.record(z.string(), z.unknown()),
  }),
  
  z.object({
    op: z.literal("workflowRun.updated"),
    runId: workflowRunSchema.shape.runId,
    revision: workflowRunsStateSchema.shape.revision,
    run: workflowRunHeaderPatchSchema.optional(),
    cleared: z
      .array(workflowRunHeaderKeySchema)
      .max(workflowRunHeaderKeySchema.options.length)
      .optional(),
    removedActors: z
      .array(workflowRunEntryRefSchema)
      .max(WORKFLOW_RUNS_LIMITS.maxActors)
      .optional(),
    removedNodes: z.array(workflowRunEntryRefSchema).max(WORKFLOW_RUNS_LIMITS.maxNodes).optional(),
    actors: z.array(workflowRunActorSchema).max(WORKFLOW_RUNS_LIMITS.maxActors).optional(),
    nodes: z.array(workflowRunNodeSchema).max(WORKFLOW_RUNS_LIMITS.maxNodes).optional(),
  }),
  
  z.object({
    op: z.literal("workflowRun.removed"),
    runId: workflowRunSchema.shape.runId,
    revision: workflowRunsStateSchema.shape.revision,
  }),
]);
export type ConversationDelta = z.infer<typeof conversationDeltaSchema>;
export type PluginUiResourceDelta = Extract<
  ConversationDelta,
  { op: "pluginUi.resourceUpdated" | "pluginUi.resourceListChanged" }
>;
export type PluginUiAppToolCallDelta = Extract<ConversationDelta, { op: "pluginUi.appToolCall" }>;

export type PluginUiInstanceDelta =
  | Extract<ConversationDelta, { op: "pluginUi.instanceClosed" }>
  | PluginUiResourceDelta
  | PluginUiAppToolCallDelta;
export type WorkflowRunUpdatedDelta = Extract<ConversationDelta, { op: "workflowRun.updated" }>;
export type WorkflowRunRemovedDelta = Extract<ConversationDelta, { op: "workflowRun.removed" }>;
