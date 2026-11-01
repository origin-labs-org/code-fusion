
import { useState, useEffect, useCallback } from "react";
import type { FileEntry } from "@origin-ai/cf-shared";
import { useServices } from "./useServices.js";

export function useReaddir(path: string) {
  const { fileService } = useServices();
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

  return { entries, loading, error, refresh };
}
