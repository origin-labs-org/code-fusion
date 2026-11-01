

import type { AskNode, SchedulerHost } from "./scheduler-types.js";
import type { InstanceRef, Violation } from "./types.js";
import { REPAIR_ATTEMPTS, WorkflowError } from "./types.js";

export interface SubmitSeam {
  readonly host: SchedulerHost;
  
  liveNode(instance: InstanceRef): AskNode | undefined;
  settleOk(node: AskNode, artifact: unknown): void;
  settleFailed(node: AskNode, error: WorkflowError): void;
}

export function handleSubmitAttempted(
  seam: SubmitSeam,
  instance: InstanceRef,
  payload: unknown,
): void {
  const node = seam.liveNode(instance);
  if (node === undefined || node.settled) return;
  if (!node.spec.typed) return;

  const { value, violations } = normalizeSubmit(seam.host, node.spec.schema, payload);
  if (violations.length === 0) {
    seam.host.driver.respondToSubmit(instance, { kind: "accept" });
    seam.settleOk(node, value);
    return;
  }
  if (node.repairsRemaining > 0) {
    node.repairsRemaining--;
    const attempt = REPAIR_ATTEMPTS - node.repairsRemaining;
    seam.host.driver.respondToSubmit(instance, { kind: "reject", violations });
    seam.host.record({ type: "node-repairing", instance, attempt, violations });
    return;
  }
  seam.host.driver.cancelAsk(instance);
  seam.settleFailed(
    node,
    new WorkflowError(
      "ValidationFailed",
      "submit_result failed schema validation repeatedly and the repair budget is exhausted.",
      { violations },
    ),
  );
}

function normalizeSubmit(
  host: SchedulerHost,
  schema: unknown,
  payload: unknown,
): { value: unknown; violations: Violation[] } {
  const direct = host.validate(schema, payload);
  if (direct.length === 0) return { value: payload, violations: [] };
  if (typeof payload === "string") {
    try {
      const parsed = JSON.parse(payload);
      const after = host.validate(schema, parsed);
      if (after.length === 0) return { value: parsed, violations: [] };
      return { value: parsed, violations: after };
    } catch {
    }
  }
  return { value: payload, violations: direct };
}

export function handleTurnEnded(seam: SubmitSeam, instance: InstanceRef, finalText: string): void {
  const node = seam.liveNode(instance);
  if (node === undefined || node.settled) return;
  if (!node.spec.typed) {
    seam.settleOk(node, finalText);
    return;
  }
  if (node.nudgesRemaining > 0) {
    node.nudgesRemaining--;
    seam.host.driver.respondToSubmit(instance, { kind: "nudge" });
    seam.host.record({ type: "node-nudged", instance });
    return;
  }
  seam.host.driver.cancelAsk(instance);
  seam.settleFailed(
    node,
    new WorkflowError(
      "ResultNotSubmitted",
      "The typed ask ended without a submit_result call, so there is no result.",
      { finalText },
    ),
  );
}
