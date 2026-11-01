// ============================================================
// ============================================================
// docs/dynamic-workflow/launch.md「Adjusting the settings in the window」。
//

import {
  AMEND_WORKFLOW_TOOL_NAME,
  CREATE_WORKFLOW_TOOL_NAME,
  parseWorkflowSettingsAdjustment,
} from "@origin-ai/cf-contracts";
import type { V4InteractionAnswer } from "../cf-protocol-v4/interaction-registry.js";

export function withWorkflowSettingsAdjustment<T extends { decision: string }>(
  response: T,
  answer: V4InteractionAnswer,
  toolName: string,
): T & { inputAdjustments?: Readonly<Record<string, unknown>> } {
  if (toolName !== CREATE_WORKFLOW_TOOL_NAME && toolName !== AMEND_WORKFLOW_TOOL_NAME) {
    return response;
  }
  if (response.decision !== "allow" || answer.content === undefined) return response;
  const adjustment = parseWorkflowSettingsAdjustment(answer.content);
  return adjustment === undefined ? response : { ...response, inputAdjustments: adjustment };
}
