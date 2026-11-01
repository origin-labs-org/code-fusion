
import { useState, useEffect, useCallback } from "react";
import type { FileEntry } from "@origin-ai/cf-shared";
import type { IDisposable } from "@origin-ai/cf-rpc";
import { useServices } from "./useServices.js";
import { logger } from "@/logger.js";

export function useWatchedReaddir(path: string) {
  const { fileService, fileWatcherService } = useServices();
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fileService.readdir({ path });
      setEntries(result);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setLoading(false);
    }
  }, [fileService, path]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    let watcherId: string | null = null;
    const disposables: IDisposable[] = [];

    const refreshRef = { current: refresh };

    fileWatcherService
      .watch({ path })
      .then(({ id }) => {
        if (cancelled) {
          fileWatcherService.unwatch({ id });
          return;
        }
        watcherId = id;

        const sub = fileWatcherService.onDynamicChange(id)(() => {
          logger.info(`[FileWatcher] Table of ContentsChanges，AutoRefresh path=${path}`);
          refreshRef.current();
        });
        disposables.push(sub);
      })
      .catch((err) => {
        if (!cancelled) {
          logger.warn(`[FileWatcher] 监视Table of ContentsFailed path=${path}:`, err);
        }
      });

    return () => {
      cancelled = true;
      for (const d of disposables) d.dispose();
      if (watcherId) fileWatcherService.unwatch({ id: watcherId });
    };
  }, [fileWatcherService, path, refresh]);

  return { entries, loading, error, refresh };
}
