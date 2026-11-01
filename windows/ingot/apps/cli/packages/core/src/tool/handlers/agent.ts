// ============================================================
// Agent Tool Handler
// ============================================================

import {
  AgentErrorCode,
  AgentInputJsonSchema,
  AgentInputSchema,
  AgentOutputSchema,
  AgentType,
  CoreErrorType,
  createCoreError,
  type AgentInput,
  type AgentOutput,
  type TraceContext,
} from "@origin-ai/cf-contracts";
import { AGENT_TOOL_NAME, TASK_TOOL_NAME } from "../compat.js";
import type { ToolEntry, ToolHandler } from "../types.js";

const MAX_AGENT_MODEL_BYTES = 120_000;

const AGENT_TOOL_OUTPUT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  oneOf: [
    {
      type: "object",
      properties: {
        status: { const: "completed", type: "string" },
        agentId: { type: "string" },
        agentType: { type: "string" },
        prompt: { type: "string" },
        content: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { const: "text", type: "string" },
              text: { type: "string" },
            },
            required: ["type", "text"],
            additionalProperties: false,
          },
        },
        totalToolUseCount: { type: "integer", minimum: 0 },
        totalDurationMs: { type: "integer", minimum: 0 },
        totalTokens: { type: "integer", minimum: 0 },
        usage: { type: "object", additionalProperties: true },
      },
      required: ["status", "agentId", "prompt", "content", "totalToolUseCount", "totalDurationMs"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        status: { const: "async_launched", type: "string" },
        agentId: {
          type: "string",
          description: "The ID of the async agent",
        },
        description: {
          type: "string",
          description: "The description of the task",
        },
        prompt: {
          type: "string",
          description: "The prompt for the agent",
        },
        outputFile: {
          type: "string",
          description: "Path to the output file for checking agent progress",
        },
        canReadOutputFile: {
          type: "boolean",
          description: "Whether the calling agent has Read/Bash tools to check progress",
        },
      },
      required: ["status", "agentId", "description", "prompt", "outputFile"],
      additionalProperties: false,
    },
  ],
};

function buildAgentProviderDescription(
  options: {
    dynamicWorkflowEnabled?: boolean;
  } = {},
): string {
  return [
    "Launch a new agent to handle complex, multi-step tasks. Each agent type has specific capabilities and tools available to it.",
    "",
    "Available agent types are listed in <system-reminder> messages in the conversation.",
    "",
    "When using the Agent tool, specify a subagent_type parameter to select which agent type to use. If omitted, the general-purpose agent is used.",
    "",
    "## When to use",
    "",
    "Reach for this when the task matches an available agent type, when you have independent work to run in parallel, or when answering would mean reading across several files — delegate it and you keep the conclusion, not the file dumps. For a single-fact lookup where you already know the file, symbol, or value, search directly. Once you've delegated a search, don't also run it yourself — wait for the result.",
    "",
    "- The agent's final message is returned to you as the tool result; it is not shown to the user — relay what matters.",
    "- Use SendMessage with the agent's ID to continue a previously spawned agent with its context intact; a new Agent call starts fresh.",
    "- Each agent type's model, reasoning effort, and tools come from its definition in `.cf/agents/`; the Agent tool inherits them.",
  ].join("\n");
}

export const agentToolEntry: ToolEntry = {
  capability: "Launch a subagent to handle complex, multi-step tasks",
  metadata: {
    name: AGENT_TOOL_NAME,
    description: buildAgentProviderDescription(),
    readOnly: false,
    destructive: false,
    concurrentSafe: true,
    sideEffectScope: "session",
    riskLevel: "medium",
    needsApproval: false,
  },
  handler: unavailableAgentHandler,
  inputSchema: AgentInputJsonSchema,
  outputSchema: AGENT_TOOL_OUTPUT_SCHEMA,
  timeout: { kind: "none" },
  cancellation: {
    supported: true,
    cleanup: "none",
    userVisibleMessage: "The Agent tool call was cancelled before the subagent replied",
  },
  permission: {
    permission: "agent.dispatch",
    reason: "spawns a subagent that can read and modify the workspace",
    riskLevel: "medium",
    sideEffectScope: "session",
    needsApproval: false,
    patternSources: ["toolName"],
    alwaysAllowPatternSources: ["toolName"],
    denyPriority: "beforeAsk",
  },
  resultBudget: {
    maxInlineBytes: MAX_AGENT_MODEL_BYTES,
    maxModelBytes: MAX_AGENT_MODEL_BYTES,
    strategy: "truncate",
    preview: { maxBytes: MAX_AGENT_MODEL_BYTES, direction: "head" },
  },
  trace: {
    required: true,
    propagateToAdapters: true,
    recordInput: "summary",
    recordOutput: "summary",
  },
};

async function unavailableAgentHandler(): Promise<{ error: string }> {
  return {
    error:
      "The Agent tool handler was lost when the rebrand pass truncated core/src/tool/handlers/agent.ts. Restore the upstream file to re-enable subagent dispatch.",
  };
}

export function createAgentToolEntry(
  options: {
    dynamicWorkflowEnabled?: boolean;
  } = {},
): ToolEntry {
  return {
    ...agentToolEntry,
    metadata: {
      ...agentToolEntry.metadata,
      description: buildAgentProviderDescription(options),
    },
  };
}

export function createTaskToolEntry(
  options: {
    dynamicWorkflowEnabled?: boolean;
  } = {},
): ToolEntry {
  const entry = createAgentToolEntry(options);
  return {
    ...entry,
    metadata: {
      ...entry.metadata,
      name: TASK_TOOL_NAME,
    },
  };
}

export const taskToolEntry: ToolEntry = createTaskToolEntry();
