import type ts from "typescript";
import type { WorkflowProgram } from "../compiler/compile.js";
import type { SiteTable } from "./sites.js";
import { UNPHASED_ID } from "./constants.js";
import type { OrderOracle, OrderTrace } from "./causality-order-types.js";
import { enclosingFunctions, functionName } from "./causality-order-functions.js";
import { createTraceState, issue, locOf, openRegion } from "./causality-order-state.js";
import { walkNode, walkStatements } from "./causality-order-walk.js";

export {
  UNPHASED_ID,
  type JumpKind,
  type StructuralRegionKind,
  type TraceRegionKind,
} from "./constants.js";
export type {
  ActorEvent,
  ControlFact,
  IssueEvent,
  JumpEvent,
  MarkEvent,
  OrderEvent,
  OrderRegion,
  OrderTrace,
  PhaseInfo,
  SettleEvent,
} from "./causality-order-types.js";

/** Walk the authored body in evaluation order and record the ordering trace. */
export function traceOrder(
  workflow: WorkflowProgram,
  table: SiteTable,
  oracle: OrderOracle,
): OrderTrace {
  const state = createTraceState(workflow, table, oracle, walkNode);
  const { controls, events, fnStack, issued, phases, regions, returnTargets, root, walkedFns } = state;

  walkStatements(state, state.body.statements, [root]);

  // The sweep and the terminal fallback are outside every marker's extent — a body
  // nothing called has no call site to inherit a phase from. (`walkStatements` has
  // already restored the root value here; the assignment is the contract, not a fix.)
  state.currentPhase = UNPHASED_ID;

  // Sweep: a step inside a function nothing called (a `.then` callback, a method
  // reached dynamically, dead code) still needs a position and a region. Walk the
  // narrowest un-walked enclosing function, in site order, to a fixpoint. The region
  // is `branch` because we cannot show the body runs at all.
  const stepSites = [
    ...table.asks,
    ...table.worldReads,
    ...table.holes.filter((site) => site.body === undefined),
  ].sort((a, b) => a.order - b.order);
  let progress = true;
  while (progress) {
    progress = false;
    for (const site of stepSites) {
      if (issued.has(site.id)) continue;
      const owner = enclosingFunctions(site.call).find((fn) => !walkedFns.has(fn));
      if (owner === undefined) continue;
      walkedFns.add(owner);
      fnStack.push(owner);
      const detached = openRegion(state, "branch", root, {
        detached: true,
        entered: false,
        loc: locOf(state, owner),
        ...(functionName(owner) === undefined ? {} : { label: functionName(owner) as string }),
      });
      returnTargets.push(detached); // a `return` here ends the detached body, not the script
      state.walk(owner.body as ts.Node, [root, detached]);
      returnTargets.pop();
      fnStack.pop();
      progress = true;
    }
  }
  // Anything still unreached (a site inside a construct the walk cannot place) gets a
  // terminal issue in the root region, so every step has a position.
  for (const site of stepSites) if (!issued.has(site.id)) issue(state, site.id, [root]);

  return { controls, events, phases, regions, root };
}
