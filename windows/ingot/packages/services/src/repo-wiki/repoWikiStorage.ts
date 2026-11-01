import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RepoWikiPageSummary, RepoWikiStats } from "@origin-ai/cf-shared";

export const REPO_WIKI_ROOT_DIR = ".cf";
export const REPO_WIKI_DIR = "repowiki";
export const REPO_WIKI_MANIFEST_FILE = "wiki.json";

export interface RepoWikiManifest {
  version: 1;
  language: string;
  branch: string;
  fingerprint: string;
  status: "ready";
  generatedAt: number;
  durationMs: number;
  stats: RepoWikiStats;
  pages: RepoWikiPageSummary[];
}

export function resolveWikiLanguageDir(workspacePath: string, language: string): string {
  return join(workspacePath, REPO_WIKI_ROOT_DIR, REPO_WIKI_DIR, language);
}

export function resolveWikiManifestPath(workspacePath: string, language: string): string {
  return join(resolveWikiLanguageDir(workspacePath, language), REPO_WIKI_MANIFEST_FILE);
}

export function resolveWikiPagePath(
  workspacePath: string,
  language: string,
  slug: string,
): string {
  return join(resolveWikiLanguageDir(workspacePath, language), `${slug}.md`);
}

export function isSafeWikiSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9\-_/]*$/.test(slug) && !slug.includes("..") && !slug.endsWith("/");
}

export async function readWikiManifest(
  workspacePath: string,
  language: string,
): Promise<RepoWikiManifest | null> {
  try {
    const raw = await readFile(resolveWikiManifestPath(workspacePath, language), "utf8");
    const parsed = JSON.parse(raw) as RepoWikiManifest;
    if (parsed?.version !== 1 || !Array.isArray(parsed.pages)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function writeWikiManifest(
  workspacePath: string,
  language: string,
  manifest: RepoWikiManifest,
): Promise<void> {
  const path = resolveWikiManifestPath(workspacePath, language);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

export async function writeWikiPage(
  workspacePath: string,
  language: string,
  slug: string,
  markdown: string,
): Promise<void> {
  const path = resolveWikiPagePath(workspacePath, language, slug);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, markdown.endsWith("\n") ? markdown : `${markdown}\n`, "utf8");
}

export async function readWikiPageMarkdown(
  workspacePath: string,
  language: string,
  slug: string,
): Promise<string | null> {
  try {
    return await readFile(resolveWikiPagePath(workspacePath, language, slug), "utf8");
  } catch {
    return null;
  }
}

/**
 * Best-effort branch name without spawning git: read `.git/HEAD` for the ref, fall back to
 * the literal HEAD commit or a stable "no-git" marker.
 */
export async function readWorkspaceBranch(workspacePath: string): Promise<string> {
  try {
    const head = (await readFile(join(workspacePath, ".git", "HEAD"), "utf8")).trim();
    const match = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
    if (match?.[1]) return match[1];
    if (head) return head.slice(0, 12);
    return "no-git";
  } catch {
    return "no-git";
  }
}
