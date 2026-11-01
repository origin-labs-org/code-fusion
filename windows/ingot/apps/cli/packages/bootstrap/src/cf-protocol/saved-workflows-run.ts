//
//
import {
  SavedWorkflowMetaSchema,
  isValidSavedWorkflowName,
  type SavedWorkflowScope,
} from "@origin-ai/cf-contracts";
import {
  analyzeScript,
  findSavedWorkflowShadowing,
  listSavedWorkflows,
  resolveSavedWorkflow,
  saveSavedWorkflow,
  savedWorkflowExists,
  savedWorkflowPath,
  savedWorkflowRoot,
  type ResolvedSavedWorkflow,
} from "@origin-ai/cf-core";
import {
  cfWorkflowsForRunParamsSchema,
  cfWorkflowsSaveParamsSchema,
  type CfSavedWorkflowEntry,
  type CfWorkflowsForRunResult,
  type CfWorkflowsSaveResult,
} from "@origin-ai/cf-shared";
import type { RunRecord } from "@origin-ai/cf-dynamic-workflow";
import { resolveDynamicWorkflowJournalStore } from "../app/dynamic-workflow-run-service.js";
import { parseParams, type CfProtocolAgentServerContext } from "./server-types.js";

const SAVE_DIAGNOSTICS_MAX_LINES = 5;
const SAVE_DIAGNOSTICS_MAX_CHARS = 1_000;

const SCRIPT_MATCH_SCAN_LIMIT = 50;

function scopeOf(params: { scope?: SavedWorkflowScope }): SavedWorkflowScope {
  return params.scope ?? "project";
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function boundedDiagnostics(
  diagnostics: readonly { line: number; column: number; message: string }[],
): string {
  const text = diagnostics
    .slice(0, SAVE_DIAGNOSTICS_MAX_LINES)
    .map((diagnostic) => `L${diagnostic.line}:C${diagnostic.column} ${diagnostic.message}`)
    .join("\n");
  return text.length > SAVE_DIAGNOSTICS_MAX_CHARS
    ? `${text.slice(0, SAVE_DIAGNOSTICS_MAX_CHARS)}…`
    : text;
}

function entryOf(resolved: ResolvedSavedWorkflow): CfSavedWorkflowEntry {
  return {
    name: resolved.name,
    description: resolved.meta.description,
    ...(resolved.meta.whenToUse === undefined ? {} : { whenToUse: resolved.meta.whenToUse }),
    ...(resolved.meta.args === undefined ? {} : { args: resolved.meta.args }),
    scope: resolved.scope,
    path: resolved.path,
  };
}

function runRecordOf(
  context: CfProtocolAgentServerContext,
  runId: string,
): RunRecord | undefined {
  const journal = resolveDynamicWorkflowJournalStore(context.deps.sessionStore);
  return journal?.getRun(runId);
}

export async function saveSavedWorkflowFromRunOp(
  context: CfProtocolAgentServerContext,
  rawParams: unknown,
): Promise<CfWorkflowsSaveResult> {
  const params = parseParams(cfWorkflowsSaveParamsSchema, rawParams);
  const cwd = params.workspace.workspacePath;
  const scope = scopeOf(params);
  if (!isValidSavedWorkflowName(params.name)) return { ok: false, reason: "invalid_name" };
  const meta = SavedWorkflowMetaSchema.parse(params.meta);

  const record = runRecordOf(context, params.runId);
  if (record === undefined) return { ok: false, reason: "run_not_found" };
  const script = record.scriptText;
  if (script === undefined) return { ok: false, reason: "script_missing" };

  const path = savedWorkflowPath(savedWorkflowRoot(cwd, scope), params.name);
  if (params.overwrite !== true && savedWorkflowExists({ cwd, name: params.name, scope })) {
    return { ok: false, reason: "target_exists", path };
  }

  const analysis = analyzeScript(script);
  if (!analysis.ok) {
    return {
      ok: false,
      reason: "compile_failed",
      path,
      detail: boundedDiagnostics(analysis.diagnostics),
    };
  }

  const shadowing = findSavedWorkflowShadowing({ cwd, name: params.name, scope });
  try {
    const written = saveSavedWorkflow({ cwd, name: params.name, meta, script, scope });
    return {
      ok: true,
      name: params.name,
      scope: written.scope,
      path: written.path,
      overwritten: written.overwritten,
      ...(shadowing === undefined ? {} : { shadowing }),
    };
  } catch (error) {
    return { ok: false, reason: "write_error", path, detail: describeError(error) };
  }
}

export async function findSavedWorkflowForRunOp(
  context: CfProtocolAgentServerContext,
  rawParams: unknown,
): Promise<CfWorkflowsForRunResult> {
  const params = parseParams(cfWorkflowsForRunParamsSchema, rawParams);
  const cwd = params.workspace.workspacePath;
  const record = runRecordOf(context, params.runId);
  const runArgs = record?.args === undefined ? {} : { runArgs: record.args };

  for (const candidate of params.candidates ?? []) {
    if (!isValidSavedWorkflowName(candidate.name)) continue;
    const resolved = resolveSavedWorkflow({
      cwd,
      name: candidate.name,
      ...(candidate.scope === undefined ? {} : { scope: candidate.scope }),
    });
    if (resolved.ok) return { entry: entryOf(resolved), match: "candidate", ...runArgs };
  }

  const script = record?.scriptText;
  if (script !== undefined) {
    for (const scope of ["project", "global"] as const) {
      const listed = listSavedWorkflows({ cwd, scope });
      for (const entry of listed.entries.slice(0, SCRIPT_MATCH_SCAN_LIMIT)) {
        const resolved = resolveSavedWorkflow({ cwd, name: entry.name, scope });
        if (resolved.ok && resolved.script === script) {
          return { entry: entryOf(resolved), match: "script", ...runArgs };
        }
      }
    }
  }

  const name = record?.name;
  if (name !== undefined && isValidSavedWorkflowName(name)) {
    const resolved = resolveSavedWorkflow({ cwd, name });
    if (resolved.ok) return { entry: entryOf(resolved), match: "name", ...runArgs };
  }

  return { ...runArgs };
}
