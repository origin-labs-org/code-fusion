

import { canonicalJson, inputHash } from "./hash.js";
import { heldResolution } from "./replay-order.js";
import { boundWorldReadInput } from "./world-read-input.js";
import { hashMismatch } from "./hash-mismatch.js";
import type { EngineState } from "./engine-state.js";
import type {
  InstanceRef,
  JournalStorePort,
  NodeKind,
  WorkflowErrorJson,
  WorldReadInput,
  WorldReadOp,
} from "./types.js";
import { refToString, WorkflowError } from "./types.js";

export function readWorld(
  state: EngineState,
  siteId: string,
  op: WorldReadOp,
  args: unknown[],
): Promise<unknown> {
  if (state.isRunSettled()) return Promise.reject(state.runError());
  const ordinal = state.nextOrdinal(siteId);
  const instance: InstanceRef = { siteId, ordinal };
  const hash = inputHash({ op, args });
  const input = boundWorldReadInput(op, args);

  const recorded = state.journal.getNode(state.runId, siteId, ordinal);
  if (recorded !== undefined) {
    if (recorded.inputHash !== hash) {
      const err = hashMismatch(instance, recorded.inputHash, hash);
      state.failRun(err);
      return Promise.reject(err);
    }
    if (recorded.status === "completed") {
      return heldResolution(state.holdForReplay, instance, () => {
        state.record({ type: "node-settled", instance, outcome: "ok", cached: true });
        return recorded.result;
      });
    }
    if (recorded.status === "failed") {
      return heldResolution(state.holdForReplay, instance, () => {
        state.record({
          type: "node-settled",
          instance,
          outcome: "failed",
          cached: true,
          error: recorded.error,
        });
        throw WorkflowError.fromJSON(recorded.error!);
      });
    }
  }

  const kind: NodeKind = op === "run" ? "world-run" : "world-read";

  const imported = state.importClosed() ? undefined : state.importedWorld.take(hash);
  if (imported !== undefined) {
    state.journal.putNode({
      runId: state.runId,
      siteId,
      ordinal,
      kind,
      inputHash: hash,
      input,
      status: "completed",
      result: imported.result,
    });
    state.record({ type: "node-settled", instance, outcome: "ok", cached: true });
    return Promise.resolve(imported.result);
  }

  if (state.isRunSettled()) return Promise.reject(state.runError());
  if (kind === "world-run") closeImportCache(state, instance, "world-run");
  state.journal.putNode({
    runId: state.runId,
    siteId,
    ordinal,
    kind,
    inputHash: hash,
    input,
    status: "running",
  });
  state.record({ type: "node-queued", instance, kind });
  state.record({ type: "node-dispatched", instance });
  return state.driver.executeWorldRead(op, args).then(
    (value) =>
      settleWorldRead(state, instance, kind, hash, input, { status: "completed", result: value }),
    (cause: unknown) => {
      const err =
        cause instanceof WorkflowError
          ? cause
          : new WorkflowError("DriverError", `World read failed: ${op} ${canonicalJson(args)}.`, {
              cause,
            });
      return settleWorldRead(state, instance, kind, hash, input, {
        status: "failed",
        error: err.toJSON(),
      });
    },
  );
}

function settleWorldRead(
  state: EngineState,
  instance: InstanceRef,
  kind: NodeKind,
  hash: string,
  input: WorldReadInput,
  outcome:
    | { status: "completed"; result: unknown }
    | { status: "failed"; error: WorkflowErrorJson },
): unknown {
  if (state.isRunSettled()) throw state.runError();
  state.journal.putNode({
    runId: state.runId,
    siteId: instance.siteId,
    ordinal: instance.ordinal,
    kind,
    inputHash: hash,
    input,
    status: outcome.status,
    ...(outcome.status === "completed" ? { result: outcome.result } : { error: outcome.error }),
  });
  if (outcome.status === "completed") {
    state.record({ type: "node-settled", instance, outcome: "ok" });
    return outcome.result;
  }
  state.record({ type: "node-settled", instance, outcome: "failed", error: outcome.error });
  throw WorkflowError.fromJSON(outcome.error);
}

export function closeImportCache(
  state: EngineState,
  instance: InstanceRef,
  cause: "mutating-tool" | "world-run",
  actorName?: string,
): void {
  if (state.importClosed()) return;
  state.closeImport();
  if (state.importedCache === undefined) return;
  state.record({
    type: "import-cache-closed",
    instance,
    cause,
    ...(actorName === undefined || actorName === "" ? {} : { actorName }),
  });
}

export function recoverImportClosure(
  journal: JournalStorePort,
  runId: string,
): { live: ReadonlySet<string>; queuedBeforeClose: ReadonlySet<string>; closed: boolean } {
  const live = new Set<string>();
  const queuedBeforeClose = new Set<string>();
  let closed = false;
  for (const { event } of journal.listEvents(runId, {
    types: ["node-queued", "import-cache-closed"],
    reportItems: { limit: 0 },
  })) {
    if (event.type === "import-cache-closed") closed = true;
    if (event.type !== "node-queued" || event.kind !== "ask") continue;
    const key = refToString(event.instance);
    live.add(key);
    if (!closed) queuedBeforeClose.add(key);
  }
  return { live, queuedBeforeClose, closed };
}
