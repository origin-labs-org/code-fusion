// ============================================================
// ============================================================

import type { TraceContext, WorkflowSettingsAmendMeta } from "@origin-ai/cf-contracts";
import type { DynamicWorkflowRunSnapshot } from "@origin-ai/cf-contracts";
import { uuidv7 } from "@origin-ai/cf-shared";
import { createRuntimeCommandId } from "../command-queue.js";
import type { AgentRuntimeInternal } from "../internal.js";
import type { boundWorkflowLaunchMeta } from "@origin-ai/cf-contracts";

export interface RunSettings {
  subagentModel?: string;
  maxConcurrency?: number;
}

export function enqueueSettingsTurn(
  this: AgentRuntimeInternal,
  turn: {
    text: string;
    meta: ReturnType<typeof boundWorkflowLaunchMeta>;
    titleInput: string;
    traceContext: TraceContext;
  },
): void {
  this.enqueueRuntimeCommand({
    branchGeneration: this.branchGeneration,
    createdAt: new Date(),
    id: createRuntimeCommandId(),
    inputId: uuidv7(),
    mode: "control-only-turn",
    priority: "next",
    text: turn.text,
    titleInput: turn.titleInput,
    traceContext: turn.traceContext,
    workflowLaunch: turn.meta,
  });
}

export function fromTo<T>(from: T | undefined, to: T | undefined): { from?: T; to?: T } {
  return { ...(from === undefined ? {} : { from }), ...(to === undefined ? {} : { to }) };
}

export function buildSettingsMessageText(input: {
  name?: string;
  previous: string;
  runId: string;
  superseded: boolean;
  amend: WorkflowSettingsAmendMeta;
}): string {
  const inPlace = input.amend.predecessorRunId === undefined;
  const lead = `Changed the settings of workflow run ${input.previous}${input.name === undefined ? "" : ` ("${input.name}")`} from the GUI: ${settingsChangeClauses(input.amend, inPlace).join("; ")}.`;
  const closing =
    "Progress and results arrive as background notifications; do not amend, resume or restart it.";
  if (inPlace) {
    const kept =
      input.amend.maxConcurrency?.to === undefined
        ? `Run ${input.previous} keeps running with no limit`
        : `Run ${input.previous} keeps running under the new limit`;
    return [lead, `${kept}; nothing was stopped and no new run was started.`, closing].join(" ");
  }
  const relation = input.superseded ? "supersedes" : "takes over from";
  return [
    lead,
    `The same script continues as run ${input.runId}, which ${relation} run ${input.previous} and imports everything run ${input.previous} finished as cache.`,
    closing,
  ].join(" ");
}

function settingsChangeClauses(amend: WorkflowSettingsAmendMeta, inPlace: boolean): string[] {
  const changes: string[] = [];
  const model = amend.subagentModel;
  if (model !== undefined) {
    changes.push(
      model.to === undefined
        ? "its subagents are back on the session model"
        : `its subagents now run on ${model.to}`,
    );
  }
  const bound = amend.maxConcurrency;
  if (bound !== undefined) {
    changes.push(
      bound.to === undefined
        ? "the limit on subagents at once is back to the default"
        : inPlace
          ? `at most ${bound.to} of its subagents run at once`
          : `at most ${bound.to} of them run at once`,
    );
  }
  return changes;
}

export function runSettingsOfSnapshot(snapshot: DynamicWorkflowRunSnapshot): RunSettings {
  return {
    ...(snapshot.subagentModel === undefined ? {} : { subagentModel: snapshot.subagentModel }),
    ...(snapshot.maxConcurrency === undefined ? {} : { maxConcurrency: snapshot.maxConcurrency }),
  };
}
