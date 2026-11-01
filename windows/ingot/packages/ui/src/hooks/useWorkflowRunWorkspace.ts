import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WorkflowRunWorkspaceNode } from "@origin-ai/cf-shared/cf-protocol-v4";
import { logger } from "@/logger.js";
import { useV4Conversation } from "@/v4/V4ConversationContext.js";

const REFRESH_DEBOUNCE_MS = 250;

interface WorkflowRunWorkspaceState {
  nodes: readonly WorkflowRunWorkspaceNode[];
  
  loaded: boolean;
  loading: boolean;
  
  truncated: boolean;
  
  unavailable: boolean;
  error: string | null;
}

function isWorkflowRunWorkspaceCapabilityMissing(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("capabilityUnsupported") || message.includes("WorkspaceNodes");
}

export function useWorkflowRunWorkspace(options: {
  sessionId: string;
  runId: string;
  
  refreshSignal?: number;
  enabled?: boolean;
}): WorkflowRunWorkspaceState {
  const { workflowRunWorkspace } = useV4Conversation();
  const [nodes, setNodes] = useState<readonly WorkflowRunWorkspaceNode[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestVersionRef = useRef(0);

  const { runId, sessionId } = options;
  const enabled = options.enabled !== false && sessionId.length > 0 && runId.length > 0;

  const fetchNodes = useCallback(async () => {
    const requestVersion = ++requestVersionRef.current;
    setLoading(true);
    try {
      const result = await workflowRunWorkspace({ sessionId, runId });
      if (requestVersion !== requestVersionRef.current) return;
      setNodes(result.nodes);
      setTruncated(result.truncated === true);
      setUnavailable(false);
      setError(null);
      setLoaded(true);
      setLoading(false);
    } catch (caught) {
      if (requestVersion !== requestVersionRef.current) return;
      setLoading(false);
      if (isWorkflowRunWorkspaceCapabilityMissing(caught)) {
        setUnavailable(true);
        setLoaded(true);
        return;
      }
      const message = caught instanceof Error ? caught.message : String(caught);
      logger.warn("[workflow-workspace] 读取工作区清单失败", { error: message, runId, sessionId });
      setError(message);
    }
  }, [runId, sessionId, workflowRunWorkspace]);

  useEffect(() => {
    requestVersionRef.current += 1;
    setNodes([]);
    setLoaded(false);
    setTruncated(false);
    setUnavailable(false);
    setError(null);
    if (!enabled) {
      setLoading(false);
      return;
    }
    void fetchNodes();
  }, [enabled, fetchNodes]);

  const signal = options.refreshSignal;
  const lastSignalRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!enabled || signal === undefined) return;
    if (lastSignalRef.current === undefined) {
      lastSignalRef.current = signal;
      return;
    }
    if (signal <= lastSignalRef.current) return;
    lastSignalRef.current = signal;
    const timer = window.setTimeout(() => {
      void fetchNodes();
    }, REFRESH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [enabled, fetchNodes, signal]);

  return useMemo(
    () => ({ nodes, loaded, loading, truncated, unavailable, error }),
    [error, loaded, loading, nodes, truncated, unavailable],
  );
}
