// ============================================================
// ============================================================
//

import {
  AmendWorkflowInputSchema,
  isAmendWorkflowOwnedPredecessor,
  type AmendWorkflowInput,
  type AmendWorkflowPredecessor,
  type CreateWorkflowOutput,
  type DynamicWorkflowRunPort,
  type DynamicWorkflowRunRetuneResult,
} from "@origin-ai/cf-contracts";
import type { ToolExecutionContext, ToolHandlerFailure } from "../types.js";
import {
  AMEND_WORKFLOW_ERROR_CODE,
  describePredecessor,
  resolveAmendMaxConcurrency,
  resolveAmendScript,
} from "./amend-workflow-source.js";
import { normalizeWorkflowMaxConcurrency } from "./create-workflow-source.js";
import { workflowRunNotFoundFailure } from "./workflow-run-introspection.js";

export function isConcurrencyOnlyAmend(model: AmendWorkflowInput): boolean {
  return (
    model.max_concurrency !== undefined &&
    model.script === undefined &&
    model.path === undefined &&
    model.subagent_model === undefined &&
    model.name === undefined
  );
}

export function resolveConcurrencyRetuneRoute(options: {
  model: AmendWorkflowInput;
  port: DynamicWorkflowRunPort;
  predecessor: AmendWorkflowPredecessor;
  
  inherited: number | undefined;
}): { result: true; input: AmendWorkflowInput } | ToolHandlerFailure | undefined {
  const { model, port, predecessor } = options;
  if (!isConcurrencyOnlyAmend(model)) return undefined;
  if (predecessor.status !== "pending" && predecessor.status !== "running") return undefined;
  if (typeof port.retuneConcurrency !== "function") return undefined;

  const requested = model.max_concurrency ?? null;
  const defaultConcurrency = port.defaultConcurrency?.();
  const unchanged = refuseUnchangedBound(
    model.run_id,
    requested,
    options.inherited,
    defaultConcurrency,
  );
  if (unchanged !== undefined) return unchanged;
  return {
    result: true,
    input: { run_id: model.run_id, max_concurrency: requested, predecessor },
  };
}

function refuseUnchangedBound(
  runId: string,
  requested: number | null,
  inherited: number | undefined,
  defaultConcurrency: number | undefined,
): ToolHandlerFailure | undefined {
  const current = inherited ?? defaultConcurrency;
  const next = requested === null ? defaultConcurrency : normalizeWorkflowMaxConcurrency(requested);
  if (current === undefined || next === undefined || current !== next) return undefined;
  return retuneUnchangedFailure(runId, current, defaultConcurrency);
}

export async function runConcurrencyRetune(
  parsed: AmendWorkflowInput,
  context: ToolExecutionContext,
): Promise<CreateWorkflowOutput | ToolHandlerFailure | undefined> {
  const port = context.dynamicWorkflowRunPort;
  if (port === undefined || typeof port.retuneConcurrency !== "function") return undefined;
  const answer = await port.retuneConcurrency({
    runId: parsed.run_id,
    maxConcurrency: parsed.max_concurrency ?? null,
  });
  if (answer.ok) {
    return {
      diagnostics: [],
      ok: true,
      response: retuneResponse(parsed.run_id, answer),
      retuned: {
        runId: parsed.run_id,
        maxConcurrency: answer.maxConcurrency,
        previous: answer.previous,
        defaultConcurrency: answer.defaultConcurrency,
      },
    } satisfies CreateWorkflowOutput;
  }
  if (answer.reason === "unchanged") {
    return retuneUnchangedFailure(parsed.run_id, answer.current, port.defaultConcurrency?.());
  }
  return undefined;
}

export async function resolveRetuneFallbackAmend(
  parsed: AmendWorkflowInput,
  context: ToolExecutionContext,
): Promise<{ result: true; input: AmendWorkflowInput } | ToolHandlerFailure> {
  const port = context.dynamicWorkflowRunPort;
  const snapshot = port === undefined ? undefined : await port.getTask(parsed.run_id);
  if (snapshot === undefined) return predecessorNotFoundFailure(parsed.run_id);
  const predecessor = describePredecessor(snapshot, context.sessionId);
  if (!isAmendWorkflowOwnedPredecessor(predecessor)) {
    return predecessor.status === "pending" || predecessor.status === "running"
      ? notRetunableFailure(parsed.run_id)
      : runSettledFailure(parsed.run_id);
  }
  const script = await resolveAmendScript({
    model: parsed,
    cwd: context.workingDirectory,
    port,
    predecessorScriptPath: snapshot.scriptPath,
  });
  if (!script.result) return script;
  return {
    result: true,
    input: AmendWorkflowInputSchema.parse({
      run_id: parsed.run_id,
      ...script.fields,
      ...resolveAmendMaxConcurrency(parsed.max_concurrency, undefined),
      predecessor: {
        ...predecessor,
        ...(script.inherited ? { script_inherited: true as const } : {}),
      },
    }) as AmendWorkflowInput,
  };
}

function predecessorNotFoundFailure(runId: string): ToolHandlerFailure {
  const base = workflowRunNotFoundFailure(runId);
  return {
    ...base,
    message: `${base.message} Nothing was stopped or created: \`run_id\` pointed at a run that does not exist — pass an existing run's ID (see ListWorkflowRuns), or start a fresh run with CreateWorkflow.`,
  };
}

function describeBoundInForce(
  bound: number | undefined,
  defaultConcurrency: number | undefined,
): string {
  if (bound === undefined || bound === defaultConcurrency) {
    return defaultConcurrency === undefined
      ? "already runs at the default parallelism"
      : `already runs at the default parallelism (at most ${defaultConcurrency} subagents at once)`;
  }
  return bound === 1
    ? "already runs at most 1 subagent at once"
    : `already runs at most ${bound} subagents at once`;
}

export function retuneUnchangedFailure(
  runId: string,
  current: number | undefined,
  defaultConcurrency: number | undefined,
): ToolHandlerFailure {
  return {
    result: false,
    errorCode: AMEND_WORKFLOW_ERROR_CODE.RETUNE_UNCHANGED,
    message: `workflow_retune_unchanged: run ${runId} ${describeBoundInForce(current, defaultConcurrency)}, so there is nothing to change. Nothing was stopped, created or changed — pass a different \`max_concurrency\`, or a revised script if you meant to amend the run.`,
  };
}

export function runSettledFailure(runId: string): ToolHandlerFailure {
  return {
    result: false,
    errorCode: AMEND_WORKFLOW_ERROR_CODE.RUN_SETTLED,
    message: `workflow_run_settled: run ${runId} settled before the new parallelism limit could take hold, so there is nothing running to retune. Nothing was stopped, created or changed — call AmendWorkflow again if you want a new run of it under that limit.`,
  };
}

export function notRetunableFailure(runId: string): ToolHandlerFailure {
  return {
    result: false,
    errorCode: AMEND_WORKFLOW_ERROR_CODE.NOT_RETUNABLE,
    message: `workflow_run_not_retunable: run ${runId} is not being executed by this agent, so its parallelism cannot be changed in place. Nothing was stopped, created or changed — call AmendWorkflow again if you want a new run of it under that limit.`,
  };
}

function retuneResponse(
  runId: string,
  answer: Extract<DynamicWorkflowRunRetuneResult, { ok: true }>,
): string {
  const count =
    answer.maxConcurrency === 1
      ? "at most 1 subagent runs at once"
      : `at most ${answer.maxConcurrency} subagents run at once`;
  const bound =
    answer.maxConcurrency === answer.defaultConcurrency ? `${count} (the default)` : count;
  return `Applied to the running run ${runId}; ${bound}. Run ${runId} keeps running under it: nothing was stopped and no new run was started.`;
}
