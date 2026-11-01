// ============================================================
// ============================================================
//

import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  SAVED_WORKFLOW_FILE_EXTENSION,
  SAVED_WORKFLOW_GLOBAL_DIR,
  SAVED_WORKFLOW_MAX_NAME_CHARS,
  SAVED_WORKFLOW_PROJECT_DIR,
  isValidSavedWorkflowName,
  type SavedWorkflowEntry,
  type SavedWorkflowInvalidEntry,
  type SavedWorkflowMeta,
  type SavedWorkflowScope,
  type SavedWorkflowShadowing,
} from "@origin-ai/cf-contracts";
import { parseSavedWorkflow, serializeSavedWorkflow } from "./frontmatter.js";

export interface SavedWorkflowRoot {
  scope: SavedWorkflowScope;
  dir: string;
}

export interface SavedWorkflowRootsOptions {
  homeDir?: string;
}

export function savedWorkflowRoots(
  cwd: string,
  options?: SavedWorkflowRootsOptions,
): SavedWorkflowRoot[] {
  return [
    { scope: "project", dir: join(cwd, SAVED_WORKFLOW_PROJECT_DIR) },
    { scope: "global", dir: join(options?.homeDir ?? homedir(), SAVED_WORKFLOW_GLOBAL_DIR) },
  ];
}

export function savedWorkflowRoot(
  cwd: string,
  scope: SavedWorkflowScope,
  options?: SavedWorkflowRootsOptions,
): SavedWorkflowRoot {
  const root = savedWorkflowRoots(cwd, options).find((candidate) => candidate.scope === scope);
  return root!;
}

export interface ResolvedSavedWorkflow {
  name: string;
  path: string;
  scope: SavedWorkflowScope;
  meta: SavedWorkflowMeta;
  script: string;
  
  source: string;
  
  bodyLineOffset: number;
}

export type SavedWorkflowResolveFailure =
  | { ok: false; reason: "invalid_name"; detail: string }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "parse_error"; path: string; detail: string }
  | { ok: false; reason: "read_error"; path: string; detail: string };

export type SavedWorkflowResolveResult =
  | ({ ok: true } & ResolvedSavedWorkflow)
  | SavedWorkflowResolveFailure;

export interface SavedWorkflowListResult {
  entries: SavedWorkflowEntry[];
  invalid: SavedWorkflowInvalidEntry[];
}

export function savedWorkflowFileName(name: string): string {
  return `${name}${SAVED_WORKFLOW_FILE_EXTENSION}`;
}

export function savedWorkflowPath(root: SavedWorkflowRoot, name: string): string {
  return join(root.dir, savedWorkflowFileName(name));
}

export function resolveSavedWorkflow(options: {
  cwd: string;
  name: string;
  scope?: SavedWorkflowScope;
  homeDir?: string;
}): SavedWorkflowResolveResult {
  const { cwd, name, scope, homeDir } = options;
  if (!isValidSavedWorkflowName(name)) {
    return {
      ok: false,
      reason: "invalid_name",
      detail: `workflow names may only contain letters, digits, '.', '-' and '_', and must be 1-${SAVED_WORKFLOW_MAX_NAME_CHARS} characters`,
    };
  }

  const roots =
    scope === undefined
      ? savedWorkflowRoots(cwd, { homeDir })
      : [savedWorkflowRoot(cwd, scope, { homeDir })];

  for (const root of roots) {
    const path = savedWorkflowPath(root, name);
    let source: string;
    try {
      source = readFileSync(path, "utf8");
    } catch (error) {
      if (isNotFound(error)) continue;
      return { ok: false, reason: "read_error", path, detail: describeError(error) };
    }

    const parsed = parseSavedWorkflow(source);
    if (!parsed.ok) {
      return { ok: false, reason: "parse_error", path, detail: parsed.detail };
    }
    return {
      ok: true,
      name,
      path,
      scope: root.scope,
      meta: parsed.meta,
      script: parsed.script,
      source,
      bodyLineOffset: parsed.bodyLineOffset,
    };
  }

  return { ok: false, reason: "not_found" };
}

export function listSavedWorkflows(options: {
  cwd: string;
  scope?: SavedWorkflowScope;
  homeDir?: string;
}): SavedWorkflowListResult {
  const entries: SavedWorkflowEntry[] = [];
  const invalid: SavedWorkflowInvalidEntry[] = [];
  const claimed = new Set<string>();

  const roots =
    options.scope === undefined
      ? savedWorkflowRoots(options.cwd, { homeDir: options.homeDir })
      : [savedWorkflowRoot(options.cwd, options.scope, { homeDir: options.homeDir })];

  for (const root of roots) {
    let fileNames: string[];
    try {
      fileNames = readdirSync(root.dir);
    } catch (error) {
      if (isNotFound(error)) continue;
      invalid.push({ path: root.dir, reason: describeError(error) });
      continue;
    }

    for (const fileName of [...fileNames].sort()) {
      if (!fileName.endsWith(SAVED_WORKFLOW_FILE_EXTENSION)) continue;
      const name = fileName.slice(0, -SAVED_WORKFLOW_FILE_EXTENSION.length);
      const path = join(root.dir, fileName);

      if (!isValidSavedWorkflowName(name)) {
        invalid.push({ path, reason: "file name is not a usable workflow name" });
        continue;
      }
      if (claimed.has(name)) continue;

      let source: string;
      try {
        source = readFileSync(path, "utf8");
      } catch (error) {
        invalid.push({ path, reason: describeError(error) });
        continue;
      }

      const parsed = parseSavedWorkflow(source);
      if (!parsed.ok) {
        invalid.push({ path, reason: `${parsed.reason}: ${parsed.detail}` });
        continue;
      }

      claimed.add(name);
      entries.push({
        name,
        description: parsed.meta.description,
        ...(parsed.meta.whenToUse === undefined ? {} : { whenToUse: parsed.meta.whenToUse }),
        ...(parsed.meta.args === undefined ? {} : { args: parsed.meta.args }),
        scope: root.scope,
        path,
      });
    }
  }

  return { entries, invalid };
}

export function saveSavedWorkflow(options: {
  cwd: string;
  name: string;
  meta: SavedWorkflowMeta;
  script: string;
  scope?: SavedWorkflowScope;
  homeDir?: string;
}): { path: string; scope: SavedWorkflowScope; overwritten: boolean } {
  const root = savedWorkflowRoot(options.cwd, options.scope ?? "project", {
    homeDir: options.homeDir,
  });
  const path = savedWorkflowPath(root, options.name);
  mkdirSync(root.dir, { recursive: true });
  const overwritten = fileExists(path);
  writeFileSync(path, serializeSavedWorkflow(options.meta, options.script), "utf8");
  return { path, scope: root.scope, overwritten };
}

export function savedWorkflowExists(options: {
  cwd: string;
  name: string;
  scope?: SavedWorkflowScope;
  homeDir?: string;
}): boolean {
  if (!isValidSavedWorkflowName(options.name)) return false;
  const root = savedWorkflowRoot(options.cwd, options.scope ?? "project", {
    homeDir: options.homeDir,
  });
  return fileExists(savedWorkflowPath(root, options.name));
}

export function findSavedWorkflowShadowing(options: {
  cwd: string;
  name: string;
  scope: SavedWorkflowScope;
  homeDir?: string;
}): SavedWorkflowShadowing | undefined {
  if (!isValidSavedWorkflowName(options.name)) return undefined;
  const otherScope: SavedWorkflowScope = options.scope === "project" ? "global" : "project";
  const otherRoot = savedWorkflowRoot(options.cwd, otherScope, { homeDir: options.homeDir });
  if (!fileExists(savedWorkflowPath(otherRoot, options.name))) return undefined;
  return options.scope === "project" ? "hides_global" : "hidden_by_project";
}

export type SavedWorkflowMoveResult =
  | { ok: true; from: string; to: string }
  | { ok: false; reason: "invalid_name"; detail: string }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "target_exists"; path: string }
  | { ok: false; reason: "read_error" | "write_error"; path: string; detail: string };

export function moveSavedWorkflow(options: {
  cwd: string;
  name: string;
  homeDir?: string;
}): SavedWorkflowMoveResult {
  const { cwd, name, homeDir } = options;
  if (!isValidSavedWorkflowName(name)) {
    return {
      ok: false,
      reason: "invalid_name",
      detail: `workflow names may only contain letters, digits, '.', '-' and '_', and must be 1-${SAVED_WORKFLOW_MAX_NAME_CHARS} characters`,
    };
  }

  const fromRoot = savedWorkflowRoot(cwd, "global", { homeDir });
  const toRoot = savedWorkflowRoot(cwd, "project", { homeDir });
  const fromPath = savedWorkflowPath(fromRoot, name);
  const toPath = savedWorkflowPath(toRoot, name);

  if (!fileExists(fromPath)) return { ok: false, reason: "not_found" };
  if (fileExists(toPath)) return { ok: false, reason: "target_exists", path: toPath };

  try {
    mkdirSync(toRoot.dir, { recursive: true });
  } catch (error) {
    return { ok: false, reason: "write_error", path: toPath, detail: describeError(error) };
  }

  try {
    renameSync(fromPath, toPath);
    return { ok: true, from: fromPath, to: toPath };
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code !== "EXDEV") {
      return { ok: false, reason: "write_error", path: toPath, detail: describeError(error) };
    }
  }

  let bytes: Buffer;
  try {
    bytes = readFileSync(fromPath);
  } catch (error) {
    return { ok: false, reason: "read_error", path: fromPath, detail: describeError(error) };
  }
  try {
    writeFileSync(toPath, bytes);
    unlinkSync(fromPath);
  } catch (error) {
    return { ok: false, reason: "write_error", path: toPath, detail: describeError(error) };
  }
  return { ok: true, from: fromPath, to: toPath };
}

function fileExists(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isNotFound(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
