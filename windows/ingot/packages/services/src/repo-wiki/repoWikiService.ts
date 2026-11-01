import type {
  CfWorkspaceGenerateTextParams,
  RepoWikiCancelRequest,
  RepoWikiGenerateRequest,
  RepoWikiGenerateResult,
  RepoWikiModelOption,
  RepoWikiModelsRequest,
  RepoWikiModelsResult,
  RepoWikiPage,
  RepoWikiPageRequest,
  RepoWikiPageResult,
  RepoWikiPageSummary,
  RepoWikiSnapshot,
  RepoWikiSnapshotRequest,
  RepoWikiStats,
  RepoWikiStatus,
} from "@origin-ai/cf-shared";
import { isFreeModelCandidate, repoWikiWorkspaceKey } from "@origin-ai/cf-shared";
import type { ServiceLogger } from "#src/logger/serviceLogger.js";
import type { IRepoWikiService } from "./repoWiki.js";
import { planRepoWikiPages, buildRepoWikiPagePrompt, type RepoWikiPagePlan } from "./repoWikiPrompts.js";
import { scanRepo, type RepoScanModule, type RepoScanResult } from "./repoScanner.js";
import {
  isSafeWikiSlug,
  readWikiManifest,
  readWikiPageMarkdown,
  readWorkspaceBranch,
  writeWikiManifest,
  writeWikiPage,
  type RepoWikiManifest,
} from "./repoWikiStorage.js";

const REPO_WIKI_QUERY_SOURCE = "repo_wiki";
const SUPPORTED_LANGUAGE_DEFAULT = "en";

export interface RepoWikiModelViewLike {
  preferredSelection?: {
    providerId: string;
    modelId: string;
    options?: Record<string, unknown>;
  } | null;
  providers: ReadonlyArray<{
    providerId: string;
    providerName?: string;
    models: ReadonlyArray<{ modelId: string }>;
  }>;
}

export interface RepoWikiTextGenerator {
  generateText(params: {
    workspacePath: string;
    workspaceIdentity?: string;
    selection: CfWorkspaceGenerateTextParams["selection"];
    prompt: string;
    querySource: string;
  }): Promise<{ text: string }>;
}

export interface CreateRepoWikiServiceOptions {
  textGenerator: RepoWikiTextGenerator;
  readModelView(): Promise<RepoWikiModelViewLike | null>;
  logger?: ServiceLogger;
}

interface RepoWikiJobState {
  status: RepoWikiStatus;
  progress: number;
  currentStep?: string;
  error?: string;
  abort: AbortController;
  pages: RepoWikiPageSummary[];
  stats: RepoWikiStats;
}

const EMPTY_STATS: RepoWikiStats = {
  fileCount: 0,
  totalBytes: 0,
  languages: [],
};

function jobKey(workspacePath: string, language: string): string {
  return `${workspacePath}\u0000${language}`;
}

function normalizeLanguage(language: string | undefined): string {
  const trimmed = language?.trim();
  return trimmed ? trimmed : SUPPORTED_LANGUAGE_DEFAULT;
}

function toPageSummary(plan: RepoWikiPagePlan): RepoWikiPageSummary {
  return {
    slug: plan.slug,
    title: plan.title,
    kind: plan.kind,
    order: plan.order,
    sourcePaths: plan.sourcePaths,
    ...(plan.modulePath ? { modulePath: plan.modulePath } : {}),
  };
}

function normalizePageMarkdown(raw: string, title: string): string {
  let text = raw.trim();
  const fenced = /^```(?:markdown|md)?\n([\s\S]*?)\n```$/i.exec(text);
  if (fenced?.[1]) text = fenced[1].trim();
  if (!/^#\s/.test(text)) text = `# ${title}\n\n${text}`;
  return `${text}\n`;
}

function flattenModels(view: RepoWikiModelViewLike | null): RepoWikiModelOption[] {
  if (!view) return [];
  const preferred = view.preferredSelection;
  return view.providers.flatMap((provider) =>
    provider.models.map((model) => ({
      providerId: provider.providerId,
      providerLabel: provider.providerName ?? provider.providerId,
      modelId: model.modelId,
      label: `${model.modelId} · ${provider.providerName ?? provider.providerId}`,
      free: isFreeModelCandidate(provider.providerId, model.modelId),
      ...(preferred &&
      preferred.providerId === provider.providerId &&
      preferred.modelId === model.modelId
        ? { selected: true }
        : {}),
    })),
  );
}

export function createRepoWikiService(
  options: CreateRepoWikiServiceOptions,
): IRepoWikiService {
  const jobs = new Map<string, RepoWikiJobState>();

  const snapshotOf = async (
    request: RepoWikiSnapshotRequest,
  ): Promise<RepoWikiSnapshot> => {
    const language = normalizeLanguage(request.language);
    const key = jobKey(request.workspacePath, language);
    const job = jobs.get(key);
    const manifest = await readWikiManifest(request.workspacePath, language);
    const branch = await readWorkspaceBranch(request.workspacePath);

    let status: RepoWikiStatus = manifest ? "ready" : "absent";
    if (job) {
      status = job.status;
    } else if (manifest && manifest.branch !== branch) {
      status = "stale";
    }

    const pages = job?.pages.length ? job.pages : (manifest?.pages ?? []);
    const stats = job?.stats ?? manifest?.stats ?? EMPTY_STATS;
    const progress = job ? job.progress : manifest ? 100 : 0;

    return {
      workspacePath: request.workspacePath,
      language,
      branch,
      workspaceKey: repoWikiWorkspaceKey(request.workspacePath, branch, language),
      status,
      progress,
      pages,
      stats,
      wikiRoot: `.cf/repowiki/${language}`,
      ...(job?.currentStep ? { currentStep: job.currentStep } : {}),
      ...(job?.error ? { error: job.error } : {}),
    };
  };

  const resolveSelection = async (
    request: RepoWikiGenerateRequest,
  ): Promise<CfWorkspaceGenerateTextParams["selection"]> => {
    if (request.model) {
      return request.model as CfWorkspaceGenerateTextParams["selection"];
    }
    const view = await options.readModelView();
    const candidates = flattenModels(view);
    if (request.freeOnly) {
      const free = candidates.find((candidate) => candidate.free);
      if (!free) throw new Error("no_free_model_available");
      return { providerId: free.providerId, modelId: free.modelId };
    }
    if (view?.preferredSelection) {
      return view.preferredSelection as CfWorkspaceGenerateTextParams["selection"];
    }
    const first = candidates[0];
    if (!first) throw new Error("no_model_available");
    return { providerId: first.providerId, modelId: first.modelId };
  };

  const runGeneration = async (params: {
    request: RepoWikiGenerateRequest;
    language: string;
    key: string;
    job: RepoWikiJobState;
    selection: CfWorkspaceGenerateTextParams["selection"];
  }): Promise<void> => {
    const { request, language, key, job, selection } = params;
    const startedAt = Date.now();
    const moduleByPath = new Map<string, RepoScanModule>();
    try {
      const scan: RepoScanResult = await scanRepo(request.workspacePath);
      if (job.abort.signal.aborted) throw new Error("cancelled");
      job.progress = 15;
      job.currentStep = `Scanned ${scan.files.length} files`;
      job.stats = {
        fileCount: scan.files.length,
        totalBytes: scan.totalBytes,
        languages: scan.languages,
      };
      for (const module of scan.modules) moduleByPath.set(module.path, module);

      const plans = planRepoWikiPages(scan);
      job.pages = plans.map(toPageSummary);
      job.status = "generating";

      for (let index = 0; index < plans.length; index += 1) {
        if (job.abort.signal.aborted) throw new Error("cancelled");
        const plan = plans[index]!;
        const progress = 15 + Math.round((index / Math.max(1, plans.length)) * 75);
        job.progress = progress;
        job.currentStep = `Writing ${plan.title}`;

        const prompt = buildRepoWikiPagePrompt({
          plan,
          ...(plan.modulePath ? { module: moduleByPath.get(plan.modulePath) } : {}),
          scan,
          language,
        });
        const result = await options.textGenerator.generateText({
          workspacePath: request.workspacePath,
          ...(request.workspaceIdentity
            ? { workspaceIdentity: request.workspaceIdentity }
            : {}),
          selection,
          prompt,
          querySource: REPO_WIKI_QUERY_SOURCE,
        });
        if (job.abort.signal.aborted) throw new Error("cancelled");
        await writeWikiPage(
          request.workspacePath,
          language,
          plan.slug,
          normalizePageMarkdown(result.text, plan.title),
        );
      }

      job.progress = 95;
      job.currentStep = "Writing wiki manifest";
      const branch = await readWorkspaceBranch(request.workspacePath);
      const durationMs = Date.now() - startedAt;
      const stats: RepoWikiStats = {
        ...job.stats,
        generatedAt: Date.now(),
        durationMs,
        model: {
          providerId: selection.providerId,
          modelId: selection.modelId,
          ...(isFreeModelCandidate(selection.providerId, selection.modelId)
            ? { free: true }
            : {}),
        },
      };
      const manifest: RepoWikiManifest = {
        version: 1,
        language,
        branch,
        fingerprint: scan.fingerprint,
        status: "ready",
        generatedAt: stats.generatedAt ?? Date.now(),
        durationMs,
        stats,
        pages: job.pages,
      };
      await writeWikiManifest(request.workspacePath, language, manifest);
      job.progress = 100;
      job.currentStep = "Done";
      job.status = "ready";
      jobs.delete(key);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      job.status = "failed";
      job.error = message === "cancelled" ? "cancelled" : message;
      job.currentStep = message === "cancelled" ? "Cancelled" : "Failed";
      options.logger?.warn(undefined, "Repo Wiki generation failed", {
        workspacePath: request.workspacePath,
        language,
        errorMessage: message,
      });
    }
  };

  return {
    getSnapshot: (request) => snapshotOf(request),

    async generate(request: RepoWikiGenerateRequest): Promise<RepoWikiGenerateResult> {
      const language = normalizeLanguage(request.language);
      const key = jobKey(request.workspacePath, language);
      const existing = jobs.get(key);
      if (
        existing &&
        (existing.status === "initializing" || existing.status === "generating")
      ) {
        throw new Error("repo_wiki_generation_in_progress");
      }

      const selection = await resolveSelection(request);
      const job: RepoWikiJobState = {
        status: "initializing",
        progress: 2,
        currentStep: "Scanning repository",
        abort: new AbortController(),
        pages: [],
        stats: EMPTY_STATS,
      };
      jobs.set(key, job);
      void runGeneration({ request, language, key, job, selection });
      return { snapshot: await snapshotOf(request) };
    },

    async cancel(request: RepoWikiCancelRequest): Promise<void> {
      for (const [key, job] of jobs) {
        if (!key.startsWith(`${request.workspacePath}\u0000`)) continue;
        if (job.status !== "initializing" && job.status !== "generating") continue;
        job.abort.abort();
        job.status = "failed";
        job.error = "cancelled";
        job.currentStep = "Cancelled";
      }
    },

    async readPage(request: RepoWikiPageRequest): Promise<RepoWikiPageResult> {
      const language = normalizeLanguage(request.language);
      if (!isSafeWikiSlug(request.slug)) throw new Error("invalid_repo_wiki_slug");
      const manifest = await readWikiManifest(request.workspacePath, language);
      const summary = manifest?.pages.find((page) => page.slug === request.slug);
      if (!summary) throw new Error("repo_wiki_page_not_found");
      const markdown = await readWikiPageMarkdown(
        request.workspacePath,
        language,
        request.slug,
      );
      if (markdown === null) throw new Error("repo_wiki_page_not_found");
      const page: RepoWikiPage = {
        slug: summary.slug,
        title: summary.title,
        kind: summary.kind,
        markdown,
        sourcePaths: summary.sourcePaths,
      };
      return { page };
    },

    async listModels(request?: RepoWikiModelsRequest): Promise<RepoWikiModelsResult> {
      void request;
      const view = await options.readModelView();
      const models = flattenModels(view).sort((a, b) => {
        if (a.free !== b.free) return a.free ? -1 : 1;
        return (a.label ?? a.modelId).localeCompare(b.label ?? b.modelId);
      });
      return {
        models,
        ...(view?.preferredSelection
          ? {
              preferred: {
                providerId: view.preferredSelection.providerId,
                modelId: view.preferredSelection.modelId,
              },
            }
          : {}),
      };
    },
  };
}
