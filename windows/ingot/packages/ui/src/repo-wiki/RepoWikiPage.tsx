import { useMemo } from "react";
import {
  BookOpen,
  Boxes,
  Compass,
  FileCode2,
  Layers,
  RefreshCw,
  Sparkles,
  Square,
  Wrench,
} from "lucide-react";
import type { RepoWikiPageKind, RepoWikiSnapshot } from "@origin-ai/cf-shared";
import type { IServiceAccessor } from "@origin-ai/cf-services";
import { Streamdown } from "streamdown";
import { Button } from "@/components/ui/button.js";
import { cn } from "@/components/lib/utils.js";
import { useRepoWiki } from "@/repo-wiki/useRepoWiki.js";

const PAGE_ICONS: Record<RepoWikiPageKind, typeof BookOpen> = {
  overview: Compass,
  architecture: Layers,
  "tech-stack": Wrench,
  conventions: FileCode2,
  module: Boxes,
};

const STATUS_LABELS: Record<RepoWikiSnapshot["status"], string> = {
  absent: "Not generated",
  initializing: "Scanning",
  generating: "Generating",
  ready: "Ready",
  stale: "Stale",
  failed: "Failed",
};

function statusClassName(status: RepoWikiSnapshot["status"]): string {
  switch (status) {
    case "ready":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
    case "failed":
      return "border-destructive/30 bg-destructive/10 text-destructive";
    case "stale":
      return "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400";
    case "initializing":
    case "generating":
      return "border-primary/30 bg-primary/10 text-primary";
    default:
      return "border-border bg-muted/40 text-muted-foreground";
  }
}

export interface RepoWikiPageProps {
  workspacePath: string;
  workspaceIdentity?: string;
  services: Pick<IServiceAccessor, "repoWikiService">;
}

export function RepoWikiPage({ workspacePath, workspaceIdentity, services }: RepoWikiPageProps) {
  const wiki = useRepoWiki({
    service: services.repoWikiService,
    workspacePath,
    ...(workspaceIdentity ? { workspaceIdentity } : {}),
  });
  const snapshot = wiki.snapshot;

  const { primaryPages, modulePages } = useMemo(() => {
    const pages = snapshot?.pages ?? [];
    return {
      primaryPages: pages.filter((page) => page.kind !== "module"),
      modulePages: pages.filter((page) => page.kind === "module"),
    };
  }, [snapshot?.pages]);

  const status = snapshot?.status ?? "absent";
  const hasWiki = (snapshot?.pages.length ?? 0) > 0;
  const progress = Math.max(0, Math.min(100, snapshot?.progress ?? 0));

  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-testid="repo-wiki-page">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3 md:px-6">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <BookOpen className="size-4 text-primary" />
            <h1 className="text-base font-semibold">Repo Wiki</h1>
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-[11px] font-medium",
                statusClassName(status),
              )}
            >
              {STATUS_LABELS[status]}
            </span>
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {snapshot?.wikiRoot ?? ".cf/repowiki"} ·{" "}
            {snapshot?.stats.fileCount ? `${snapshot.stats.fileCount} files` : "no snapshot yet"}
            {snapshot?.branch && snapshot.branch !== "no-git" ? ` · ${snapshot.branch}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="h-8 max-w-64 rounded-md border border-border bg-background px-2 text-xs"
            value={wiki.selectedModelKey}
            onChange={(event) => wiki.setSelectedModelKey(event.target.value)}
            aria-label="Repo Wiki model"
          >
            <option value="">Current model</option>
            {wiki.models.map((model) => (
              <option
                key={`${model.providerId}:${model.modelId}`}
                value={`${model.providerId}\u0000${model.modelId}`}
              >
                {model.modelId}
              </option>
            ))}
          </select>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => void wiki.refresh()}
            disabled={wiki.loading || wiki.generating}
          >
            <RefreshCw className={cn("size-3.5", wiki.loading && "animate-spin")} />
            Refresh
          </Button>
          {wiki.generating ? (
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => void wiki.cancel()}>
              <Square className="size-3.5" />
              Stop
            </Button>
          ) : (
            <Button size="sm" className="h-8 gap-1.5" onClick={() => void wiki.generate()}>
              <Sparkles className="size-3.5" />
              {hasWiki ? "Regenerate" : "Generate"}
            </Button>
          )}
        </div>
      </header>

      {wiki.error ? (
        <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive md:px-6">
          {wiki.error}
        </div>
      ) : null}

      {wiki.generating ? (
        <div className="border-b border-border/60 px-4 py-2 md:px-6">
          <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{snapshot?.currentStep ?? "Working…"}</span>
            <span>{progress}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      ) : null}

      {!hasWiki && !wiki.generating ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="max-w-md text-center">
            <BookOpen className="mx-auto mb-3 size-10 text-muted-foreground/60" />
            <h2 className="text-sm font-semibold">No Repo Wiki yet</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Generate a wiki from the current workspace: overview, architecture, tech stack,
              conventions and one page per top-level module. Pages are written as Markdown under
              <code className="mx-1 rounded bg-muted px-1 py-0.5">.cf/repowiki/&lt;language&gt;/</code>
              and stay on this machine.
            </p>
            <Button size="sm" className="mt-4 gap-1.5" onClick={() => void wiki.generate()}>
              <Sparkles className="size-3.5" />
              Generate wiki
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <nav className="w-60 shrink-0 overflow-y-auto border-r border-border/60 px-2 py-3">
            <PageGroup title="Guides" pages={primaryPages} selectedSlug={wiki.selectedSlug} onSelect={wiki.selectSlug} />
            {modulePages.length > 0 ? (
              <PageGroup title="Modules" pages={modulePages} selectedSlug={wiki.selectedSlug} onSelect={wiki.selectSlug} />
            ) : null}
          </nav>
          <main className="min-w-0 flex-1 overflow-y-auto px-5 py-4 md:px-8">
            {wiki.page ? (
              <article className="mx-auto max-w-3xl pb-16">
                <Streamdown mode="static" className="repo-wiki-markdown">
                  {wiki.page.markdown}
                </Streamdown>
                <footer className="mt-8 border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
                  {snapshot?.stats.model
                    ? `Generated with ${snapshot.stats.model.modelId}`
                    : "Generated locally"}
                  {snapshot?.stats.generatedAt
                    ? ` · ${new Date(snapshot.stats.generatedAt).toLocaleString()}`
                    : ""}
                  {wiki.page.sourcePaths.length > 0
                    ? ` · Sources: ${wiki.page.sourcePaths.slice(0, 6).join(", ")}`
                    : ""}
                </footer>
              </article>
            ) : (
              <p className="text-xs text-muted-foreground">Select a page to read it.</p>
            )}
          </main>
        </div>
      )}
    </div>
  );
}

function PageGroup({
  title,
  pages,
  selectedSlug,
  onSelect,
}: {
  title: string;
  pages: ReadonlyArray<{ slug: string; title: string; kind: RepoWikiPageKind }>;
  selectedSlug: string;
  onSelect(slug: string): void;
}) {
  if (pages.length === 0) return null;
  return (
    <div className="mb-4">
      <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <ul className="flex flex-col gap-0.5">
        {pages.map((page) => {
          const Icon = PAGE_ICONS[page.kind] ?? BookOpen;
          const active = page.slug === selectedSlug;
          return (
            <li key={page.slug}>
              <button
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                  active
                    ? "bg-selected text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
                onClick={() => onSelect(page.slug)}
              >
                <Icon className="size-3.5 shrink-0" />
                <span className="truncate">{page.title}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
