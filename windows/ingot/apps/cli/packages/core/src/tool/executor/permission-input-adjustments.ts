// ============================================================
// ============================================================
// docs/dynamic-workflow/launch.md「Adjusting the settings in the window」。
//

import { traceContextToLogContext, type TraceContext } from "@origin-ai/cf-contracts";
import type {
  ExecutableToolCall,
  ToolEntry,
  ToolExecutionResult,
  ToolInputResolutionContext,
} from "../types.js";
import {
  createErrorResult,
  createToolHandlerFailureError,
  isToolHandlerFailure,
} from "./errors.js";
import type { ToolExecutorDeps } from "./types.js";

export type PermissionInputAdjustmentOutcome =
  | { ok: true; executionInput: unknown; applied?: Readonly<Record<string, unknown>> }
  | { ok: false; result: ToolExecutionResult };

export function buildToolInputResolutionContext(
  deps: ToolExecutorDeps,
): ToolInputResolutionContext {
  const workingDirectory = deps.getWorkingDirectory?.();
  return {
    ...(workingDirectory === undefined ? {} : { workingDirectory }),
    runtimeTaskRegistry: deps.runtimeTaskRegistry,
    ...(deps.dynamicWorkflowRunPort === undefined
      ? {}
      : { dynamicWorkflowRunPort: deps.dynamicWorkflowRunPort }),
    ...(deps.modelCatalogPort === undefined ? {} : { modelCatalogPort: deps.modelCatalogPort }),
    sessionId: deps.sessionId,
    ...(deps.hasLoadedSkill === undefined ? {} : { hasLoadedSkill: deps.hasLoadedSkill }),
  };
}

export function applyPermissionInputAdjustments(options: {
  deps: ToolExecutorDeps;
  entry: ToolEntry;
  toolCall: ExecutableToolCall;
  executionInput: unknown;
  adjustments: Readonly<Record<string, unknown>> | undefined;
  traceContext: TraceContext;
}): PermissionInputAdjustmentOutcome {
  const { adjustments, deps, entry, executionInput, toolCall, traceContext } = options;
  if (adjustments === undefined || Object.keys(adjustments).length === 0) {
    return { ok: true, executionInput };
  }
  const logContext = {
    ...traceContextToLogContext(traceContext),
    adjustedKeys: Object.keys(adjustments),
    module: "core.tool.executor",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
  };
  if (!entry.applyInputAdjustments) {
    deps.logger?.warn("Permission input adjustments ignored: the tool does not apply them", {
      ...logContext,
      event: "tool.permission.input_adjustments_ignored",
      status: "completed",
    });
    return { ok: true, executionInput };
  }
  const outcome = entry.applyInputAdjustments(
    executionInput,
    adjustments,
    buildToolInputResolutionContext(deps),
  );
  if (isToolHandlerFailure(outcome)) {
    deps.logger?.warn("Permission input adjustments rejected", {
      ...logContext,
      errorCode: outcome.errorCode,
      event: "tool.permission.input_adjustments_rejected",
      status: "failed",
    });
    return {
      ok: false,
      result: createErrorResult(toolCall, createToolHandlerFailureError(toolCall, outcome)),
    };
  }
  deps.logger?.info("Permission input adjustments applied", {
    ...logContext,
    appliedKeys: Object.keys(outcome.applied ?? {}),
    event: "tool.permission.input_adjustments_applied",
    status: "completed",
  });
  return {
    ok: true,
    executionInput: outcome.input,
    ...(outcome.applied === undefined ? {} : { applied: outcome.applied }),
  };
}
