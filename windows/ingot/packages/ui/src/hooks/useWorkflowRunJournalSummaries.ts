import { useEffect, useRef, useState } from "react";
import type { V4ConversationWorkflowRunSummary } from "@origin-ai/cf-shared/cf-protocol-v4";
import { logger } from "@/logger.js";
import { useV4Conversation } from "@/v4/V4ConversationContext.js";

export function isWorkflowRunsCapabilityMissing(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("capabilityUnsupported") || message.includes("listDynamicWorkflowRuns");
}

export function useWorkflowRunJournalSummaries(options: {
  sessionId: string | null;
  live: boolean;
  
  enabled?: boolean;
  
  limit?: number;
  refreshKey?: number | string;
}): readonly V4ConversationWorkflowRunSummary[] | null {
  const { workflowRuns } = useV4Conversation();
  const { enabled = true, limit, live, refreshKey, sessionId } = options;
  const [summaries, setSummaries] = useState<readonly V4ConversationWorkflowRunSummary[] | null>(
    null,
  );
  
  const settledRef = useRef<{
    sessionId: string;
    refreshKey: number | string | undefined;
    summaries: readonly V4ConversationWorkflowRunSummary[] | null;
  } | null>(null);
  
  const capabilityMissingSessionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !sessionId) {
      setSummaries(null);
      return;
    }
    if (capabilityMissingSessionRef.current === sessionId) {
      setSummaries(null);
      return;
    }
    const settled = settledRef.current;
    if (settled?.sessionId === sessionId && settled.refreshKey === refreshKey) {
      setSummaries(settled.summaries);
      return;
    }
    setSummaries(null);
    let alive = true;
    workflowRuns({ sessionId, ...(limit === undefined ? {} : { limit }) }).then(
      (result) => {
        if (!alive) return;
        settledRef.current = { sessionId, refreshKey, summaries: result.runs };
        setSummaries(result.runs);
      },
      (error: unknown) => {
        if (!alive) return;
        if (isWorkflowRunsCapabilityMissing(error)) {
          capabilityMissingSessionRef.current = sessionId;
        } else {
          logger.warn("[workflow-run] 读取 run 摘要失败（journal 回退暂缺）", {
            error: error instanceof Error ? error.message : String(error),
            live,
            sessionId,
          });
        }
        setSummaries(null);
      },
    );
    return () => {
      alive = false;
    };
  }, [enabled, limit, live, refreshKey, sessionId, workflowRuns]);

  return summaries;
}
