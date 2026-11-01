import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  RepoWikiModelOption,
  RepoWikiPage as RepoWikiPageContent,
  RepoWikiSnapshot,
} from "@origin-ai/cf-shared";
import type { IRepoWikiService } from "@origin-ai/cf-services";

const POLL_INTERVAL_MS = 1_200;

export interface UseRepoWikiResult {
  snapshot: RepoWikiSnapshot | null;
  page: RepoWikiPageContent | null;
  models: RepoWikiModelOption[];
  selectedSlug: string;
  selectedModelKey: string;
  loading: boolean;
  generating: boolean;
  error: string | null;
  selectSlug(slug: string): void;
  setSelectedModelKey(key: string): void;
  refresh(): Promise<void>;
  generate(): Promise<void>;
  cancel(): Promise<void>;
}

function parseModelKey(key: string): { providerId: string; modelId: string } | null {
  const [providerId, modelId] = key.split("\u0000");
  return providerId && modelId ? { providerId, modelId } : null;
}

export function useRepoWiki(params: {
  service: IRepoWikiService | undefined;
  workspacePath: string;
  workspaceIdentity?: string;
}): UseRepoWikiResult {
  const { service, workspacePath, workspaceIdentity } = params;
  const [snapshot, setSnapshot] = useState<RepoWikiSnapshot | null>(null);
  const [page, setPage] = useState<RepoWikiPageContent | null>(null);
  const [models, setModels] = useState<RepoWikiModelOption[]>([]);
  const [selectedSlug, setSelectedSlug] = useState("overview");
  const [selectedModelKey, setSelectedModelKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestToken = useRef(0);

  const generating =
    snapshot?.status === "initializing" || snapshot?.status === "generating";

  const refresh = useCallback(async () => {
    if (!service) return;
    const token = ++requestToken.current;
    setLoading(true);
    try {
      const next = await service.getSnapshot({
        workspacePath,
        ...(workspaceIdentity ? { workspaceIdentity } : {}),
      });
      if (token !== requestToken.current) return;
      setSnapshot(next);
      setError(next.status === "failed" ? (next.error ?? "generation_failed") : null);
      const hasSelected = next.pages.some((entry) => entry.slug === selectedSlug);
      const slug = hasSelected ? selectedSlug : (next.pages[0]?.slug ?? "overview");
      if (slug !== selectedSlug) setSelectedSlug(slug);
      if (next.pages.length > 0) {
        const result = await service.readPage({ workspacePath, slug });
        if (token === requestToken.current) setPage(result.page);
      } else {
        setPage(null);
      }
    } catch (caught) {
      if (token === requestToken.current) {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    } finally {
      if (token === requestToken.current) setLoading(false);
    }
  }, [selectedSlug, service, workspaceIdentity, workspacePath]);

  const loadModels = useCallback(async () => {
    if (!service) return;
    try {
      const result = await service.listModels({ workspacePath });
      setModels(result.models);
      const preferred = result.preferred;
      if (preferred) {
        setSelectedModelKey(`${preferred.providerId}\u0000${preferred.modelId}`);
      }
    } catch {
      setModels([]);
    }
  }, [service, workspacePath]);

  useEffect(() => {
    setSnapshot(null);
    setPage(null);
    setSelectedSlug("overview");
    void refresh();
    void loadModels();
    // Intentionally keyed by workspace only: selecting a page must not re-scan the wiki.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspacePath, workspaceIdentity, service]);

  useEffect(() => {
    if (!selectedSlug) return;
    let cancelled = false;
    void (async () => {
      if (!service) return;
      try {
        const result = await service.readPage({ workspacePath, slug: selectedSlug });
        if (!cancelled) setPage(result.page);
      } catch {
        if (!cancelled) setPage(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedSlug, service, workspacePath]);

  useEffect(() => {
    if (!generating) return;
    const timer = setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [generating, refresh]);

  const generate = useCallback(async () => {
    if (!service) return;
    setError(null);
    try {
      const model = parseModelKey(selectedModelKey);
      await service.generate({
        workspacePath,
        ...(workspaceIdentity ? { workspaceIdentity } : {}),
        ...(model ? { model } : {}),
      });
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [refresh, selectedModelKey, service, workspaceIdentity, workspacePath]);

  const cancel = useCallback(async () => {
    if (!service) return;
    try {
      await service.cancel({ workspacePath });
    } finally {
      await refresh();
    }
  }, [refresh, service, workspacePath]);

  return useMemo(
    () => ({
      snapshot,
      page,
      models,
      selectedSlug,
      selectedModelKey,
      loading,
      generating,
      error,
      selectSlug: setSelectedSlug,
      setSelectedModelKey,
      refresh,
      generate,
      cancel,
    }),
    [
      cancel,
      error,
      generate,
      generating,
      loading,
      models,
      page,
      refresh,
      selectedModelKey,
      selectedSlug,
      snapshot,
    ],
  );
}
