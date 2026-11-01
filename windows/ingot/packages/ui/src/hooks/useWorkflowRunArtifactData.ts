import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WORKFLOW_ARTIFACT_LIMITS } from "@origin-ai/cf-shared/cf-protocol-v4";
import type { ArtifactItem } from "@/app-shell/workflow-artifacts/presets/index.js";
import { logger } from "@/logger.js";
import { useV4Conversation } from "@/v4/V4ConversationContext.js";

const MAX_FOLLOW_UP_ROUNDS = 8;

interface WorkflowRunArtifactDataState {
  items: readonly ArtifactItem[];
  loading: boolean;
  
  unavailable: boolean;
  error: string | null;
}

function isFieldsParamUnsupported(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("unrecognized_keys") && message.includes("fields");
}

const sessionsWithoutFieldReads = new Set<string>();

const FIELD_KEY_SEPARATOR = "\u0000";

function isWorkflowRunArtifactDataCapabilityMissing(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("capabilityUnsupported") || message.includes("ArtifactItems");
}

function emptyState(): WorkflowRunArtifactDataState {
  return { items: [], loading: false, unavailable: false, error: null };
}

export function useWorkflowRunArtifactData(options: {
  sessionId: string;
  runId: string;
  artifactId: string;
  
  itemCount?: number;
  enabled?: boolean;
  
  fields?: readonly string[];
}): WorkflowRunArtifactDataState {
  const { workflowRunArtifactData } = useV4Conversation();
  const [state, setState] = useState<WorkflowRunArtifactDataState>(emptyState);
  const requestVersionRef = useRef(0);
  const inFlightRef = useRef(false);
  
  const pendingRef = useRef(false);
  
  const cursorRef = useRef<number | undefined>(undefined);
  
  const lastDrainedCountRef = useRef<number | undefined>(undefined);

  const { artifactId, runId, sessionId } = options;
  const fieldsKey = options.fields?.join(FIELD_KEY_SEPARATOR);
  const fields = useMemo(() => fieldsKey?.split(FIELD_KEY_SEPARATOR), [fieldsKey]);
  const enabled =
    options.enabled !== false && sessionId.length > 0 && runId.length > 0 && artifactId.length > 0;

  
  const drain = useCallback(
    async (mode: "replace" | "append") => {
      if (!enabled) return;
      if (inFlightRef.current) {
        pendingRef.current = true;
        return;
      }
      inFlightRef.current = true;
      const requestVersion = ++requestVersionRef.current;
      setState((current) => ({ ...current, loading: true, error: null }));
      try {
        let round = 0;
        let currentMode = mode;
        for (;;) {
          pendingRef.current = false;
          const collected: ArtifactItem[] = [];
          let cursor = currentMode === "append" ? cursorRef.current : undefined;
          for (;;) {
            const request = {
              sessionId,
              runId,
              artifactId,
              ...(cursor === undefined ? {} : { afterSequence: cursor }),
              limit: WORKFLOW_ARTIFACT_LIMITS.defaultItemsPerPage,
            };
            const withFields = fields !== undefined && !sessionsWithoutFieldReads.has(sessionId);
            let result;
            try {
              result = await workflowRunArtifactData(withFields ? { ...request, fields } : request);
            } catch (caught) {
              if (!withFields || !isFieldsParamUnsupported(caught)) throw caught;
              sessionsWithoutFieldReads.add(sessionId);
              logger.info("[workflow-artifacts] CLI does not support fetching fields only; falling back to full entry", { sessionId });
              result = await workflowRunArtifactData(request);
            }
            if (requestVersion !== requestVersionRef.current) return;
            collected.push(...result.items);
            const lastSequence = result.items.at(-1)?.sequence;
            const advanced =
              lastSequence !== undefined && (cursor === undefined || lastSequence > cursor);
            if (lastSequence !== undefined) cursor = lastSequence;
            if (!result.hasMore || !advanced) break;
          }
          if (requestVersion !== requestVersionRef.current) return;
          cursorRef.current = cursor;
          const settledMode = currentMode;
          setState((current) => ({
            items: settledMode === "replace" ? collected : [...current.items, ...collected],
            loading: false,
            unavailable: false,
            error: null,
          }));
          round += 1;
          if (!pendingRef.current || round >= MAX_FOLLOW_UP_ROUNDS) break;
          currentMode = "append";
        }
      } catch (caught) {
        if (requestVersion !== requestVersionRef.current) return;
        if (isWorkflowRunArtifactDataCapabilityMissing(caught)) {
          setState((current) => ({
            items: mode === "replace" ? [] : current.items,
            loading: false,
            unavailable: true,
            error: null,
          }));
          return;
        }
        const message = caught instanceof Error ? caught.message : String(caught);
        logger.warn("[workflow-artifacts] Failed to read board items", {
          artifactId,
          error: message,
          runId,
          sessionId,
        });
        setState((current) => ({ ...current, loading: false, error: message }));
      } finally {
        inFlightRef.current = false;
        pendingRef.current = false;
      }
    },
    [artifactId, enabled, fields, runId, sessionId, workflowRunArtifactData],
  );

  useEffect(() => {
    requestVersionRef.current += 1;
    cursorRef.current = undefined;
    lastDrainedCountRef.current = undefined;
    setState(emptyState());
    if (!enabled) return;
    void drain("replace");
  }, [drain, enabled]);

  //
  const itemCount = options.itemCount ?? 0;
  useEffect(() => {
    if (!enabled) return;
    if (lastDrainedCountRef.current === undefined) {
      lastDrainedCountRef.current = itemCount;
      return;
    }
    if (itemCount === lastDrainedCountRef.current) return;
    lastDrainedCountRef.current = itemCount;
    void drain("append");
  }, [drain, enabled, itemCount]);

  return useMemo(() => state, [state]);
}
