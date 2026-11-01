import { sanitizeRemoteConnectionLog } from "@origin-ai/cf-shared";
import { AsyncLocalStorage } from "node:async_hooks";

export type RemoteConnectionProgressLevel = "info" | "warn" | "error";

export interface RemoteConnectionProgressEvent {
  requestId: string;
  level: RemoteConnectionProgressLevel;
  args: unknown[];
}

interface RemoteConnectionProgressStore {
  requestId: string;
  active: boolean;
}

export function createRemoteConnectionProgressContext(options: {
  emit: (event: RemoteConnectionProgressEvent) => void;
}) {
  const storage = new AsyncLocalStorage<RemoteConnectionProgressStore>();

  return {
    async run<T>(requestId: string, task: () => Promise<T>): Promise<T> {
      const store: RemoteConnectionProgressStore = { requestId, active: true };
      return storage.run(store, async () => {
        try {
          return await task();
        } finally {
          store.active = false;
        }
      });
    },

    report(level: RemoteConnectionProgressLevel, args: unknown[]): void {
      const store = storage.getStore();
      if (!store?.active) {
        return;
      }
      const message = args
        .filter((arg): arg is string => typeof arg === "string")
        .map((arg) => sanitizeRemoteConnectionLog(arg))
        .filter(Boolean)
        .join(" ");
      if (message) options.emit({ requestId: store.requestId, level, args: [message] });
    },
  };
}
