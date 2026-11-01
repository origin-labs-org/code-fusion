import type { WorkspaceFileEntry } from "@origin-ai/cf-shared";
import { logger } from "@/logger.js";
import { unpackWorkspaceFileEntries } from "@origin-ai/cf-shared/workspaceFileEntriesCodec";
import {
  filterWorkspaceFileSearchCandidates,
  mapWorkspaceFileEntriesToSearchCandidates,
  type FilterWorkspaceFileSearchCandidatesOptions,
} from "./workspaceFileSearch.js";

export interface WorkspaceFileSearchFilterBackend {
  
  setPacked(packed: string, rootPath: string): void;
  
  filter(
    query: string,
    options: FilterWorkspaceFileSearchCandidatesOptions,
  ): Promise<WorkspaceFileEntry[] | null>;
  dispose(): void;
}

export function createSyncWorkspaceFileSearchFilterBackend(): WorkspaceFileSearchFilterBackend {
  let candidates: ReturnType<typeof mapWorkspaceFileEntriesToSearchCandidates> = [];
  let byId: Map<string, WorkspaceFileEntry> = new Map();
  return {
    setPacked(packed, rootPath) {
      const entries = unpackWorkspaceFileEntries(packed, rootPath);
      candidates = mapWorkspaceFileEntriesToSearchCandidates(entries);
      byId = new Map(entries.map((entry) => [entry.relativePath, entry]));
    },
    filter(query, options) {
      return Promise.resolve(
        filterWorkspaceFileSearchCandidates(candidates, query, options)
          .map((candidate) => byId.get(candidate.id) ?? null)
          .filter((entry): entry is WorkspaceFileEntry => entry !== null),
      );
    },
    dispose() {
      candidates = [];
      byId = new Map();
    },
  };
}

export function createWorkerWorkspaceFileSearchFilterBackend(): WorkspaceFileSearchFilterBackend {
  if (typeof document === "undefined") {
    return createSyncWorkspaceFileSearchFilterBackend();
  }
  let worker: Worker;
  try {
    worker = new Worker(new URL("./workspaceFileSearchFilter.worker.ts", import.meta.url), {
      type: "module",
      name: "cf-workspace-file-search",
    });
  } catch (error) {
    logger.warn("[workspace-file-search] Failed to create Worker; falling back to main-thread synchronous filtering", {
      error: error instanceof Error ? error.message : String(error),
    });
    return createSyncWorkspaceFileSearchFilterBackend();
  }

  let seq = 0;
  const pending = new Map<
    number,
    { resolve: (entries: WorkspaceFileEntry[] | null) => void }
  >();

  worker.onmessage = (
    event: MessageEvent<{ type: string; seq?: number; entries?: WorkspaceFileEntry[] }>,
  ) => {
    const data = event.data;
    if (data.type !== "result" || typeof data.seq !== "number") {
      return;
    }
    const waiter = pending.get(data.seq);
    if (!waiter) {
      return;
    }
    pending.delete(data.seq);
    waiter.resolve(Array.isArray(data.entries) ? data.entries : null);
  };

  worker.onerror = (event) => {
    logger.warn("[workspace-file-search] Worker run failed; current filtering results discarded", {
      message: event.message,
    });
    for (const [, waiter] of pending) {
      waiter.resolve(null);
    }
    pending.clear();
  };

  return {
    setPacked(packed, rootPath) {
      seq += 1;
      for (const [, waiter] of pending) {
        waiter.resolve(null);
      }
      pending.clear();
      worker.postMessage({ type: "entries", packed, rootPath });
    },
    filter(query, options) {
      seq += 1;
      const currentSeq = seq;
      return new Promise<WorkspaceFileEntry[] | null>((resolve) => {
        pending.set(currentSeq, { resolve });
        worker.postMessage({
          type: "filter",
          seq: currentSeq,
          query,
          options,
        });
      });
    },
    dispose() {
      seq += 1;
      for (const [, waiter] of pending) {
        waiter.resolve(null);
      }
      pending.clear();
      worker.terminate();
    },
  };
}
