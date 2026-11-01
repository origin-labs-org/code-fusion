// ============================================================
// ============================================================
//
//

import type { FillHoleResult, HoleFill, OpenHole } from "@origin-ai/cf-dynamic-workflow";
import type { RunControlBinding } from "@origin-ai/cf-dynamic-workflow-runtime";
import type { WorkflowConcurrencyPort } from "./workflow-concurrency-governor.js";
import type { WorkflowRunSeatGate } from "./workflow-seat-gate.js";

export interface WorkflowRunControl extends RunControlBinding {
  
  setMaxConcurrency(maxConcurrency: number): boolean;
  
  bindSeatGate(gate: Pick<WorkflowRunSeatGate, "setLimit">): void;
  
  fillHole(fill: HoleFill): FillHoleResult | undefined;
  
  openHoles(): readonly OpenHole[] | undefined;
}

type BoundEngine = Parameters<RunControlBinding["bind"]>[0];

export function createWorkflowRunControl(): WorkflowRunControl {
  let engine: BoundEngine | undefined;
  let seatGate: Pick<WorkflowRunSeatGate, "setLimit"> | undefined;
  return {
    bind: (bound) => {
      engine = bound;
    },
    fillHole: (fill) => engine?.fillHole(fill),
    openHoles: () => engine?.openHoles(),
    bindSeatGate: (gate) => {
      seatGate = gate;
    },
    setMaxConcurrency: (maxConcurrency) => {
      if (engine === undefined) return false;
      if (!engine.setMaxConcurrency(maxConcurrency)) return false;
      seatGate?.setLimit(maxConcurrency);
      return true;
    },
  };
}

export function runBoundTarget(
  seatGate: Pick<WorkflowRunSeatGate, "setLimit">,
  concurrency: Pick<WorkflowConcurrencyPort, "setRunBound"> | undefined,
  runId: string,
): Pick<WorkflowRunSeatGate, "setLimit"> {
  return {
    setLimit: (limit) => {
      seatGate.setLimit(limit);
      concurrency?.setRunBound(runId, limit);
    },
  };
}
