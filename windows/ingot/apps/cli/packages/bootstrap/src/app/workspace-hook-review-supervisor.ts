import { SessionEventType } from "@origin-ai/cf-contracts";
import type { WorkspaceHookReviewFlow, WorkspaceHookReviewFlowRegistry } from "@origin-ai/cf-core";
import type { WorkspaceHookReviewHostPort } from "./workspace-hook-review-types.js";
import type { WorkspaceHookReviewTelemetry } from "./workspace-hook-review-telemetry.js";

export async function superviseWorkspaceHookReviewFlow(input: {
  flow: WorkspaceHookReviewFlow;
  host: WorkspaceHookReviewHostPort;
  registry: WorkspaceHookReviewFlowRegistry;
  sessionId: string;
  telemetry: WorkspaceHookReviewTelemetry;
}): Promise<void> {
  let flow = input.flow;
  while (true) {
    const outcome = await flow.result;
    if (outcome.reasonCode === "workspace_hooks_review_superseded") {
      const current = input.registry.getCurrentFlow(input.sessionId);
      if (!current || current === flow) return;
      flow = current;
      continue;
    }
    if (outcome.reasonCode === "workspace_hooks_interaction_timeout") {
      input.telemetry.timeout(flow.request);
      await input.host.emit({
        type: SessionEventType.WorkspaceHookReviewSettled,
        payload: {
          interactionId: flow.request.interactionId,
          state: "timed_out",
          reasonCode: outcome.reasonCode,
        },
      });
    }
    return;
  }
}
