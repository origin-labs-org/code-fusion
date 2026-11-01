import {
  isAutomationCreateLimitError,
  CoreErrorType,
  AMEND_WORKFLOW_TOOL_NAME,
  CREATE_WORKFLOW_TOOL_NAME,
  EXIT_PLAN_MODE_TOOL_NAME,
  type CollaborationMode,
} from "@origin-ai/cf-contracts";
import type { ToolEntry, ToolExecutionResult } from "../types.js";

const DEFAULT_EXIT_PLAN_DENIED_MESSAGE = `Permission denied for ${EXIT_PLAN_MODE_TOOL_NAME}`;
const EXIT_PLAN_DENIED_BY_USER_MESSAGE = "The plan was not approved by the user.";
const WORKFLOW_REFINE_DENIED_BY_USER_MESSAGE = "The workflow run was not approved by the user.";
const AUTOMATION_CREATE_LIMIT_MODEL_MESSAGE =
  "Automation creation was not performed because the global retained-task limit of 20 was reached. " +
  "This limit cannot be recovered automatically in the current turn. Do not list, delete, overwrite, " +
  "retry, or use another tool. Reply once in the user's language that they must manually delete an " +
  "existing task on the Automations page and then retry.";

export function withAutomationCreateLimitTurnStop(
  result: ToolExecutionResult,
  input: { error: unknown; toolName: string },
): ToolExecutionResult {
  if (
    result.success ||
    input.toolName !== "CronCreate" ||
    !isAutomationCreateLimitError(input.error)
  ) {
    return result;
  }

  return {
    ...result,
    modelContent: AUTOMATION_CREATE_LIMIT_MODEL_MESSAGE,
    turnControl: {
      reason: "automation_create_limit",
      stopTurnAfterResult: true,
    },
  };
}

export function withPlanExitDeniedTurnStop(
  result: ToolExecutionResult,
  input: {
    mode: CollaborationMode;
    planEnabled?: boolean;
    toolName: string;
  },
): ToolExecutionResult {
  if (
    !(input.planEnabled ?? input.mode === "plan") ||
    input.toolName !== EXIT_PLAN_MODE_TOOL_NAME ||
    result.success
  ) {
    return result;
  }

  const feedback = readPlanExitDeniedFeedback(result);
  if (feedback) {
    return {
      ...result,
      followUpUserInput: {
        input: feedback,
        reasonSource: "plan_approval_feedback",
      },
      modelContent: EXIT_PLAN_DENIED_BY_USER_MESSAGE,
    };
  }

  return {
    ...result,
    turnControl: {
      reason: "plan_exit_denied",
      stopTurnAfterResult: true,
    },
  };
}

function readPlanExitDeniedFeedback(result: ToolExecutionResult): string | undefined {
  if (result.error?.type !== CoreErrorType.PermissionDenied) {
    return undefined;
  }
  if (result.error.reasonSource !== "plan_approval_feedback") {
    return undefined;
  }
  const message = result.error.message.trim();
  if (!message || message === DEFAULT_EXIT_PLAN_DENIED_MESSAGE) {
    return undefined;
  }
  return message;
}

export function withWorkflowRefineDeniedFollowUp(
  result: ToolExecutionResult,
  input: { toolName: string },
): ToolExecutionResult {
  if (
    (input.toolName !== CREATE_WORKFLOW_TOOL_NAME && input.toolName !== AMEND_WORKFLOW_TOOL_NAME) ||
    result.success
  ) {
    return result;
  }
  const feedback = readWorkflowRefineDeniedFeedback(result);
  if (!feedback) {
    return result;
  }
  return {
    ...result,
    followUpUserInput: {
      input: feedback,
      reasonSource: "workflow_refine_feedback",
    },
    modelContent: WORKFLOW_REFINE_DENIED_BY_USER_MESSAGE,
  };
}

function readWorkflowRefineDeniedFeedback(result: ToolExecutionResult): string | undefined {
  if (result.error?.type !== CoreErrorType.PermissionDenied) {
    return undefined;
  }
  if (result.error.reasonSource !== "workflow_refine_feedback") {
    return undefined;
  }
  const message = result.error.message.trim();
  return message || undefined;
}

export function withTerminalToolTurnStop(
  result: ToolExecutionResult,
  input: { entry: ToolEntry },
): ToolExecutionResult {
  if (!result.success || input.entry.metadata.stopTurnOnSuccess !== true) {
    return result;
  }
  return {
    ...result,
    turnControl: {
      reason: "subagent_terminal",
      stopTurnAfterResult: true,
    },
  };
}
