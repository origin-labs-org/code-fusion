import { useMemo, useSyncExternalStore } from "react";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const WORKFLOW_RUN_ACK_STORAGE_KEY = "cf-workflow-run-acknowledged";

export const WORKFLOW_RUN_ACK_LIMIT = 256;

export interface WorkflowRunAckStore {
  isAcknowledged(runId: string): boolean;
  acknowledge(runIds: readonly string[]): void;
  subscribe(listener: () => void): () => void;
  
  getVersion(): number;
}

function readStored(storage: StorageLike | null): string[] {
  if (storage === null) return [];
  try {
    const raw = storage.getItem(WORKFLOW_RUN_ACK_STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

export function createWorkflowRunAckStore(storage: StorageLike | null): WorkflowRunAckStore {
  const acknowledged = new Set<string>(readStored(storage).slice(-WORKFLOW_RUN_ACK_LIMIT));
  const listeners = new Set<() => void>();
  let version = 0;
  const persist = () => {
    if (storage === null) return;
    try {
      storage.setItem(WORKFLOW_RUN_ACK_STORAGE_KEY, JSON.stringify([...acknowledged]));
    } catch {
    }
  };
  return {
    isAcknowledged: (runId) => acknowledged.has(runId),
    acknowledge: (runIds) => {
      let changed = false;
      for (const runId of runIds) {
        if (acknowledged.has(runId)) continue;
        acknowledged.add(runId);
        changed = true;
      }
      if (!changed) return;
      while (acknowledged.size > WORKFLOW_RUN_ACK_LIMIT) {
        const oldest = acknowledged.values().next().value;
        if (oldest === undefined) break;
        acknowledged.delete(oldest);
      }
      version += 1;
      persist();
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getVersion: () => version,
  };
}

function getBrowserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

let defaultStore: WorkflowRunAckStore | null = null;

export function getWorkflowRunAckStore(): WorkflowRunAckStore {
  defaultStore ??= createWorkflowRunAckStore(getBrowserStorage());
  return defaultStore;
}

export function setWorkflowRunAckStoreForTesting(store: WorkflowRunAckStore | null): void {
  defaultStore = store;
}

export function useWorkflowRunAcknowledged(): (runId: string) => boolean {
  const store = getWorkflowRunAckStore();
  const version = useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
  return useMemo(() => (runId: string) => store.isAcknowledged(runId), [store, version]);
}
