

import type { DynamicWorkflowRunProgressPayload, Logger, SessionId } from "@origin-ai/cf-contracts";
import type { AgentRuntime } from "@origin-ai/cf-core";

interface DynamicWorkflowRunProgressSinkDeps {
  
  getRuntime: () => AgentRuntime;
  
  sessionId: SessionId;
  logger?: Logger;
}

export function createDynamicWorkflowRunProgressSink(
  deps: DynamicWorkflowRunProgressSinkDeps,
): (progress: DynamicWorkflowRunProgressPayload, routing?: { parentSessionId?: string }) => void {
  const warn = (message: string, runId: string, extra: Record<string, unknown> = {}): void => {
    deps.logger?.warn?.(message, {
      event: "dynamic_workflow.run_progress.append_failed",
      module: "bootstrap.app",
      runId,
      ...extra,
    });
  };

  return (progress, routing) => {
    const parentSessionId = routing?.parentSessionId;
    if (parentSessionId !== undefined && parentSessionId !== deps.sessionId) {
      warn("Dynamic workflow run progress dropped: parent session is not this app", progress.runId, {
        event: "dynamic_workflow.run_progress.session_mismatch",
        expectedSessionId: deps.sessionId,
        parentSessionId,
        reason: "run_parent_session_not_owned_by_this_app",
      });
      return;
    }

    let appended: Promise<void>;
    try {
      appended = deps.getRuntime().recordDynamicWorkflowRunProgress(progress);
    } catch (error) {
      warn("Dynamic workflow run progress append failed", progress.runId, {
        errorMessage: error instanceof Error ? error.message : String(error),
        reason: "runtime_unavailable",
      });
      return;
    }
    void appended.catch((error: unknown) => {
      warn("Dynamic workflow run progress append failed", progress.runId, {
        errorMessage: error instanceof Error ? error.message : String(error),
        reason: "append_rejected",
      });
    });
  };
}
