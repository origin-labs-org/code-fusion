// ============================================================
// ============================================================
//
//      `fill_ids_unstable`；
//      `hole_not_waiting`；
//

import { rm, writeFile } from "node:fs/promises";
import type { DynamicWorkflowRunFillHoleRequest, FillWorkflowHoleResult } from "@origin-ai/cf-contracts";
import {
  analyzeWorkflowScript,
  checkSiteStability,
  collectPhaseNames,
  collectSites,
  createWorkflowProgram,
  interpret,
  projectControlFlow,
  spliceHoleBody,
  type SiteTable,
  type WorkflowProgram,
} from "@origin-ai/cf-dynamic-workflow";
import { compileProgram } from "./dynamic-workflow-run-compile.js";
import { mapFillDiagnostics, unboundFillModelDiagnostics } from "./dynamic-workflow-run-holes.js";
import type { RunRegistryEntry } from "./dynamic-workflow-run-observation.js";
import type { DynamicWorkflowRunServiceDeps } from "./dynamic-workflow-run-service.js";

export interface DynamicWorkflowRunFillContext {
  deps: DynamicWorkflowRunServiceDeps;
  runs: Map<string, RunRegistryEntry>;
  
  fillQueues: Map<string, Promise<unknown>>;
}

export function fillDynamicWorkflowHole(
  ctx: DynamicWorkflowRunFillContext,
  request: DynamicWorkflowRunFillHoleRequest,
): Promise<FillWorkflowHoleResult> {
  const { runId } = request;
  const previous = ctx.fillQueues.get(runId) ?? Promise.resolve();
  const turn = previous.then(
    () => fillOnce(ctx, request),
    () => fillOnce(ctx, request),
  );
  const settled: Promise<unknown> = turn.then(
    () => undefined,
    () => undefined,
  );
  ctx.fillQueues.set(runId, settled);
  void settled.then(() => {
    if (ctx.fillQueues.get(runId) === settled) ctx.fillQueues.delete(runId);
  });
  return turn;
}

const DRAFT_FALLBACK_NAME = "workflow";

type Refusal = Extract<FillWorkflowHoleResult, { ok: false }>;

async function fillOnce(
  ctx: DynamicWorkflowRunFillContext,
  request: DynamicWorkflowRunFillHoleRequest,
): Promise<FillWorkflowHoleResult> {
  const { deps, runs } = ctx;
  const { runId, holeId } = request;
  const entry = runs.get(runId);
  const record = deps.journal.getRun(runId);
  if (entry === undefined && record === undefined) {
    return refuse("run_not_found", `No run with id ${runId}.`);
  }
  if (entry === undefined || entry.terminal !== undefined || entry.control === undefined) {
    const status = entry?.terminal?.status ?? record?.status;
    const hint =
      status === "stopped"
        ? `Run ${runId} is stopped; ResumeWorkflowRun it first, after which the hole asks again.`
        : status === "completed" || status === "errored"
          ? `Run ${runId} has ended (${status}); nothing is waiting.`
          : `Run ${runId} is not in flight in this session.`;
    return refuse("hole_not_waiting", hint);
  }

  const scriptText = entry.scriptText;
  const workflow = createWorkflowProgram(scriptText);
  const before = collectSites(workflow);
  const site = before.holes.find((hole) => hole.id === holeId);
  if (site === undefined) {
    const known = before.holes.map((hole) => `${hole.id} (${hole.name ?? "?"})`).join(", ");
    return refuse(
      "hole_not_waiting",
      `${holeId} is not a hole of run ${runId}${known === "" ? "" : `; its holes are ${known}`}.`,
    );
  }
  if (site.body !== undefined) {
    return refuse("hole_not_waiting", `${holeId} of run ${runId} is already filled.`);
  }

  const spliced = spliceHoleBody(scriptText, before, holeId, request.body);
  if (spliced === undefined) {
    return refuse("hole_not_waiting", `${holeId} of run ${runId} cannot take a body.`);
  }
  const analysis = analyzeWorkflowScript(spliced.text);
  const diagnostics = analysis.ok
    ? unboundFillModelDiagnostics(analysis.modelReferences, entry.modelBindings)
    : analysis.diagnostics;
  if (diagnostics.length > 0) {
    return {
      ok: false,
      reason: "compile_failed",
      message: `The effective script does not compile (${diagnostics.length} diagnostic${
        diagnostics.length === 1 ? "" : "s"
      }); nothing was spliced and the hole is still waiting.`,
      diagnostics: mapFillDiagnostics({
        diagnostics,
        effectiveText: spliced.text,
        body: request.body,
        insertedAtLine: spliced.insertedAtLine,
        insertedLines: spliced.insertedLines,
      }),
    };
  }

  const effective = createWorkflowProgram(spliced.text);
  const after = collectSites(effective);
  const stability = checkSiteStability(
    before,
    after,
    holeId,
    spliced.insertedAtLine,
    spliced.insertedLines,
  );
  if (!stability.ok) {
    deps.logger?.error?.("Dynamic workflow hole fill renumbered an existing site", undefined, {
      detail: stability.detail,
      event: "dynamic_workflow.fill.ids_unstable",
      holeId,
      module: "bootstrap.app",
      runId,
    });
    return refuse(
      "fill_ids_unstable",
      `The compiled effective script renumbered an existing site (${stability.detail}). This is a host fault, not a problem with the body; the hole is still waiting.`,
    );
  }
  const compiled = compileProgram(spliced.text, effective, after);
  const code = compiled.holeBodies[holeId];
  if (code === undefined) {
    return refuse(
      "fill_ids_unstable",
      `Lowering produced no body for ${holeId}; this is a host fault and the hole is still waiting.`,
    );
  }

  const minted =
    entry.scriptPath === undefined ? await mintDraft(ctx, entry, spliced.text) : undefined;
  const filledBy =
    request.parentSessionId === undefined ? {} : { filledBy: String(request.parentSessionId) };
  const result = entry.control.fillHole({
    siteId: holeId,
    code,
    script: { text: spliced.text, hash: compiled.scriptHash },
    askSpecs: compiled.askSpecs,
    sitePhases: compiled.sitePhases,
    phaseNames: compiled.phases.phaseNames,
    ...(compiled.phases.holes.length === 0 ? {} : { holes: compiled.phases.holes }),
    ...filledBy,
    ...(minted === undefined ? {} : { scriptPath: minted }),
  });
  if (result === undefined || !result.ok) {
    if (minted !== undefined) await discardMintedDraft(ctx, runId, minted);
    const reason = result?.reason;
    deps.logger?.info?.("Dynamic workflow hole fill refused by the engine", {
      event: "dynamic_workflow.fill.refused",
      holeId,
      module: "bootstrap.app",
      reason: reason ?? "engine_unbound",
      runId,
    });
    return refuse(
      "hole_not_waiting",
      reason === "settled"
        ? `Run ${runId} has already settled; nothing is waiting.`
        : `Run ${runId} is not waiting at ${holeId}: it has not reached it yet, or it is already filled.`,
    );
  }

  const previousPhases = phaseNamesOf(workflow, before);
  entry.scriptText = spliced.text;
  entry.holes = compiled.holes;
  entry.phaseNames = compiled.phases.phaseNames;
  if (minted !== undefined) entry.scriptPath = minted;
  else await rewriteDraft(ctx, entry, runId, spliced.text);
  const scriptPath = entry.scriptPath;
  deps.logger?.info?.("Dynamic workflow hole filled", {
    event: "dynamic_workflow.fill.applied",
    holeId,
    module: "bootstrap.app",
    runId,
    ...(scriptPath === undefined ? {} : { scriptPath }),
  });
  return {
    ok: true,
    phasesAdded: compiled.phases.phaseNames.filter((name) => !previousPhases.has(name)),
    ...(scriptPath === undefined ? {} : { scriptPath }),
    scriptText: spliced.text,
  };
}

function refuse(reason: Refusal["reason"], message: string): Refusal {
  return { ok: false, reason, message };
}

function phaseNamesOf(workflow: WorkflowProgram, table: SiteTable): Set<string> {
  return new Set(collectPhaseNames(projectControlFlow(interpret(workflow, table))).phaseNames);
}

async function rewriteDraft(
  ctx: DynamicWorkflowRunFillContext,
  entry: RunRegistryEntry,
  runId: string,
  text: string,
): Promise<void> {
  if (entry.scriptPath === undefined) return;
  try {
    await writeFile(entry.scriptPath, text, "utf8");
  } catch (error) {
    ctx.deps.logger?.warn?.("Dynamic workflow draft could not be rewritten after a fill", {
      errorMessage: error instanceof Error ? error.message : String(error),
      event: "dynamic_workflow.fill.draft_rewrite_failed",
      module: "bootstrap.app",
      runId,
      scriptPath: entry.scriptPath,
    });
  }
}

async function mintDraft(
  ctx: DynamicWorkflowRunFillContext,
  entry: RunRegistryEntry,
  text: string,
): Promise<string | undefined> {
  const minted = await ctx.deps.writeWorkflowDraft?.({
    cwd: entry.cwd,
    name: entry.name ?? entry.phaseNames?.[0] ?? DRAFT_FALLBACK_NAME,
    source: text,
  });
  return minted?.path;
}

async function discardMintedDraft(
  ctx: DynamicWorkflowRunFillContext,
  runId: string,
  path: string,
): Promise<void> {
  try {
    await rm(path, { force: true });
  } catch (error) {
    ctx.deps.logger?.warn?.(
      "Dynamic workflow draft minted for a refused fill could not be removed",
      {
        errorMessage: error instanceof Error ? error.message : String(error),
        event: "dynamic_workflow.fill.minted_draft_orphaned",
        module: "bootstrap.app",
        runId,
        scriptPath: path,
      },
    );
  }
}
