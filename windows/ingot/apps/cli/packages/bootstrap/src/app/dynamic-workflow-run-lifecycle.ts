// ============================================================
// ============================================================

import type { Logger } from "@origin-ai/cf-contracts";
import type { JournalStorePort, RunSettlement } from "@origin-ai/cf-dynamic-workflow";
import {
  TERMINAL_RUN_STATUSES,
  type RunRegistryEntry,
} from "./dynamic-workflow-run-observation.js";

const TERMINAL_REGISTRY_LIMIT = 32;

export interface DynamicWorkflowRunSettledNotice {
  runId: string;
  liveRunCount: number;
}

interface RunServiceLifecycleDeps {
  
  journal: Pick<JournalStorePort, "getRun">;
  logger?: Logger;
  parentSessionId: string;
  
  registerResidencyBlockingWork?: (work: Promise<unknown>) => void;
  
  runs: Map<string, RunRegistryEntry>;
}

interface RunServiceLifecycle {
  
  countLiveRuns(): number;
  
  subscribeRunSettled(listener: (notice: DynamicWorkflowRunSettledNotice) => void): () => void;
  
  trackSettlement(
    runId: string,
    entry: RunRegistryEntry,
    launched: Promise<RunSettlement>,
  ): Promise<RunSettlement>;
  
  close(): Promise<void>;
  
  assertOpen(): void;
  
  noteForeignTerminalRow(runId: string): void;
}

export function createRunServiceLifecycle(deps: RunServiceLifecycleDeps): RunServiceLifecycle {
  const { runs } = deps;
  const terminalOrder: string[] = [];
  const settledListeners = new Set<(notice: DynamicWorkflowRunSettledNotice) => void>();
  const countLiveRuns = (): number => {
    let live = 0;
    for (const entry of runs.values()) if (entry.terminal === undefined) live += 1;
    return live;
  };
  const notifySettled = (runId: string): void => {
    if (settledListeners.size === 0) return;
    const notice: DynamicWorkflowRunSettledNotice = { runId, liveRunCount: countLiveRuns() };
    for (const listener of settledListeners) {
      try {
        listener(notice);
      } catch (error: unknown) {
        deps.logger?.warn?.("Dynamic workflow run settled listener threw", {
          errorMessage: error instanceof Error ? error.message : String(error),
          event: "dynamic_workflow.run.settled_listener_failed",
          module: "bootstrap.app",
          runId,
        });
      }
    }
  };
  const subscribeRunSettled = (
    listener: (notice: DynamicWorkflowRunSettledNotice) => void,
  ): (() => void) => {
    settledListeners.add(listener);
    return () => {
      settledListeners.delete(listener);
    };
  };

  const rememberTerminal = (runId: string): void => {
    terminalOrder.push(runId);
    while (terminalOrder.length > TERMINAL_REGISTRY_LIMIT) {
      const evicted = terminalOrder.shift();
      if (evicted !== undefined && runs.get(evicted)?.terminal !== undefined) runs.delete(evicted);
    }
  };

  
  const trackSettlement = (
    runId: string,
    entry: RunRegistryEntry,
    launched: Promise<RunSettlement>,
  ): Promise<RunSettlement> => {
    const settlement = launched.then(
      (result) => {
        entry.terminal = result;
        entry.completedAt = new Date();
        rememberTerminal(runId);
        notifySettled(runId);
        return result;
      },
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        deps.logger?.warn?.("Dynamic workflow run failed before settling", {
          errorMessage: message,
          event: "dynamic_workflow.run.start_failed",
          module: "bootstrap.app",
          runId,
        });
        entry.completedAt = new Date();
        const result: RunSettlement = {
          status: "errored",
          error: error instanceof Error ? (error as never) : (new Error(message) as never),
        };
        entry.terminal = result;
        rememberTerminal(runId);
        notifySettled(runId);
        return result;
      },
    );
    deps.registerResidencyBlockingWork?.(settlement);
    return settlement;
  };

  let closed = false;
  let closePromise: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closePromise ??= (async () => {
      closed = true;
      const live = [...deps.runs.values()].filter((entry) => entry.terminal === undefined);
      deps.logger?.info?.("Dynamic workflow run service closing", {
        event: "dynamic_workflow.service.closing",
        liveRunCount: live.length,
        module: "bootstrap.app",
        parentSessionId: deps.parentSessionId,
      });
      for (const entry of live) entry.controller.abort("interrupted");
      await Promise.all(live.map((entry) => entry.settlement));
      deps.logger?.info?.("Dynamic workflow run service closed", {
        event: "dynamic_workflow.service.closed",
        module: "bootstrap.app",
        parentSessionId: deps.parentSessionId,
        stoppedRunCount: live.length,
      });
    })();
    return closePromise;
  };

  
  const assertOpen = (): void => {
    if (closed) {
      throw new Error(
        "dynamic workflow run service is closed; a launch after App close is a wiring fault",
      );
    }
  };

  
  const noteForeignTerminalRow = (runId: string): void => {
    const entry = deps.runs.get(runId);
    if (entry === undefined || entry.terminal !== undefined || entry.foreignTerminalLogged) return;
    const record = deps.journal.getRun(runId);
    if (record === undefined || !TERMINAL_RUN_STATUSES.has(record.status)) return;
    entry.foreignTerminalLogged = true;
    deps.logger?.warn?.("Dynamic workflow run has a foreign terminal row under a live engine", {
      event: "dynamic_workflow.run.foreign_terminal_row",
      journalStatus: record.status,
      module: "bootstrap.app",
      runId,
      ...(record.stopReason === undefined ? {} : { stopReason: record.stopReason }),
    });
  };

  return {
    countLiveRuns,
    subscribeRunSettled,
    trackSettlement,
    close,
    assertOpen,
    noteForeignTerminalRow,
  };
}
