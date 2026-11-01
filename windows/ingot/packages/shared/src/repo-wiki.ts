/**
 * Repo Wiki contracts.
 *
 * A Repo Wiki is a generated, on-disk knowledge base for a workspace: an overview,
 * architecture notes, tech stack, conventions and per-module pages. Generation runs
 * against the currently selected model (free / local models included) and writes
 * plain Markdown under `<workspace>/.cf/repowiki/<language>/`.
 */

export type RepoWikiStatus =
  | "absent"
  | "initializing"
  | "generating"
  | "ready"
  | "stale"
  | "failed";

export type RepoWikiPageKind =
  | "overview"
  | "architecture"
  | "tech-stack"
  | "conventions"
  | "module";

export interface RepoWikiModelRef {
  providerId: string;
  modelId: string;
  label?: string;
  free?: boolean;
}

export interface RepoWikiPageSummary {
  slug: string;
  title: string;
  kind: RepoWikiPageKind;
  order: number;
  modulePath?: string;
  sourcePaths: string[];
}

export interface RepoWikiLanguageStat {
  language: string;
  files: number;
}

export interface RepoWikiStats {
  fileCount: number;
  totalBytes: number;
  languages: RepoWikiLanguageStat[];
  generatedAt?: number;
  model?: RepoWikiModelRef;
  durationMs?: number;
}

/** Sentinel branch Qoder uses when the project is not a git checkout (observed key). */
export const REPO_WIKI_NO_BRANCH = "Q0DeR-MaG1C-BrAnCh-Fo2-NoN-GiT-Or-No-C0MmIt";

/**
 * Cache key for one wiki generation, matching the shape Qoder writes into its
 * `metadata.json` / `agent_knowledge_task.workspace_path`:
 * `<projectPath>#wiki#<branch>#wiki#<language>`.
 */
export function repoWikiWorkspaceKey(
  projectPath: string,
  branch: string | undefined,
  language: string,
): string {
  return `${projectPath}#wiki#${branch?.trim() || REPO_WIKI_NO_BRANCH}#wiki#${language}`;
}

export interface RepoWikiSnapshot {
  workspacePath: string;
  language: string;
  branch: string;
  /** `<projectPath>#wiki#<branch>#wiki#<language>` — stable per (project, branch, lang). */
  workspaceKey: string;
  status: RepoWikiStatus;
  progress: number;
  currentStep?: string;
  pages: RepoWikiPageSummary[];
  stats: RepoWikiStats;
  wikiRoot: string;
  error?: string;
}

export interface RepoWikiPage {
  slug: string;
  title: string;
  kind: RepoWikiPageKind;
  markdown: string;
  sourcePaths: string[];
}

export interface RepoWikiSnapshotRequest {
  workspacePath: string;
  workspaceIdentity?: string;
  language?: string;
}

export interface RepoWikiGenerateRequest extends RepoWikiSnapshotRequest {
  model?: {
    providerId: string;
    modelId: string;
    options?: Record<string, unknown>;
  };
  freeOnly?: boolean;
  force?: boolean;
}

export interface RepoWikiGenerateResult {
  snapshot: RepoWikiSnapshot;
}

export interface RepoWikiCancelRequest {
  workspacePath: string;
}

export interface RepoWikiPageRequest {
  workspacePath: string;
  slug: string;
  language?: string;
}

export interface RepoWikiPageResult {
  page: RepoWikiPage;
}

export interface RepoWikiModelsRequest {
  workspacePath?: string;
}

export interface RepoWikiModelOption {
  providerId: string;
  providerLabel?: string;
  modelId: string;
  label?: string;
  free: boolean;
  selected?: boolean;
}

export interface RepoWikiModelsResult {
  models: RepoWikiModelOption[];
  preferred?: { providerId: string; modelId: string };
}

/**
 * Free-tier heuristic. Providers enumerate models without pricing metadata, so we treat
 * explicit `free` markers and local runtimes as free. Kept in shared code so the host and
 * every client agree on what "generate for free" means.
 */
const FREE_MODEL_PATTERN = /(^|[-_:/.])free($|[-_:/.])/i;
const LOCAL_PROVIDER_PATTERN = /(^|[-_:/.])?(ollama|lmstudio|llama\.cpp|local)([-_:/.s]|$)/i;

export function isFreeModelCandidate(providerId: string, modelId: string): boolean {
  return FREE_MODEL_PATTERN.test(modelId) || LOCAL_PROVIDER_PATTERN.test(providerId);
}
