

import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface HarnessWarning {
  kind: "entry_file_fallback";
  
  projectDir: string;
  
  fallbackDir: string;
  
  error: string;
}

export interface WriteChildEntryFileInput {
  cwd: string;
  runId: string;
  
  source: string;
  onWarning?: (warning: HarnessWarning) => void;
}

export interface ChildEntryFile {
  path: string;
  location: "project" | "tmpdir";
}

export function workflowRunsDir(cwd: string): string {
  return join(cwd, ".cf", "workflow-runs");
}

export function fallbackWorkflowRunsDir(): string {
  return join(tmpdir(), "cf-workflow-runs");
}

export function childEntryFileName(runId: string): string {
  return `${runId.replace(/[^A-Za-z0-9._-]/g, "_")}.mjs`;
}

export function writeChildEntryFile(input: WriteChildEntryFileInput): ChildEntryFile {
  const projectDir = workflowRunsDir(input.cwd);
  const fileName = childEntryFileName(input.runId);
  try {
    return { path: writeInto(projectDir, fileName, input.source), location: "project" };
  } catch (error) {
    const fallbackDir = fallbackWorkflowRunsDir();
    input.onWarning?.({
      kind: "entry_file_fallback",
      projectDir,
      fallbackDir,
      error: error instanceof Error ? error.message : String(error),
    });
    return { path: writeInto(fallbackDir, fileName, input.source), location: "tmpdir" };
  }
}

function writeInto(dir: string, fileName: string, source: string): string {
  mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(join(dir, ".gitignore"), "*\n", { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if ((error as { code?: string }).code !== "EEXIST") throw error;
  }
  const path = join(dir, fileName);
  writeFileSync(path, source, "utf8");
  return path;
}
