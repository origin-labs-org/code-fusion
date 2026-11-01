//
//
import { unlink, writeFile } from "node:fs/promises";
import { SavedWorkflowMetaSchema, isValidSavedWorkflowName } from "@origin-ai/cf-contracts";
import {
  listSavedWorkflows,
  moveSavedWorkflow,
  resolveSavedWorkflow,
  savedWorkflowPath,
  savedWorkflowRoot,
  serializeSavedWorkflow,
  type SavedWorkflowResolveFailure,
} from "@origin-ai/cf-core";
import {
  CF_WORKFLOWS_RUNS_MAX_LIMIT,
  cfWorkflowsDeleteParamsSchema,
  cfWorkflowsGetParamsSchema,
  cfWorkflowsListParamsSchema,
  cfWorkflowsMoveParamsSchema,
  cfWorkflowsRunsParamsSchema,
  cfWorkflowsUpdateMetaParamsSchema,
  type CfSavedWorkflowRun,
  type CfSavedWorkflowScope,
  type CfWorkflowsDeleteResult,
  type CfWorkflowsGetResult,
  type CfWorkflowsListResult,
  type CfWorkflowsMoveResult,
  type CfWorkflowsRunsResult,
  type CfWorkflowsUpdateMetaResult,
} from "@origin-ai/cf-shared";
import type { JournalStorePort } from "@origin-ai/cf-dynamic-workflow";
import { artifactsOf } from "../app/dynamic-workflow-run-observation.js";
import {
  resolveDynamicWorkflowJournalStore,
  supportsRunIntrospection,
} from "../app/dynamic-workflow-run-service.js";
import { parseParams, type CfProtocolAgentServerContext } from "./server-types.js";

function scopeOf(params: { scope?: CfSavedWorkflowScope }): CfSavedWorkflowScope {
  return params.scope ?? "project";
}

export async function listSavedWorkflowsOp(
  _context: CfProtocolAgentServerContext,
  rawParams: unknown,
): Promise<CfWorkflowsListResult> {
  const params = parseParams(cfWorkflowsListParamsSchema, rawParams);
  const cwd = params.workspace.workspacePath;
  const scope = scopeOf(params);
  const listed = listSavedWorkflows({ cwd, scope });
  return {
    workflows: listed.entries,
    invalid: listed.invalid,
    dir: savedWorkflowRoot(cwd, scope).dir,
  };
}

export async function getSavedWorkflowOp(
  _context: CfProtocolAgentServerContext,
  rawParams: unknown,
): Promise<CfWorkflowsGetResult> {
  const params = parseParams(cfWorkflowsGetParamsSchema, rawParams);
  const resolved = resolveSavedWorkflow({
    cwd: params.workspace.workspacePath,
    name: params.name,
    scope: scopeOf(params),
  });
  if (!resolved.ok) return toFailure(resolved);
  return {
    ok: true,
    name: resolved.name,
    path: resolved.path,
    scope: resolved.scope,
    meta: resolved.meta,
    script: resolved.script,
  };
}

export async function updateSavedWorkflowMetaOp(
  _context: CfProtocolAgentServerContext,
  rawParams: unknown,
): Promise<CfWorkflowsUpdateMetaResult> {
  const params = parseParams(cfWorkflowsUpdateMetaParamsSchema, rawParams);
  const meta = SavedWorkflowMetaSchema.parse(params.meta);
  const resolved = resolveSavedWorkflow({
    cwd: params.workspace.workspacePath,
    name: params.name,
    scope: scopeOf(params),
  });
  if (!resolved.ok) return toFailure(resolved);
  await writeFile(resolved.path, serializeSavedWorkflow(meta, resolved.script), "utf8");
  return { ok: true, path: resolved.path };
}

export async function deleteSavedWorkflowOp(
  _context: CfProtocolAgentServerContext,
  rawParams: unknown,
): Promise<CfWorkflowsDeleteResult> {
  const params = parseParams(cfWorkflowsDeleteParamsSchema, rawParams);
  if (!isValidSavedWorkflowName(params.name)) {
    return { ok: false, reason: "invalid_name" };
  }
  const root = savedWorkflowRoot(params.workspace.workspacePath, scopeOf(params));
  const path = savedWorkflowPath(root, params.name);
  try {
    await unlink(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT" || code === "ENOTDIR") return { ok: false, reason: "not_found" };
    return { ok: false, reason: "read_error", detail: describeError(error) };
  }
  return { ok: true, path };
}

export async function listSavedWorkflowRunsOp(
  context: CfProtocolAgentServerContext,
  rawParams: unknown,
): Promise<CfWorkflowsRunsResult> {
  const params = parseParams(cfWorkflowsRunsParamsSchema, rawParams);
  const journal = resolveDynamicWorkflowJournalStore(context.deps.sessionStore);
  if (journal === undefined || !supportsRunIntrospection(journal)) return { runs: [] };
  const limit = Math.min(CF_WORKFLOWS_RUNS_MAX_LIMIT, params.limit);
  const global = scopeOf(params) === "global";
  const rows = journal.listRuns({
    ...(global ? {} : { cwd: params.workspace.workspacePath }),
    limit: limit + 1,
    ...(params.name === undefined ? {} : { name: params.name }),
  });
  const truncated = rows.length > limit;
  const page = truncated ? rows.slice(0, limit) : rows;
  const artifactsByRun = savedWorkflowRunArtifacts(journal, page);
  const runs: CfSavedWorkflowRun[] = page.map((row) => ({
    runId: row.runId,
    ...(row.name === undefined ? {} : { name: row.name }),
    status: row.status,
    ...(row.stopReason === undefined ? {} : { stopReason: row.stopReason }),
    createdAt: row.timeCreated,
    updatedAt: row.timeUpdated,
    spentTokens: row.spentTokens,
    ...(row.parentSessionId === undefined ? {} : { parentSessionId: row.parentSessionId }),
    ...(row.toolCallId === undefined ? {} : { toolCallId: row.toolCallId }),
    ...(row.args === undefined ? {} : { args: row.args }),
    ...(row.cwd === undefined ? {} : { cwd: row.cwd }),
    ...(artifactsByRun.get(row.runId) === undefined
      ? {}
      : { artifacts: artifactsByRun.get(row.runId)! }),
  }));
  return { runs, ...(truncated ? { truncated: true } : {}) };
}

const SAVED_WORKFLOW_RUN_ARTIFACTS_LIMIT = 8;

function savedWorkflowRunArtifacts(
  journal: JournalStorePort,
  page: readonly { runId: string }[],
): Map<string, CfSavedWorkflowRun["artifacts"]> {
  const byRun = new Map<string, CfSavedWorkflowRun["artifacts"]>();
  for (const row of page) {
    const { artifacts } = artifactsOf(row.runId, journal);
    if (artifacts === undefined || artifacts.length === 0) continue;
    byRun.set(
      row.runId,
      artifacts.slice(0, SAVED_WORKFLOW_RUN_ARTIFACTS_LIMIT).map((artifact) => ({
        id: artifact.id,
        kind: artifact.kind,
        ...(artifact.title === undefined ? {} : { title: artifact.title }),
        version: artifact.version,
        ...(artifact.contentType === undefined ? {} : { contentType: artifact.contentType }),
      })),
    );
  }
  return byRun;
}

export async function moveSavedWorkflowOp(
  _context: CfProtocolAgentServerContext,
  rawParams: unknown,
): Promise<CfWorkflowsMoveResult> {
  const params = parseParams(cfWorkflowsMoveParamsSchema, rawParams);
  const result = moveSavedWorkflow({ cwd: params.workspace.workspacePath, name: params.name });
  if (result.ok) {
    return { ok: true, from: result.from, to: result.to };
  }
  switch (result.reason) {
    case "invalid_name":
      return { ok: false, reason: "invalid_name", detail: result.detail };
    case "not_found":
      return { ok: false, reason: "not_found" };
    case "target_exists":
      return { ok: false, reason: "target_exists", path: result.path };
    case "read_error":
    case "write_error":
      return { ok: false, reason: result.reason, path: result.path, detail: result.detail };
  }
}

function toFailure(failure: SavedWorkflowResolveFailure) {
  switch (failure.reason) {
    case "invalid_name":
      return { ok: false as const, reason: failure.reason, detail: failure.detail };
    case "not_found":
      return { ok: false as const, reason: failure.reason };
    case "parse_error":
    case "read_error":
      return { ok: false as const, reason: failure.reason, detail: failure.detail };
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
