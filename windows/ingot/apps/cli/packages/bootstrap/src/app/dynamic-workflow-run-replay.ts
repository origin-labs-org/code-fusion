// ============================================================
// ============================================================
//

import type { DwfRunSessionListItem } from "@origin-ai/cf-adapters/storage";
import type { DynamicWorkflowRunProgressPayload } from "@origin-ai/cf-contracts";
import type {
  JournalStorePort,
  ListEventsOptions,
  RunEvent,
  StoredEvent,
} from "@origin-ai/cf-dynamic-workflow";
import { WORKFLOW_RUNS_LIMITS } from "@origin-ai/cf-shared/cf-protocol-v4";
import { coldCompiledHoles } from "./dynamic-workflow-run-holes.js";
import { toProgressPayload } from "./dynamic-workflow-run-launch.js";
import { TERMINAL_RUN_STATUSES } from "./dynamic-workflow-run-observation.js";

export function replayRunProgress(
  row: DwfRunSessionListItem,
  journal: Pick<JournalStorePort, "listEvents">,
  defaultConcurrency: number,
): DynamicWorkflowRunProgressPayload[] {
  return replayRunProgressFromEvents(
    row,
    journal.listEvents(row.runId, COLD_REPLAY_EVENT_READ),
    defaultConcurrency,
  );
}

export const COLD_REPLAY_EVENT_READ: ListEventsOptions = {
  types: "all",
  reportItems: { limit: WORKFLOW_RUNS_LIMITS.maxReports },
};

export function replayRunProgressFromEvents(
  row: DwfRunSessionListItem,
  stored: readonly StoredEvent[],
  defaultConcurrency: number,
): DynamicWorkflowRunProgressPayload[] {
  const toolCallId = row.toolCallId === undefined ? {} : { toolCallId: row.toolCallId };
  const holeTypeOf = coldHoleTypeOf(row.scriptText, stored);
  const launched = stored.find((entry) => entry.event.type === "run-launched")?.event;
  const launchInputId =
    launched?.type === "run-launched" ? { launchInputId: launched.inputId } : {};
  const resumedFrom = row.resumedFrom === undefined ? {} : { resumedFrom: row.resumedFrom };
  const subagentModel =
    launched?.type === "run-launched" && launched.subagentModel !== undefined
      ? { subagentModel: launched.subagentModel }
      : {};
  const modelBindings =
    launched?.type === "run-launched" && launched.modelBindings !== undefined
      ? { modelBindings: launched.modelBindings }
      : {};
  const terminal = TERMINAL_RUN_STATUSES.has(row.status);
  const last = stored.at(-1);
  const trailingSettle = terminal && last?.event.type === "run-settled" ? last : undefined;
  const replayable = trailingSettle === undefined ? stored : stored.slice(0, -1);
  const payloads = replayable.map((entry) =>
    toProgressPayload({
      event: entry.event,
      runId: row.runId,
      sequence: entry.sequence,
      ...toolCallId,
      ...launchInputId,
      ...resumedFrom,
      ...subagentModel,
      ...modelBindings,
      concurrencyCeiling: defaultConcurrency,
      ...(holeTypeOf === undefined ? {} : { holeTypeOf }),
      ...(entry.event.type === "hole-reached" && entry.timeCreated !== undefined
        ? { reachedAt: entry.timeCreated }
        : {}),
    }),
  );
  if (!terminal) return payloads;
  const settled: RunEvent = {
    type: "run-settled",
    status: row.status,
    ...(row.status === "stopped" ? { stopReason: row.stopReason ?? "user" } : {}),
    ...(row.status === "stopped" && row.supersededBy !== undefined
      ? { supersededBy: row.supersededBy }
      : {}),
    ...(row.failure === undefined ? {} : { error: row.failure }),
  };
  payloads.push(
    toProgressPayload({
      event: settled,
      runId: row.runId,
      sequence: trailingSettle?.sequence ?? (last?.sequence ?? 0) + 1,
      ...toolCallId,
      ...launchInputId,
      ...resumedFrom,
      ...subagentModel,
      ...modelBindings,
      concurrencyCeiling: defaultConcurrency,
    }),
  );
  return payloads;
}

function coldHoleTypeOf(
  scriptText: string | undefined,
  stored: readonly StoredEvent[],
): ((siteId: string) => string | undefined) | undefined {
  const holes = coldCompiledHoles(scriptText, stored);
  return holes === undefined
    ? undefined
    : (siteId) => holes.find((hole) => hole.siteId === siteId)?.type;
}
