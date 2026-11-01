import { useServices } from "@/hooks/useServices.js";
import { useWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import type { ICfTaskService } from "@origin-ai/cf-services";
import type { CfTaskSnapshot } from "@origin-ai/cf-shared";
import { uiMemoryDiagnosticsRegistry } from "@/lib/memoryDiagnostics.js";

type GetTaskSnapshotParams = Parameters<ICfTaskService["getTaskSnapshot"]>[0];
type GetTaskSnapshotResult = Promise<CfTaskSnapshot | null>;
type GetTaskSnapshotWithEtagParams = Parameters<ICfTaskService["getTaskSnapshotWithEtag"]>[0];

const cfTaskServiceProxyCache = new WeakMap<ICfTaskService, ICfTaskService>();
const snapshotInflightRequestsByService = new WeakMap<
  ICfTaskService,
  Map<string, GetTaskSnapshotResult>
>();
const snapshotCacheByService = new WeakMap<
  ICfTaskService,
  Map<string, { etag: string; snapshot: CfTaskSnapshot }>
>();
const SNAPSHOT_CACHE_STORAGE_KEY = "cf-task-snapshot-cache:v1";
const SNAPSHOT_CACHE_MAX_ENTRY_BYTES = 256 * 1024;
const SNAPSHOT_CACHE_MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const SNAPSHOT_CACHE_MAX_ENTRIES = 20;
type PersistedSnapshotCacheEntry = {
  key: string;
  etag: string;
  snapshot: CfTaskSnapshot;
  updatedAt: number;
  sizeBytes: number;
};
let persistedSnapshotCacheLoaded = false;
const persistedSnapshotCache = new Map<string, PersistedSnapshotCacheEntry>();
let latestSnapshotCache: Map<string, { etag: string; snapshot: CfTaskSnapshot }> | undefined;
uiMemoryDiagnosticsRegistry.register("taskSnapshotCache", () => ({
  entries: latestSnapshotCache?.size ?? 0,
  persisted: persistedSnapshotCache.size,
}));

export function buildSnapshotDedupeKey(params: GetTaskSnapshotParams): string {
  return [
    params.workspacePath,
    params.workspaceIdentity ?? "",
    params.taskId,
    typeof params.messageLimit === "number" ? String(params.messageLimit) : "",
    typeof params.byteBudget === "number" ? String(params.byteBudget) : "",
    typeof params.toolLimit === "number" ? String(params.toolLimit) : "",
    params.clientMode ?? "desktop-continuous",
    params.resumeModelPolicy ?? "task-index",
    params.model ?? "",
    params.thoughtLevel ?? "",
  ].join("::");
}

function getOrCreateSnapshotInflightMap(
  service: ICfTaskService,
): Map<string, GetTaskSnapshotResult> {
  if (!service || typeof service !== "object") {
    return new Map();
  }
  const existing = snapshotInflightRequestsByService.get(service);
  if (existing) {
    return existing;
  }
  const created = new Map<string, GetTaskSnapshotResult>();
  snapshotInflightRequestsByService.set(service, created);
  return created;
}

function getOrCreateSnapshotCacheMap(
  service: ICfTaskService,
): Map<string, { etag: string; snapshot: CfTaskSnapshot }> {
  if (!service || typeof service !== "object") {
    return new Map();
  }
  const existing = snapshotCacheByService.get(service);
  if (existing) {
    latestSnapshotCache = existing;
    return existing;
  }
  const created = new Map<string, { etag: string; snapshot: CfTaskSnapshot }>();
  snapshotCacheByService.set(service, created);
  latestSnapshotCache = created;
  return created;
}

function getBrowserStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function ensurePersistedSnapshotCacheLoaded() {
  if (persistedSnapshotCacheLoaded) {
    return;
  }
  persistedSnapshotCacheLoaded = true;
  const storage = getBrowserStorage();
  const raw = storage?.getItem(SNAPSHOT_CACHE_STORAGE_KEY);
  if (!raw) {
    return;
  }

  try {
    const parsed = JSON.parse(raw) as {
      entries?: PersistedSnapshotCacheEntry[];
    };
    const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    for (const entry of entries) {
      if (
        typeof entry?.key !== "string" ||
        typeof entry?.etag !== "string" ||
        !entry.snapshot ||
        typeof entry.updatedAt !== "number" ||
        typeof entry.sizeBytes !== "number"
      ) {
        continue;
      }
      persistedSnapshotCache.set(entry.key, entry);
    }
  } catch {
    // ignore storage parse errors
  }
}

function flushPersistedSnapshotCache() {
  const storage = getBrowserStorage();
  if (!storage) {
    return;
  }
  try {
    storage.setItem(
      SNAPSHOT_CACHE_STORAGE_KEY,
      JSON.stringify({ entries: [...persistedSnapshotCache.values()] }),
    );
  } catch {
    // ignore storage write errors (quota/private mode)
  }
}

function prunePersistedSnapshotCache() {
  const entries = [...persistedSnapshotCache.values()].sort(
    (left, right) => right.updatedAt - left.updatedAt,
  );
  const nextEntries: PersistedSnapshotCacheEntry[] = [];
  let totalBytes = 0;
  for (const entry of entries) {
    if (nextEntries.length >= SNAPSHOT_CACHE_MAX_ENTRIES) {
      continue;
    }
    if (totalBytes + entry.sizeBytes > SNAPSHOT_CACHE_MAX_TOTAL_BYTES) {
      continue;
    }
    nextEntries.push(entry);
    totalBytes += entry.sizeBytes;
  }
  persistedSnapshotCache.clear();
  for (const entry of nextEntries) {
    persistedSnapshotCache.set(entry.key, entry);
  }
}

function readPersistedSnapshotEntry(key: string) {
  ensurePersistedSnapshotCacheLoaded();
  const entry = persistedSnapshotCache.get(key);
  if (!entry) {
    return null;
  }
  return { etag: entry.etag, snapshot: entry.snapshot };
}

function writePersistedSnapshotEntry(
  key: string,
  etag: string,
  snapshot: CfTaskSnapshot,
): void {
  ensurePersistedSnapshotCacheLoaded();
  const serializedSnapshot = JSON.stringify(snapshot);
  const sizeBytes = new TextEncoder().encode(serializedSnapshot).byteLength;
  if (sizeBytes > SNAPSHOT_CACHE_MAX_ENTRY_BYTES) {
    persistedSnapshotCache.delete(key);
    flushPersistedSnapshotCache();
    return;
  }

  persistedSnapshotCache.set(key, {
    key,
    etag,
    snapshot,
    updatedAt: Date.now(),
    sizeBytes,
  });
  prunePersistedSnapshotCache();
  flushPersistedSnapshotCache();
}

function deletePersistedSnapshotEntry(key: string): void {
  ensurePersistedSnapshotCacheLoaded();
  persistedSnapshotCache.delete(key);
  flushPersistedSnapshotCache();
}

function createCfTaskServiceProxy(service: ICfTaskService): ICfTaskService {
  const inflight = getOrCreateSnapshotInflightMap(service);
  const snapshotCache = getOrCreateSnapshotCacheMap(service);

  return new Proxy(service, {
    get(target, prop, receiver) {
      if (prop !== "getTaskSnapshot") {
        return Reflect.get(target, prop, receiver);
      }

      return (params: GetTaskSnapshotParams) => {
        const requestKey = buildSnapshotDedupeKey(params);
        const existing = inflight.get(requestKey);
        if (existing) {
          return existing;
        }
        const cachedSnapshotEntry =
          snapshotCache.get(requestKey) ?? readPersistedSnapshotEntry(requestKey);
        if (cachedSnapshotEntry && !snapshotCache.has(requestKey)) {
          snapshotCache.set(requestKey, cachedSnapshotEntry);
        }

        const request = (async () => {
          const firstResult = await target.getTaskSnapshotWithEtag({
            ...(params as GetTaskSnapshotWithEtagParams),
            ...(cachedSnapshotEntry?.etag ? { ifNoneMatch: cachedSnapshotEntry.etag } : {}),
          });
          if (firstResult.notModified) {
            if (cachedSnapshotEntry?.snapshot) {
              return cachedSnapshotEntry.snapshot;
            }
            const fallbackResult = await target.getTaskSnapshotWithEtag(
              params as GetTaskSnapshotWithEtagParams,
            );
            if (fallbackResult.snapshot && fallbackResult.etag) {
              const nextEntry = {
                etag: fallbackResult.etag,
                snapshot: fallbackResult.snapshot,
              };
              snapshotCache.set(requestKey, nextEntry);
              writePersistedSnapshotEntry(
                requestKey,
                fallbackResult.etag,
                fallbackResult.snapshot,
              );
            }
            return fallbackResult.snapshot;
          }
          if (firstResult.snapshot && firstResult.etag) {
            const nextEntry = {
              etag: firstResult.etag,
              snapshot: firstResult.snapshot,
            };
            snapshotCache.set(requestKey, nextEntry);
            writePersistedSnapshotEntry(
              requestKey,
              firstResult.etag,
              firstResult.snapshot,
            );
          } else if (!firstResult.snapshot) {
            snapshotCache.delete(requestKey);
            deletePersistedSnapshotEntry(requestKey);
          }
          return firstResult.snapshot;
        })().finally(() => {
          if (inflight.get(requestKey) === request) {
            inflight.delete(requestKey);
          }
        });
        inflight.set(requestKey, request);
        return request;
      };
    },
  });
}

export function useCfTaskService(
  workspacePath?: string,
  preferredRemoteSessionId?: string | null,
  workspaceIdentity?: string | null,
): ICfTaskService {
  const services = workspacePath
    ? useWorkspaceServices(workspacePath, preferredRemoteSessionId, workspaceIdentity)
    : useServices();
  const rawService = services.cfTaskService;
  if (!rawService || typeof rawService !== "object") {
    return rawService;
  }
  const cachedProxy = cfTaskServiceProxyCache.get(rawService);
  if (cachedProxy) {
    return cachedProxy;
  }
  const nextProxy = createCfTaskServiceProxy(rawService);
  cfTaskServiceProxyCache.set(rawService, nextProxy);
  return nextProxy;
}
