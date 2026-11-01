// ============================================================
// ============================================================

import { randomUUID } from "node:crypto";
import type {
  DynamicWorkflowRunAmendRequest,
  DynamicWorkflowRunAmendResult,
  DynamicWorkflowRunResumeResult,
  DynamicWorkflowRunSubmitRequest,
  DynamicWorkflowRunSubmitResult,
  TraceContext,
} from "@origin-ai/cf-contracts";
import {
  collectDiagnostics,
  createWorkflowProgram,
  type Caps,
  type ImportedRunCache,
  type RunSettlement,
} from "@origin-ai/cf-dynamic-workflow";
import { formatModelPickerValue } from "@origin-ai/cf-shared/model-selection";
import type { ModelSelection } from "@origin-ai/cf-shared/model-selection";
import {
  buildImportedCache,
  preflightAmendImport,
  rebuildImportedCacheForResume,
} from "./dynamic-workflow-import.js";
import {
  boundedResumeDiagnostics,
  compileOnce,
  compileProgram,
} from "./dynamic-workflow-run-compile.js";
import {
  openHoleIndexes,
  phaseNamesFromEvents,
  readRunHoleEvents,
} from "./dynamic-workflow-run-holes.js";
import { launchDynamicWorkflowRun } from "./dynamic-workflow-run-launch.js";
import {
  readRunLaunchAnchor,
  readRunModelBindings,
  readRunScriptPath,
  readRunSubagentModel,
  resolveLaunchAnchor,
  type RunLaunch,
} from "./dynamic-workflow-run-launch-anchor.js";
import { isResumableRecord, type RunRegistryEntry } from "./dynamic-workflow-run-observation.js";
import type { DynamicWorkflowRunServiceDeps } from "./dynamic-workflow-run-service.js";
import { workflowSubagentPermissionModeField } from "./workflow-actor-permission.js";
import type { WorkflowEscalationRegistry } from "./workflow-escalation-registry.js";
import { createWorkflowRunControl } from "./workflow-run-control.js";

export interface DynamicWorkflowRunEntryContext {
  deps: DynamicWorkflowRunServiceDeps;
  runs: Map<string, RunRegistryEntry>;
  escalations: WorkflowEscalationRegistry;
  
  caps: (requestedMaxConcurrency?: number) => Caps;
  trackSettlement: (
    runId: string,
    entry: RunRegistryEntry,
    launched: Promise<RunSettlement>,
  ) => Promise<RunSettlement>;
}

export async function submitDynamicWorkflowRun(
  ctx: DynamicWorkflowRunEntryContext,
  request: DynamicWorkflowRunSubmitRequest,
): Promise<DynamicWorkflowRunSubmitResult> {
  const runId = startNewRun(ctx, {
    runId: mintRunId(),
    scriptText: request.scriptText,
    cwd: request.cwd,
    ...(request.name === undefined ? {} : { name: request.name }),
    ...(request.args === undefined ? {} : { args: request.args }),
    ...(request.parentSessionId === undefined ? {} : { parentSessionId: request.parentSessionId }),
    ...(request.toolCallId === undefined ? {} : { toolCallId: request.toolCallId }),
    ...(request.launchInputId === undefined ? {} : { launchInputId: request.launchInputId }),
    ...(request.phaseNames === undefined ? {} : { phaseNames: request.phaseNames }),
    ...(request.maxConcurrency === undefined ? {} : { maxConcurrency: request.maxConcurrency }),
    ...(request.subagentModel === undefined ? {} : { subagentModel: request.subagentModel }),
    ...(request.modelBindings === undefined ? {} : { modelBindings: request.modelBindings }),
    ...(request.scriptPath === undefined ? {} : { scriptPath: request.scriptPath }),
    ...(request.phaseAlongside === undefined ? {} : { phaseAlongside: request.phaseAlongside }),
    trace: request.trace,
  });
  return { ok: true, runId };
}

export async function amendDynamicWorkflowRun(
  ctx: DynamicWorkflowRunEntryContext,
  request: DynamicWorkflowRunAmendRequest,
): Promise<DynamicWorkflowRunAmendResult> {
  const { deps, runs } = ctx;
  const preflight = preflightAmendImport(deps.journal, request.predecessorRunId);
  if (!preflight.ok) {
    deps.logger?.info?.("Dynamic workflow amend refused", {
      event: "dynamic_workflow.amend.refused",
      module: "bootstrap.app",
      predecessorRunId: request.predecessorRunId,
      reason: preflight.reason,
    });
    return { ok: false, reason: preflight.reason };
  }
  const predecessor = preflight.run;
  const runId = mintRunId();

  const live = runs.get(request.predecessorRunId);
  let supersededRunId: string | undefined;
  if (live !== undefined && live.terminal === undefined) {
    live.controller.abort({ superseded: runId });
    await live.settlement;
    supersededRunId = request.predecessorRunId;
    deps.logger?.info?.("Dynamic workflow run superseded by an amendment", {
      event: "dynamic_workflow.amend.superseded",
      module: "bootstrap.app",
      predecessorRunId: request.predecessorRunId,
      runId,
    });
  }

  //
  //
  //
  const quietSessions =
    deps.actorTranscriptStore === undefined ? undefined : await live?.quiescence?.quietSessions();

  const built = await buildImportedCache(
    deps,
    request.predecessorRunId,
    quietSessions === undefined ? undefined : { quietSessions },
  );
  if (!built.ok) {
    throw new Error(
      `dynamic workflow amend could not import from run ${request.predecessorRunId} after preflight: ${built.reason}`,
    );
  }

  const settledPredecessor = deps.journal.getRun(request.predecessorRunId);
  const inheritedTokens = settledPredecessor?.spentTokens ?? 0;
  const inheritedArgs =
    request.inheritArgs === true && settledPredecessor?.args !== undefined
      ? settledPredecessor.args
      : undefined;

  startNewRun(ctx, {
    runId,
    scriptText: request.scriptText,
    cwd: request.cwd,
    inheritedTokens,
    ...(request.name !== undefined
      ? { name: request.name }
      : predecessor.name === undefined
        ? {}
        : { name: predecessor.name }),
    ...(inheritedArgs === undefined ? {} : { args: inheritedArgs }),
    ...(request.parentSessionId === undefined ? {} : { parentSessionId: request.parentSessionId }),
    ...(request.toolCallId === undefined ? {} : { toolCallId: request.toolCallId }),
    ...(request.phaseNames === undefined ? {} : { phaseNames: request.phaseNames }),
    ...(request.maxConcurrency === undefined ? {} : { maxConcurrency: request.maxConcurrency }),
    ...(request.subagentModel === undefined ? {} : { subagentModel: request.subagentModel }),
    ...(request.modelBindings === undefined ? {} : { modelBindings: request.modelBindings }),
    ...(request.scriptPath === undefined ? {} : { scriptPath: request.scriptPath }),
    ...(request.phaseAlongside === undefined ? {} : { phaseAlongside: request.phaseAlongside }),
    trace: request.trace,
    imported: { cache: built.cache, resumedFrom: built.resumedFrom },
  });
  return { ok: true, runId, ...(supersededRunId === undefined ? {} : { supersededRunId }) };
}

interface StartNewRunInput {
  runId: string;
  scriptText: string;
  cwd: string;
  name?: string;
  args?: Record<string, unknown>;
  parentSessionId?: string;
  toolCallId?: string;
  launchInputId?: string;
  
  phaseNames?: string[];
  
  maxConcurrency?: number;
  
  subagentModel?: ModelSelection;
  
  modelBindings?: Record<string, ModelSelection>;
  
  scriptPath?: string;
  
  phaseAlongside?: number[][];
  trace: TraceContext;
  
  inheritedTokens?: number;
  
  imported?: { cache: ImportedRunCache; resumedFrom: string };
}

function startNewRun(ctx: DynamicWorkflowRunEntryContext, input: StartNewRunInput): string {
  const { deps, runs, escalations } = ctx;
  const { imported, runId } = input;
  const compiled = compileOnce(input.scriptText);
  const caps = ctx.caps(input.maxConcurrency);
  const subagentModel =
    input.subagentModel === undefined ? undefined : formatModelPickerValue(input.subagentModel);
  const modelBindings = formatModelBindings(input.modelBindings);

  const launch: RunLaunch = {
    ...resolveLaunchAnchor({
      ...(input.launchInputId === undefined ? {} : { requested: input.launchInputId }),
      trace: input.trace,
      ...(deps.resolveLaunchInputId === undefined
        ? {}
        : { resolveLaunchInputId: deps.resolveLaunchInputId }),
      ...(imported === undefined
        ? {}
        : (() => {
            const predecessor = readRunLaunchAnchor(deps.journal, imported.resumedFrom);
            return predecessor === undefined ? {} : { predecessor };
          })()),
    }),
    ...(input.phaseNames === undefined ? {} : { phaseNames: input.phaseNames }),
    ...(subagentModel === undefined ? {} : { subagentModel }),
    ...(modelBindings === undefined ? {} : { modelBindings }),
    ...workflowSubagentPermissionModeField(deps.permissionMode?.()),
    ...(input.scriptPath === undefined ? {} : { scriptPath: input.scriptPath }),
    ...(input.phaseAlongside === undefined ? {} : { phaseAlongside: input.phaseAlongside }),
    ...(() => {
      const holes = openHoleIndexes(input.phaseNames, compiled.holes);
      return holes === undefined ? {} : { holes };
    })(),
  };

  const controller = new AbortController();
  const control = createWorkflowRunControl();
  const entry: RunRegistryEntry = {
    controller,
    control,
    startedAt: new Date(),
    ...(input.toolCallId === undefined ? {} : { toolCallId: input.toolCallId }),
    ...(input.parentSessionId === undefined ? {} : { parentSessionId: input.parentSessionId }),
    cwd: input.cwd,
    ...(input.name === undefined ? {} : { name: input.name }),
    scriptText: input.scriptText,
    maxConcurrency: caps.maxConcurrency,
    ...(subagentModel === undefined ? {} : { subagentModel }),
    ...(modelBindings === undefined ? {} : { modelBindings }),
    ...(input.scriptPath === undefined ? {} : { scriptPath: input.scriptPath }),
    ...(imported === undefined ? {} : { resumedFrom: imported.resumedFrom }),
    holes: compiled.holes,
    ...(input.phaseNames === undefined ? {} : { phaseNames: input.phaseNames }),
    ...(input.inheritedTokens === undefined ? {} : { inheritedTokens: input.inheritedTokens }),
    settlement: Promise.resolve<RunSettlement>({ status: "stopped", reason: "user" }),
  };
  runs.set(runId, entry);

  entry.settlement = ctx.trackSettlement(
    runId,
    entry,
    launchDynamicWorkflowRun({
      caps,
      compiled,
      cwd: input.cwd,
      deps,
      ...(entry.name === undefined ? {} : { name: entry.name }),
      ...(input.args === undefined ? {} : { args: input.args }),
      ...(entry.parentSessionId === undefined ? {} : { parentSessionId: entry.parentSessionId }),
      escalationRegistry: escalations,
      control,
      runId,
      scriptText: input.scriptText,
      signal: controller.signal,
      ...(entry.toolCallId === undefined ? {} : { toolCallId: entry.toolCallId }),
      onQuiescenceProbe: (probe) => {
        entry.quiescence = probe;
      },
      holeTypeOf: (siteId) => entry.holes?.find((hole) => hole.siteId === siteId)?.type,
      ...(imported === undefined
        ? {}
        : { importedCache: imported.cache, resumedFrom: imported.resumedFrom }),
      ...(input.inheritedTokens === undefined ? {} : { inheritedTokens: input.inheritedTokens }),
      launch,
    }),
  );

  return runId;
}

export async function resumeDynamicWorkflowRun(
  ctx: DynamicWorkflowRunEntryContext,
  runId: string,
): Promise<DynamicWorkflowRunResumeResult> {
  const { deps, runs, escalations } = ctx;
  const record = deps.journal.getRun(runId);
  if (record === undefined) return { ok: false, reason: "not_found" };
  const live = runs.get(runId);
  if (live !== undefined && live.terminal === undefined) {
    return { ok: false, reason: "already_running" };
  }
  if (record.status === "stopped" && record.stopReason === "superseded") {
    return { ok: false, reason: "superseded" };
  }
  if (!isResumableRecord(record)) return { ok: false, reason: "not_resumable" };
  if (record.scriptText === undefined) return { ok: false, reason: "script_missing" };

  const workflow = createWorkflowProgram(record.scriptText);
  const diagnostics = collectDiagnostics(workflow.program);
  if (diagnostics.length > 0) {
    deps.logger?.warn?.("Dynamic workflow resume refused: stored script no longer compiles", {
      diagnosticCount: diagnostics.length,
      event: "dynamic_workflow.resume.compile_failed",
      module: "bootstrap.app",
      runId,
    });
    return {
      ok: false,
      reason: "compile_failed",
      message: boundedResumeDiagnostics(runId, diagnostics),
    };
  }
  const compiled = compileProgram(record.scriptText, workflow);
  if (record.scriptHash !== undefined && record.scriptHash !== compiled.scriptHash) {
    deps.logger?.warn?.("Dynamic workflow resume refused: script hash mismatch", {
      event: "dynamic_workflow.resume.script_hash_mismatch",
      expected: record.scriptHash,
      got: compiled.scriptHash,
      module: "bootstrap.app",
      runId,
    });
    return { ok: false, reason: "script_mismatch" };
  }

  //
  const rebuilt =
    record.resumedFrom === undefined
      ? undefined
      : await rebuildImportedCacheForResume(deps, {
          predecessorRunId: record.resumedFrom,
          runId,
        });

  const resumedSubagentModel = readRunSubagentModel(deps.journal, runId);
  const resumedModelBindings = readRunModelBindings(deps.journal, runId);
  const resumedScriptPath = readRunScriptPath(deps.journal, runId);
  const resumedPhaseNames = phaseNamesFromEvents(readRunHoleEvents(deps.journal, runId));
  const controller = new AbortController();
  const control = createWorkflowRunControl();
  const entry: RunRegistryEntry = {
    controller,
    control,
    startedAt: new Date(),
    maxConcurrency: record.caps.maxConcurrency,
    ...(record.toolCallId === undefined ? {} : { toolCallId: record.toolCallId }),
    ...(record.parentSessionId === undefined ? {} : { parentSessionId: record.parentSessionId }),
    cwd: record.cwd ?? process.cwd(),
    ...(record.name === undefined ? {} : { name: record.name }),
    scriptText: record.scriptText,
    ...(resumedSubagentModel === undefined ? {} : { subagentModel: resumedSubagentModel }),
    ...(resumedModelBindings === undefined ? {} : { modelBindings: resumedModelBindings }),
    ...(resumedScriptPath === undefined ? {} : { scriptPath: resumedScriptPath }),
    holes: compiled.holes,
    ...(resumedPhaseNames === undefined ? {} : { phaseNames: resumedPhaseNames }),
    settlement: Promise.resolve<RunSettlement>({ status: "stopped", reason: "user" }),
  };
  runs.set(runId, entry);

  entry.settlement = ctx.trackSettlement(
    runId,
    entry,
    launchDynamicWorkflowRun({
      holeTypeOf: (siteId) => entry.holes?.find((hole) => hole.siteId === siteId)?.type,
      caps: record.caps,
      compiled,
      cwd: record.cwd ?? process.cwd(),
      deps,
      ...(record.name === undefined ? {} : { name: record.name }),
      ...(record.args === undefined ? {} : { args: record.args }),
      ...(record.parentSessionId === undefined ? {} : { parentSessionId: record.parentSessionId }),
      escalationRegistry: escalations,
      control,
      runId,
      scriptText: record.scriptText,
      signal: controller.signal,
      ...(record.toolCallId === undefined ? {} : { toolCallId: record.toolCallId }),
      onQuiescenceProbe: (probe) => {
        entry.quiescence = probe;
      },
      ...(rebuilt === undefined ? {} : { importedCache: rebuilt }),
    }),
  );

  return {
    ok: true,
    runId,
    ...(record.toolCallId === undefined ? {} : { toolCallId: record.toolCallId }),
  };
}

function mintRunId(): string {
  return `dwfrun-${randomUUID()}`;
}

function formatModelBindings(
  bindings: Record<string, ModelSelection> | undefined,
): Record<string, string> | undefined {
  if (bindings === undefined) return undefined;
  const entries = Object.entries(bindings);
  if (entries.length === 0) return undefined;
  return Object.fromEntries(
    entries.map(([name, selection]) => [name, formatModelPickerValue(selection)]),
  );
}
