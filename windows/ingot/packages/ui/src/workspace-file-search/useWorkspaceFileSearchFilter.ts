import { useEffect, useRef, useState } from "react";
import type { WorkspaceFileEntry } from "@origin-ai/cf-shared";
import {
  createWorkerWorkspaceFileSearchFilterBackend,
  type WorkspaceFileSearchFilterBackend,
} from "./workspaceFileSearchFilterBackend.js";

interface UseWorkspaceFileSearchFilterOptions {
  requireQuery?: boolean;
  limit?: number;
}

interface WorkspaceFileSearchFilterState {
  
  items: WorkspaceFileEntry[];
  
  filtering: boolean;
}

export function useWorkspaceFileSearchFilterEntries(
  packed: string,
  query: string,
  options: UseWorkspaceFileSearchFilterOptions,
  rootPath: string,
): WorkspaceFileSearchFilterState {
  const backendRef = useRef<WorkspaceFileSearchFilterBackend | null>(null);
  if (backendRef.current === null) {
    backendRef.current = createWorkerWorkspaceFileSearchFilterBackend();
  }
  const [items, setItems] = useState<WorkspaceFileEntry[]>([]);
  const [filtering, setFiltering] = useState(false);

  useEffect(() => {
    const backend = backendRef.current;
    if (!backend) {
      return;
    }
    setItems([]);
    backend.setPacked(packed, rootPath);
  }, [backendRef, packed, rootPath]);

  useEffect(() => {
    const backend = backendRef.current;
    if (!backend) {
      return;
    }
    let cancelled = false;
    setFiltering(true);
    void backend.filter(query, options).then((result) => {
      if (cancelled) {
        return;
      }
      setFiltering(false);
      if (result === null) {
        return;
      }
      setItems(result);
    });
    return () => {
      cancelled = true;
    };
  }, [backendRef, options.limit, options.requireQuery, packed, query, rootPath]);

  useEffect(() => {
    return () => {
      backendRef.current?.dispose();
      backendRef.current = null;
    };
  }, [backendRef]);

  return { items, filtering };
}
