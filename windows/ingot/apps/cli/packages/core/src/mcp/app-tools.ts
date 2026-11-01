
import type { JsonSchema, McpToolCallResult, McpToolDescriptor } from "@origin-ai/cf-contracts";
import {
  MCP_APPS_APP_TOOL_CALL_TIMEOUT_MS,
  MCP_APPS_APP_TOOL_CLAIM_TIMEOUT_MS,
} from "@origin-ai/cf-shared/mcp-apps";
import type { ToolEntry, ToolExecutionContext } from "../tool/types.js";
import { normalizeMcpToolResultForModel } from "./image-normalization.js";
import { McpToolOutputJsonSchema, formatMcpToolResult } from "./index.js";

export const MCP_APP_PROVIDED_TOOL_ENTRY_TIMEOUT_MS =
  MCP_APPS_APP_TOOL_CLAIM_TIMEOUT_MS + MCP_APPS_APP_TOOL_CALL_TIMEOUT_MS + 5_000;

export interface McpAppProvidedToolDefinition {
  retainExecution?: ToolEntry["retainExecution"];
  
  modelName: string;
  serverName: string;
  
  pluginId: string;
  
  scopeId: string;
  generation: number;
  
  toolName: string;
  title?: string;
  description?: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
}

export type McpAppProvidedToolExecutor = (
  call: {
    definition: McpAppProvidedToolDefinition;
    arguments: Record<string, unknown>;
    toolCallId: string;
  },
  options: { signal: AbortSignal },
) => Promise<McpToolCallResult>;

export function createMcpAppProvidedToolEntry(
  definition: McpAppProvidedToolDefinition,
  execute: McpAppProvidedToolExecutor,
): ToolEntry {
  const readOnly = definition.readOnlyHint === true;
  const destructive = definition.destructiveHint === true;
  const needsApproval = !readOnly;
  const riskLevel = destructive ? "high" : readOnly ? "low" : "medium";
  const source = `the ${definition.serverName} app page`;
  const description = [
    definition.title && definition.title !== definition.toolName ? definition.title : undefined,
    definition.description,
    `(Tool provided by ${source}; available only while the app is open.)`,
  ]
    .filter((part): part is string => Boolean(part))
    .join("\n\n");
  const pseudoDescriptor: McpToolDescriptor = {
    serverName: definition.serverName,
    toolName: definition.toolName,
    name: definition.modelName,
    inputSchema: definition.inputSchema,
  };

  return {
    retainExecution: definition.retainExecution,
    capability: `App tool ${definition.toolName} provided by ${source}`,
    inputSchema: normalizeObjectSchema(definition.inputSchema),
    outputSchema: McpToolOutputJsonSchema,
    metadata: {
      concurrentSafe: readOnly || definition.idempotentHint === true,
      destructive,
      description,
      name: definition.modelName,
      mcpPresentation: {
        serverName: definition.serverName,
        toolName: definition.toolName,
        ...(definition.description ? { description: definition.description } : {}),
        pluginId: definition.pluginId,
      },
      needsApproval,
      readOnly,
      riskLevel,
      sideEffectScope: "network",
      timeoutMs: MCP_APP_PROVIDED_TOOL_ENTRY_TIMEOUT_MS,
    },
    permission: {
      permission: "mcp",
      reason: `App tool "${definition.toolName}" provided by ${source}`,
      riskLevel,
      sideEffectScope: "network",
      needsApproval,
      patternSources: ["toolName", "input"],
      denyPriority: "beforeAsk",
      askOptions: { allowAlways: "session" },
    },
    resultBudget: {
      maxInlineBytes: 100_000,
      maxModelBytes: 50_000,
      strategy: "truncate",
      preview: { direction: "head" },
    },
    timeout: {
      defaultMs: MCP_APP_PROVIDED_TOOL_ENTRY_TIMEOUT_MS,
      allowCallOverride: false,
    },
    cancellation: {
      supported: true,
      cleanup: "bestEffort",
      userVisibleMessage: `App tool ${definition.modelName} was cancelled`,
    },
    trace: {
      required: true,
      propagateToAdapters: false,
      recordInput: "summary",
      recordOutput: "summary",
    },
    handler: async (input: unknown, context: ToolExecutionContext) => {
      const args =
        input && typeof input === "object" && !Array.isArray(input)
          ? (input as Record<string, unknown>)
          : {};
      const result = await execute(
        { definition, arguments: args, toolCallId: context.toolCallId },
        { signal: context.abortSignal },
      );
      return normalizeMcpToolResultForModel({
        compressOversizedImages: false,
        context,
        descriptor: pseudoDescriptor,
        result,
        toolName: definition.modelName,
      });
    },
    formatModelContent: (output) => formatMcpToolResult(output),
  };
}

function normalizeObjectSchema(schema: JsonSchema): JsonSchema {
  return {
    ...schema,
    type: "object",
    properties:
      schema.properties &&
      typeof schema.properties === "object" &&
      !Array.isArray(schema.properties)
        ? schema.properties
        : {},
  };
}
