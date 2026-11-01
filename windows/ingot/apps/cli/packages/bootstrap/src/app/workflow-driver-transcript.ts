// ============================================================
// ============================================================

import type { SessionId } from "@origin-ai/cf-contracts";
import type { AgentRuntime } from "@origin-ai/cf-core";
import {
  refToString,
  WorkflowError,
  type ActorSessionSeed,
  type InstanceRef,
} from "@origin-ai/cf-dynamic-workflow";
import { countActorTranscript, seedActorTranscript } from "./workflow-actor-transcript.js";
import type { AgentRuntimeWorkflowDriverDeps, SessionState } from "./workflow-driver-types.js";

export async function seedActorSession(
  deps: AgentRuntimeWorkflowDriverDeps,
  input: {
    journaledSessionId: string | undefined;
    runtime: AgentRuntime;
    seed: ActorSessionSeed;
    sessionId: SessionId;
  },
): Promise<void> {
  const { journaledSessionId, runtime, seed, sessionId } = input;
  const store = deps.actorTranscriptStore;
  if (store === undefined) {
    throw new WorkflowError(
      "DriverError",
      `Subagent session ${sessionId} carries a transcript seed, but the driver has no ` +
        `transcript store (wiring error).`,
    );
  }
  const copied = await seedActorTranscript({
    ...(deps.logger === undefined ? {} : { logger: deps.logger }),
    seed,
    store,
    targetSessionId: sessionId,
  });
  if (copied === undefined && journaledSessionId !== undefined) return;
  await runtime.resumeFromStore();
}

export async function countSessionTranscript(
  deps: AgentRuntimeWorkflowDriverDeps,
  state: SessionState,
  instance: InstanceRef,
): Promise<number | undefined> {
  const store = deps.actorTranscriptStore;
  if (store === undefined) return undefined;
  try {
    return await countActorTranscript(store, state.sessionId);
  } catch (error) {
    deps.logger?.warn?.("Dynamic workflow ask message boundary count failed", {
      errorMessage: error instanceof Error ? error.message : String(error),
      event: "dynamic_workflow.ask.message_boundary.count_failed",
      instance: refToString(instance),
      module: "bootstrap.app",
      sessionId: state.sessionId,
    });
    return undefined;
  }
}

export function journalAskMessageBoundary(
  deps: AgentRuntimeWorkflowDriverDeps,
  state: SessionState,
  instance: InstanceRef,
  boundary: number,
): void {
  const key = refToString(instance);
  if (state.currentInstance !== undefined && refToString(state.currentInstance) !== key) return;
  const runId = deps.runId ?? "run";
  try {
    const recorded = deps.journal.getNode(runId, instance.siteId, instance.ordinal);
    if (recorded === undefined) return;
    deps.journal.putNode({ ...recorded, messageBoundary: boundary });
  } catch (error) {
    deps.logger?.warn?.("Dynamic workflow ask message boundary write failed", {
      errorMessage: error instanceof Error ? error.message : String(error),
      event: "dynamic_workflow.ask.message_boundary.write_failed",
      instance: key,
      module: "bootstrap.app",
      runId,
    });
  }
}
