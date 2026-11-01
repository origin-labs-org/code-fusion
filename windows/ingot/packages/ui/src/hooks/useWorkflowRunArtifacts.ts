import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  WorkflowRunArtifact,
  WorkflowRunArtifactKind,
  WorkflowRunArtifactSummary,
  WorkflowRunArtifactVersion,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import { orderArtifactsPrimaryFirst } from "@/app-shell/workflow-artifacts/artifactPresentation.js";
import { logger } from "@/logger.js";
import { useV4Conversation } from "@/v4/V4ConversationContext.js";

export interface WorkflowRunArtifactView {
  id: string;
  kind: WorkflowRunArtifactKind;
  title?: string;
  description?: string;
  contentType?: string;
  
  bytes?: number;
  
  sourcePath?: string;
  
  version: number;
  
  versions?: readonly WorkflowRunArtifactVersion[];
  
  spec?: unknown;
  
  itemCount: number;
  
  primary?: true;
}

interface WorkflowRunArtifactsViewState {
  artifacts: readonly WorkflowRunArtifactView[];
  
  source: "live" | "journal";
  loading: boolean;
  
  unavailable: boolean;
  error: string | null;
  
  complete: boolean;
}

function isWorkflowRunArtifactsCapabilityMissing(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("capabilityUnsupported") || message.includes("ArtifactRows");
}

function summariesSignature(summaries: readonly WorkflowRunArtifactSummary[] | undefined): string {
  if (summaries === undefined) return "";
  return summaries.map((summary) => `${summary.id}:${summary.kind}:${summary.version}`).join("|");
}

function viewFromJournal(record: WorkflowRunArtifact): WorkflowRunArtifactView {
  return {
    id: record.id,
    kind: record.kind,
    ...(record.title === undefined ? {} : { title: record.title }),
    ...(record.description === undefined ? {} : { description: record.description }),
    ...(record.contentType === undefined ? {} : { contentType: record.contentType }),
    ...(record.sourcePath === undefined ? {} : { sourcePath: record.sourcePath }),
    ...(record.spec === undefined ? {} : { spec: record.spec }),
    ...(() => {
      const latest = record.versions.at(-1);
      return latest?.bytes === undefined ? {} : { bytes: latest.bytes };
    })(),
    version: record.version,
    versions: record.versions,
    itemCount: record.itemCount,
    ...(record.primary === true ? { primary: true as const } : {}),
  };
}

function viewFromSummary(summary: WorkflowRunArtifactSummary): WorkflowRunArtifactView {
  return {
    id: summary.id,
    kind: summary.kind,
    ...(summary.title === undefined ? {} : { title: summary.title }),
    ...(summary.contentType === undefined ? {} : { contentType: summary.contentType }),
    ...(summary.bytes === undefined ? {} : { bytes: summary.bytes }),
    version: summary.version,
    itemCount: summary.itemCount ?? 0,
    ...(summary.primary === true ? { primary: true as const } : {}),
  };
}

function mergeArtifacts(
  live: readonly WorkflowRunArtifactSummary[] | undefined,
  journal: readonly WorkflowRunArtifact[] | undefined,
): readonly WorkflowRunArtifactView[] {
  return orderArtifactsPrimaryFirst(mergeArtifactSources(live, journal));
}

function mergeArtifactSources(
  live: readonly WorkflowRunArtifactSummary[] | undefined,
  journal: readonly WorkflowRunArtifact[] | undefined,
): readonly WorkflowRunArtifactView[] {
  if (live === undefined) {
    return journal === undefined ? [] : journal.map(viewFromJournal);
  }
  const byId = new Map((journal ?? []).map((record) => [record.id, record] as const));
  const merged = live.map((summary) => {
    const record = byId.get(summary.id);
    if (record === undefined) return viewFromSummary(summary);
    byId.delete(summary.id);
    return {
      ...viewFromJournal(record),
      ...viewFromSummary(summary),
      ...(record.versions.length === 0 ? {} : { versions: record.versions }),
      ...(record.spec === undefined ? {} : { spec: record.spec }),
      ...(record.sourcePath === undefined ? {} : { sourcePath: record.sourcePath }),
      ...(record.description === undefined ? {} : { description: record.description }),
    } satisfies WorkflowRunArtifactView;
  });
  return [...merged, ...[...byId.values()].map(viewFromJournal)];
}

export function useWorkflowRunArtifacts(options: {
  sessionId: string;
  runId: string;
  
  live?: readonly WorkflowRunArtifactSummary[];
  enabled?: boolean;
}): WorkflowRunArtifactsViewState {
  const { workflowRunArtifacts } = useV4Conversation();
  const [journal, setJournal] = useState<readonly WorkflowRunArtifact[] | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestVersionRef = useRef(0);

  const enabled =
    options.enabled !== false && options.sessionId.length > 0 && options.runId.length > 0;
  const signature = summariesSignature(options.live);
  const { sessionId, runId } = options;

  const fetchArtifacts = useCallback(async () => {
    const requestVersion = ++requestVersionRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await workflowRunArtifacts({ sessionId, runId });
      if (requestVersion !== requestVersionRef.current) return;
      setJournal(result.artifacts);
      setUnavailable(false);
      setLoading(false);
    } catch (caught) {
      if (requestVersion !== requestVersionRef.current) return;
      setLoading(false);
      if (isWorkflowRunArtifactsCapabilityMissing(caught)) {
        setJournal(undefined);
        setUnavailable(true);
        return;
      }
      const message = caught instanceof Error ? caught.message : String(caught);
      logger.warn("[workflow-artifacts] 读取产物清单失败", { error: message, runId, sessionId });
      setError(message);
    }
  }, [runId, sessionId, workflowRunArtifacts]);

  useEffect(() => {
    requestVersionRef.current += 1;
    setJournal(undefined);
    setUnavailable(false);
    setError(null);
    if (!enabled) {
      setLoading(false);
      return;
    }
    void fetchArtifacts();
  }, [enabled, fetchArtifacts, signature]);

  return useMemo(
    () => ({
      artifacts: mergeArtifacts(options.live, journal),
      source: options.live === undefined ? "journal" : "live",
      loading,
      unavailable,
      error,
      complete: options.live !== undefined || journal !== undefined,
    }),
    [error, journal, loading, options.live, unavailable],
  );
}
