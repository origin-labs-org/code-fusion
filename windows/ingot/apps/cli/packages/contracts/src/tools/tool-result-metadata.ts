import { z } from "zod";
import { PersistedToolSearchContentSchema } from "./tool-search.js";
import { OFFICIAL_MCP_TOOL_ERROR_CODES } from "@origin-ai/cf-shared";
import {
  MCP_APPS_RESOURCE_URI_MAX_CHARS,
  MCP_APPS_CONTENT_MAX_BYTES,
  MCP_APPS_STRUCTURED_CONTENT_MAX_BYTES,
  MCP_APPS_SURFACE_ID_MAX_CHARS,
  MCP_APPS_SURFACE_ID_PATTERN,
  MCP_APPS_WIDGET_META_MAX_BYTES,
} from "@origin-ai/cf-shared/mcp-apps";

import {
  CREATE_WORKFLOW_DISPLAY_MAX_DIAGNOSTICS,
  CreateWorkflowCausalityGraphSchema,
  createWorkflowToolResultDisplayDiagnosticSchema,
} from "./create-workflow.js";
import {
  evalWorkflowSnippetToolResultDisplayPayloadSchema,
  getWorkflowRunToolResultDisplayPayloadSchema,
  listModelsToolResultDisplayPayloadSchema,
  listWorkflowRunsToolResultDisplayPayloadSchema,
  resumeWorkflowRunToolResultDisplayPayloadSchema,
  savedWorkflowListToolResultDisplayPayloadSchema,
} from "./workflow-observation-display.js";

export const COMPLETED_TOOL_PART_METADATA_SCHEMA_VERSION = 1;
export const TASK_OUTPUT_DISPLAY_MAX_STATUS_CHARS = 64;
export const TASK_OUTPUT_DISPLAY_MAX_OUTPUT_CHARS = 2_000;
export const MCP_TOOL_DISPLAY_MAX_NAME_CHARS = 256;
export const MCP_TOOL_DISPLAY_MAX_DESCRIPTION_CHARS = 4 * 1024;
export const CUA_TARGET_APP_DISPLAY_META_KEY = "cf.cua/target-app-display-v1" as const;

export const applicationIconLocatorSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("darwin-bundle-id"), value: z.string().trim().min(1).max(512) })
    .strict(),
  z
    .object({
      kind: z.literal("windows-executable-path"),
      value: z.string().trim().min(1).max(32_768),
    })
    .strict(),
  z.object({ kind: z.literal("windows-aumid"), value: z.string().trim().min(1).max(512) }).strict(),
]);

export const cuaTargetAppDisplaySchema = z
  .object({
    schemaVersion: z.literal(1),
    displayName: z.string().trim().min(1).max(512).optional(),
    iconLocators: z.array(applicationIconLocatorSchema).max(3),
  })
  .strict();

export const cuaRequestAccessStatusDisplaySchema = z
  .object({
    schemaVersion: z.literal(1),
    platform: z.literal("darwin"),
    grantOwner: z.string().trim().min(1).max(512),
    accessibility: z.enum(["granted", "stale", "denied"]),
    screenRecording: z.enum(["granted", "denied", "unknown"]),
  })
  .strict();

export const toolResultDisplayDiffHunkSchema = z
  .object({
    oldStart: z.number().int(),
    oldLines: z.number().int(),
    newStart: z.number().int(),
    newLines: z.number().int(),
    lines: z.array(z.string()),
  })
  .strict();

export const fileDiffToolResultDisplayPayloadSchema = z
  .object({
    kind: z.literal("file_diff"),
    filePath: z.string().min(1),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    structuredPatch: z.array(toolResultDisplayDiffHunkSchema),
    truncated: z.boolean().optional(),
  })
  .strict();

export const localAgentMessageToolResultDisplayPayloadSchema = z
  .object({
    kind: z.literal("local_agent_message"),
    status: z.enum(["success", "failed"]),
    error: z.string().optional(),
    message: z.string().optional(),
  })
  .strict();

export const taskStopToolResultDisplayPayloadSchema = z
  .object({
    kind: z.literal("task_stop"),
    taskId: z.string().min(1),
    taskType: z.string().min(1),
    command: z.string().min(1).optional(),
    message: z.string().min(1),
    truncated: z.boolean().optional(),
  })
  .strict();

export const taskOutputToolResultDisplayPayloadSchema = z
  .object({
    kind: z.literal("task_output"),
    retrievalStatus: z.enum(["success", "not_ready", "timeout"]),
    taskStatus: z.string().min(1).max(TASK_OUTPUT_DISPLAY_MAX_STATUS_CHARS).optional(),
    output: z.string().min(1).max(TASK_OUTPUT_DISPLAY_MAX_OUTPUT_CHARS).optional(),
    truncated: z.literal(true).optional(),
  })
  .strict();

export const respondToCoordinatorToolResultDisplayPayloadSchema = z
  .object({
    kind: z.literal("respond_to_coordinator"),
    status: z.enum(["success", "failed"]),
  })
  .strict();

export const cuaToolResultDisplayPayloadSchema = z
  .object({
    kind: z.literal("cua"),
    schemaVersion: z.literal(1),
    toolName: z.string().min(1),
    status: z.enum(["success", "failed"]),
    input: z.string().optional(),
    structuredContent: z.string().optional(),
    text: z.string().optional(),
    errorCode: z.string().optional(),
    suggestedAction: z.string().optional(),
    targetApp: cuaTargetAppDisplaySchema.optional(),
    permissionStatus: cuaRequestAccessStatusDisplaySchema.optional(),
    media: z
      .array(
        z
          .object({
            mimeType: z.string().min(1),
            data: z.string().min(1).max(349_528).optional(),
            artifactUri: z.string().min(1).optional(),
          })
          .strict(),
      )
      .max(4)
      .optional(),
    truncated: z.boolean().optional(),
  })
  .strict();

export const nodeReplCuaAppDisplaySchema = z
  .object({
    appKey: z.string().trim().min(1).max(2_048),
    displayName: z.string().trim().min(1).max(512).optional(),
  })
  .strict();

export const nodeReplImageToolResultDisplayPayloadSchema = z
  .object({
    kind: z.literal("node_repl_images"),
    images: z
      .array(
        z
          .object({
            base64: z
              .string()
              .min(1)
              .max(200 * 1024),
            mimeType: z.string().regex(/^image\/[a-z0-9.+-]+$/iu),
          })
          .strict(),
      )
      .min(1)
      .max(2)
      .optional(),
    app: nodeReplCuaAppDisplaySchema.optional(),
    truncated: z.boolean().optional(),
    source: z.literal("browser_turn_end").optional(),
  })
  .strict();

export const mcpToolDisplayUiPayloadSchema = z
  .object({
    pluginId: z.string().min(1).max(MCP_TOOL_DISPLAY_MAX_NAME_CHARS),
    resourceUri: z.string().min(1).max(MCP_APPS_RESOURCE_URI_MAX_CHARS),
    preferredDisplayMode: z.enum(["inline", "fullscreen", "pip"]).optional(),
    prefersBorder: z.boolean().optional(),
    csp: z
      .object({
        connectDomains: z.array(z.string().min(1).max(512)).optional(),
        resourceDomains: z.array(z.string().min(1).max(512)).optional(),
      })
      .strict()
      .optional(),
    structuredContent: z.string().max(MCP_APPS_STRUCTURED_CONTENT_MAX_BYTES).optional(),
    widgetMeta: z.string().max(MCP_APPS_WIDGET_META_MAX_BYTES).optional(),
    content: z.string().max(MCP_APPS_CONTENT_MAX_BYTES).optional(),
    truncated: z.boolean().optional(),
    truncatedBytes: z.number().int().nonnegative().optional(),
    isError: z.literal(true).optional(),
    showInline: z.literal(true).optional(),
    surface: z
      .string()
      .min(1)
      .max(MCP_APPS_SURFACE_ID_MAX_CHARS)
      .regex(MCP_APPS_SURFACE_ID_PATTERN)
      .optional(),
  })
  .strict();

export const mcpToolResultDisplayPayloadSchema = z
  .object({
    kind: z.literal("mcp_tool"),
    serverName: z.string().min(1).max(MCP_TOOL_DISPLAY_MAX_NAME_CHARS),
    toolName: z.string().min(1).max(MCP_TOOL_DISPLAY_MAX_NAME_CHARS),
    description: z.string().min(1).max(MCP_TOOL_DISPLAY_MAX_DESCRIPTION_CHARS).optional(),
    
    unavailable: z
      .object({ code: z.enum(OFFICIAL_MCP_TOOL_ERROR_CODES) })
      .strict()
      .optional(),
    ui: mcpToolDisplayUiPayloadSchema.optional(),
  })
  .strict();

export const createWorkflowToolResultDisplayPayloadSchema = z
  .object({
    kind: z.literal("create_workflow"),
    ok: z.boolean(),
    errorCount: z.number().int().nonnegative(),
    diagnostics: z
      .array(createWorkflowToolResultDisplayDiagnosticSchema)
      .max(CREATE_WORKFLOW_DISPLAY_MAX_DIAGNOSTICS),
    causalityGraph: CreateWorkflowCausalityGraphSchema.optional(),
    truncated: z.boolean().optional(),
  })
  .strict();

const bashOutputDisplaySchema = z
  .object({
    kind: z.literal("bash_output"),
    output: z.string().max(150_000),
    truncated: z.boolean(),
    outputPath: z.string().min(1).max(32_768).optional(),
  })
  .strict();

export const toolResultDisplayPayloadSchema = z.discriminatedUnion("kind", [
  bashOutputDisplaySchema,
  fileDiffToolResultDisplayPayloadSchema,
  localAgentMessageToolResultDisplayPayloadSchema,
  taskStopToolResultDisplayPayloadSchema,
  taskOutputToolResultDisplayPayloadSchema,
  respondToCoordinatorToolResultDisplayPayloadSchema,
  cuaToolResultDisplayPayloadSchema,
  nodeReplImageToolResultDisplayPayloadSchema,
  mcpToolResultDisplayPayloadSchema,
  createWorkflowToolResultDisplayPayloadSchema,
  getWorkflowRunToolResultDisplayPayloadSchema,
  listWorkflowRunsToolResultDisplayPayloadSchema,
  evalWorkflowSnippetToolResultDisplayPayloadSchema,
  savedWorkflowListToolResultDisplayPayloadSchema,
  listModelsToolResultDisplayPayloadSchema,
  resumeWorkflowRunToolResultDisplayPayloadSchema,
]);

export type FileDiffToolResultDisplayPayload = z.infer<
  typeof fileDiffToolResultDisplayPayloadSchema
>;
export type LocalAgentMessageToolResultDisplayPayload = z.infer<
  typeof localAgentMessageToolResultDisplayPayloadSchema
>;
export type TaskStopToolResultDisplayPayload = z.infer<
  typeof taskStopToolResultDisplayPayloadSchema
>;
export type TaskOutputToolResultDisplayPayload = z.infer<
  typeof taskOutputToolResultDisplayPayloadSchema
>;
export type RespondToCoordinatorToolResultDisplayPayload = z.infer<
  typeof respondToCoordinatorToolResultDisplayPayloadSchema
>;
export type CuaToolResultDisplayPayload = z.infer<typeof cuaToolResultDisplayPayloadSchema>;
export type ApplicationIconLocator = z.infer<typeof applicationIconLocatorSchema>;
export type CuaTargetAppDisplay = z.infer<typeof cuaTargetAppDisplaySchema>;
export type CuaRequestAccessStatusDisplay = z.infer<typeof cuaRequestAccessStatusDisplaySchema>;
export type NodeReplImageToolResultDisplayPayload = z.infer<
  typeof nodeReplImageToolResultDisplayPayloadSchema
>;
export type McpToolResultDisplayPayload = z.infer<typeof mcpToolResultDisplayPayloadSchema>;
export type CreateWorkflowToolResultDisplayPayload = z.infer<
  typeof createWorkflowToolResultDisplayPayloadSchema
>;
export type NodeReplCuaAppDisplay = z.infer<typeof nodeReplCuaAppDisplaySchema>;

export type ToolResultDisplayPayload = z.infer<typeof toolResultDisplayPayloadSchema>;

export const toolResultSerializationMetadataSchema = z
  .object({
    truncated: z.boolean(),
    originalBytes: z.number().int().nonnegative(),
    returnedBytes: z.number().int().nonnegative(),
    budgetStrategy: z.enum(["inline", "truncate", "artifact"]),
    artifactPath: z.string().min(1).optional(),
  })
  .strict();

export type ToolResultSerializationMetadata = z.infer<typeof toolResultSerializationMetadataSchema>;

export const completedToolPartMetadataSchema = z
  .object({
    modelContent: z.union([z.string(), PersistedToolSearchContentSchema]).optional(),
    schemaVersion: z.literal(COMPLETED_TOOL_PART_METADATA_SCHEMA_VERSION),
    display: toolResultDisplayPayloadSchema.optional(),
    serialization: toolResultSerializationMetadataSchema.optional(),
  })
  .passthrough();

export type CompletedToolPartMetadata = z.infer<typeof completedToolPartMetadataSchema>;

export function parseCompletedToolPartMetadata(
  input: unknown,
): CompletedToolPartMetadata | undefined {
  const scrubbed =
    isPlainRecord(input) && "display" in input
      ? { ...input, display: scrubPersistedDisplay(input.display) }
      : input;
  const result = completedToolPartMetadataSchema.safeParse(scrubbed);
  return result.success ? result.data : undefined;
}

export function parseToolResultDisplayPayload(
  input: unknown,
): ToolResultDisplayPayload | undefined {
  const result = toolResultDisplayPayloadSchema.safeParse(scrubPersistedDisplay(input));
  return result.success ? result.data : undefined;
}

function scrubPersistedDisplay(display: unknown): unknown {
  return stripProviderStopFromGetWorkflowRunError(stripWithdrawnRefinedNames(display));
}

function stripProviderStopFromGetWorkflowRunError(display: unknown): unknown {
  if (!isPlainRecord(display) || display.kind !== "get_workflow_run") return display;
  const error = display.error;
  if (!isPlainRecord(error) || !("providerStop" in error)) return display;
  const { providerStop: _dropped, ...rest } = error;
  return { ...display, error: rest };
}

function stripWithdrawnRefinedNames(display: unknown): unknown {
  if (!isPlainRecord(display) || display.kind !== "create_workflow") return display;
  const graph = display.causalityGraph;
  if (!isPlainRecord(graph)) return display;
  return {
    ...display,
    causalityGraph: {
      ...graph,
      ...("lanes" in graph ? { lanes: withoutKey(graph.lanes, "refinedName") } : {}),
      ...("steps" in graph ? { steps: withoutKey(graph.steps, "refinedLabel") } : {}),
      ...("phases" in graph ? { phases: withoutKey(graph.phases, "refinedName") } : {}),
    },
  };
}

function withoutKey(items: unknown, key: string): unknown {
  if (!Array.isArray(items)) return items;
  return items.map((item) => {
    if (!isPlainRecord(item) || !(key in item)) return item;
    const { [key]: _dropped, ...rest } = item;
    return rest;
  });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
