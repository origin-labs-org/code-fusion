import {
  AMEND_WORKFLOW_TOOL_NAME,
  ASK_USER_QUESTION_TOOL_NAME,
  AskUserQuestionInputSchema,
  CREATE_WORKFLOW_TOOL_NAME,
  type PermissionBrokerResult,
} from "@origin-ai/cf-contracts";
import type React from "react";
import type { ApprovalPrompt } from "./app-model.js";
import { createQuestionPromptState } from "./app-question-state.js";
import type { TuiRequestPermission } from "./types.js";

function createWorkflowBypassResult(toolName: string): PermissionBrokerResult {
  return {
    decision: "allow",
    reason: `${toolName} auto-allowed in CLI (confirmation gate bypass)`,
    resolvedAt: new Date(),
  };
}

export function createTuiPermissionRequester(input: {
  setApprovalQueue: React.Dispatch<React.SetStateAction<ApprovalPrompt[]>>;
  setStatus: (status: string) => void;
}): TuiRequestPermission {
  return (request, requestOptions) =>
    new Promise<PermissionBrokerResult>((resolve, reject) => {
      if (requestOptions?.signal?.aborted) {
        reject(new Error("Permission request cancelled"));
        return;
      }

      if (
        request.toolName === CREATE_WORKFLOW_TOOL_NAME ||
        request.toolName === AMEND_WORKFLOW_TOOL_NAME
      ) {
        resolve(createWorkflowBypassResult(request.toolName));
        return;
      }

      let settled = false;
      let approval: ApprovalPrompt;
      const parsedQuestion =
        request.toolName === ASK_USER_QUESTION_TOOL_NAME
          ? AskUserQuestionInputSchema.safeParse(request.input)
          : undefined;

      if (parsedQuestion && !parsedQuestion.success) {
        resolve({
          decision: "deny",
          reason: `Invalid AskUserQuestion input: ${
            parsedQuestion.error.issues[0]?.message ?? "schema validation failed"
          }`,
          resolvedAt: new Date(),
        });
        return;
      }

      const cleanup = () => {
        requestOptions?.signal?.removeEventListener("abort", abortHandler);
      };
      const settle = (result: PermissionBrokerResult) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({
          ...result,
          resolvedAt: result.resolvedAt ?? new Date(),
        });
      };
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const abortHandler = () => {
        input.setApprovalQueue((current) => current.filter((item) => item !== approval));
        fail(new Error("Permission request cancelled"));
      };

      approval = {
        cleanup,
        questionState: parsedQuestion?.success
          ? createQuestionPromptState(parsedQuestion.data)
          : undefined,
        reject: fail,
        request,
        resolve: settle,
        selectedDecision: "deny",
      };

      requestOptions?.signal?.addEventListener("abort", abortHandler, { once: true });
      input.setApprovalQueue((current) => [...current, approval]);
      input.setStatus(
        approval.questionState
          ? "Answer the clarification question."
          : `Approval required for ${request.toolName}.`,
      );
    });
}
