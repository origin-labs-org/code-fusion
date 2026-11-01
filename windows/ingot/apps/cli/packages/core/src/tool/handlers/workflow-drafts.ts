// ============================================================
// ============================================================
//
//

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  SAVED_WORKFLOW_FILE_EXTENSION,
  WORKFLOW_DRAFTS_DIR,
  createWorkflowPhaseNames,
  type CreateWorkflowCausalityGraph,
} from "@origin-ai/cf-contracts";

const WORKFLOW_DRAFT_SLUG_DROP_PATTERN = /[^\p{L}\p{N}_.-]/gu;

const WORKFLOW_DRAFT_WHITESPACE_PATTERN = /\s+/gu;

const WORKFLOW_DRAFT_MAX_SLUG_CHARS = 64;

export const WORKFLOW_DRAFT_FALLBACK_SLUG = "workflow";

const WORKFLOW_DRAFT_MAX_ATTEMPTS = 1_000;

export interface WriteWorkflowDraftInput {
  
  cwd: string | undefined;
  
  name: string;
  
  source: string;
}

export async function writeWorkflowDraft(
  input: WriteWorkflowDraftInput,
): Promise<{ path: string } | undefined> {
  if (input.cwd === undefined || input.cwd === "") return undefined;
  try {
    const dir = path.join(input.cwd, WORKFLOW_DRAFTS_DIR);
    await mkdir(dir, { recursive: true });
    await writeDraftGitignore(dir);
    const slug = workflowDraftSlug(input.name);
    for (let attempt = 1; attempt <= WORKFLOW_DRAFT_MAX_ATTEMPTS; attempt += 1) {
      const fileName = `${attempt === 1 ? slug : `${slug}-${attempt}`}${SAVED_WORKFLOW_FILE_EXTENSION}`;
      const filePath = path.join(dir, fileName);
      try {
        await writeFile(filePath, input.source, { encoding: "utf8", flag: "wx" });
        return { path: filePath };
      } catch (error) {
        if (errorCode(error) !== "EEXIST") throw error;
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function resolveWorkflowDraftName(
  name: string | undefined,
  graph: Pick<CreateWorkflowCausalityGraph, "phases"> | undefined,
): string {
  if (name !== undefined && name.trim() !== "") return name;
  return createWorkflowPhaseNames(graph)?.[0] ?? WORKFLOW_DRAFT_FALLBACK_SLUG;
}

export function workflowDraftSlug(name: string): string {
  const reduced = Array.from(
    name
      .trim()
      .replace(WORKFLOW_DRAFT_WHITESPACE_PATTERN, "-")
      .replace(WORKFLOW_DRAFT_SLUG_DROP_PATTERN, ""),
  )
    .slice(0, WORKFLOW_DRAFT_MAX_SLUG_CHARS)
    .join("")
    .replace(/^[.-]+|[.-]+$/gu, "");
  if (reduced === "" || /^\.+$/u.test(reduced)) return WORKFLOW_DRAFT_FALLBACK_SLUG;
  return reduced;
}

async function writeDraftGitignore(dir: string): Promise<void> {
  try {
    await writeFile(path.join(dir, ".gitignore"), "*\n", { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
  }
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}
