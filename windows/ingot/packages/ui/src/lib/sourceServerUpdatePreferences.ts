import { useSyncExternalStore } from "react";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
const STORAGE_KEY = "cf-source-update-notifications-v1";

function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function sourceServerUpdateKey(sourceServerId: string, version: string): string {
  return JSON.stringify([sourceServerId, version]);
}

export function createSourceServerUpdatePreferences(
  storage: StorageLike | null = browserStorage(),
) {
  const seen = new Set<string>();
  let deferred = new Set<string>();
  const listeners = new Set<() => void>();
  const read = () => {
    try {
      const keys: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "[]");
      if (Array.isArray(keys)) for (const key of keys) if (typeof key === "string") seen.add(key);
    } catch {
    }
  };
  read();
  return {
    hasSeen(key: string) {
      read();
      return seen.has(key);
    },
    markSeen(key: string) {
      read();
      seen.add(key);
      try {
        storage?.setItem(STORAGE_KEY, JSON.stringify([...seen]));
      } catch {
        
      }
    },
    getDeferred: () => deferred,
    isDeferred: (key: string) => deferred.has(key),
    defer(key: string) {
      deferred = new Set(deferred).add(key);
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const sourceServerUpdatePreferences = createSourceServerUpdatePreferences();
export function useDeferredSourceServerUpdates(): ReadonlySet<string> {
  return useSyncExternalStore(
    sourceServerUpdatePreferences.subscribe,
    sourceServerUpdatePreferences.getDeferred,
    sourceServerUpdatePreferences.getDeferred,
  );
}
