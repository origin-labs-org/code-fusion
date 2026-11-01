import {
  traceContextToLogContext,
  type PermissionOptionsPolicy,
  type ToolResultDisplayPayload,
  type TraceContext,
} from "@origin-ai/cf-contracts";
import type { ExecutableToolCall, ToolEntry } from "../types.js";
import type { ToolExecutorDeps } from "./types.js";

interface ResolvedToolApproval {
  gate: "ask" | "proceed";
  display?: ToolResultDisplayPayload;
  optionsPolicy?: PermissionOptionsPolicy;
}

function resolveOptionsPolicy(
  allowAlways: false | "session" | undefined,
): PermissionOptionsPolicy | undefined {
  switch (allowAlways) {
    case false:
      return "no-always-allow";
    case "session":
      return "session-always-allow";
    default:
      return undefined;
  }
}

export function resolveToolApproval(
  deps: ToolExecutorDeps,
  toolCall: ExecutableToolCall,
  entry: ToolEntry,
  executionInput: unknown,
  traceContext: TraceContext,
): ResolvedToolApproval {
  const optionsPolicy = resolveOptionsPolicy(entry.permission?.askOptions?.allowAlways);

  if (!entry.prepareApproval) {
    return { gate: "ask", ...(optionsPolicy ? { optionsPolicy } : {}) };
  }

  try {
    const gate = entry.prepareApproval(executionInput);
    if (gate.gate === "proceed") return { gate: "proceed" };
    return {
      gate: "ask",
      ...(gate.display ? { display: gate.display } : {}),
      ...(optionsPolicy ? { optionsPolicy } : {}),
    };
  } catch (error) {
    deps.logger?.warn("Tool approval preview failed; asking without a preview", {
      ...traceContextToLogContext(traceContext),
      error: error instanceof Error ? error.message : String(error),
      event: "tool.permission.approval_preview_failed",
      module: "core.tool.executor",
      status: "failed",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
    });
    return { gate: "ask", ...(optionsPolicy ? { optionsPolicy } : {}) };
  }
}
