import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type {
  IModelSelectionService,
  ModelSelectionView,
  ModelSelectionViewInput,
} from "@origin-ai/cf-services";
import { useWorkspaceServicesResolution } from "@/hooks/useWorkspaceServices.js";
import { logger } from "@/logger.js";

type ModelSelectionCatalog = Pick<ModelSelectionView, "revision" | "providers">;

export type ModelSelectionState =
  | { status: "loading"; catalog?: ModelSelectionCatalog }
  | { status: "ready"; view: ModelSelectionView; refreshError?: { revision: number; error: Error } }
  | { status: "unavailable"; reason: "remote-waiting" | "missing-target" }
  | { status: "error"; error: Error };

export type ModelSelectionRefreshResult =
  | { kind: "ready"; view: ModelSelectionView }
  | { kind: "superseded" };

export interface ModelSelectionRead {
  state: ModelSelectionState;
  reload(): void;
  refresh(): Promise<ModelSelectionRefreshResult>;
}

interface OwnedModelSelectionState {
  service: IModelSelectionService | null;
  enabled: boolean;
  unavailableReason: "remote-waiting" | "missing-target";
  inputKey: string | undefined;
  state: ModelSelectionState;
}

const INITIAL_READ_RETRY_DELAYS = [500, 1500] as const;
function isTransientReadError(cause: unknown): boolean {
  if (!cause || typeof cause !== "object") return false;
  const error = cause as { code?: unknown; name?: unknown; message?: unknown };
  return (
    ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EAI_AGAIN"].includes(String(error.code)) ||
    (error.name === "TypeError" &&
      ["Failed to fetch", "fetch failed", "Load failed"].includes(String(error.message)))
  );
}

function initialState(
  service: IModelSelectionService | null,
  enabled: boolean,
  unavailableReason: "remote-waiting" | "missing-target",
  catalog?: ModelSelectionCatalog,
): ModelSelectionState {
  return enabled && service
    ? { status: "loading", ...(catalog ? { catalog } : {}) }
    : { status: "unavailable", reason: unavailableReason };
}

function retainedCatalog(
  previous: OwnedModelSelectionState,
  service: IModelSelectionService | null,
  enabled: boolean,
  unavailableReason: "remote-waiting" | "missing-target",
): ModelSelectionCatalog | undefined {
  if (
    previous.service !== service ||
    previous.enabled !== enabled ||
    previous.unavailableReason !== unavailableReason
  )
    return undefined;
  if (previous.state.status === "ready") {
    const { revision, providers } = previous.state.view;
    return { revision, providers };
  }
  return previous.state.status === "loading" ? previous.state.catalog : undefined;
}

export function useModelSelectionServiceView(
  service: IModelSelectionService | null | undefined,
  enabled = true,
  unavailableReason: "remote-waiting" | "missing-target" = "remote-waiting",
  input?: ModelSelectionViewInput,
): ModelSelectionRead {
  const normalizedService = service ?? null;
  const inputKey = input === undefined ? undefined : JSON.stringify(input);
  const stableInput = useMemo(() => input, [inputKey]);
  const [reloadVersion, reload] = useReducer((value: number) => value + 1, 0);
  const [owned, setOwned] = useState<OwnedModelSelectionState>(() => ({
    service: normalizedService,
    enabled,
    unavailableReason,
    inputKey,
    state: initialState(normalizedService, enabled, unavailableReason),
  }));
  const ownedRef = useRef(owned);
  ownedRef.current = owned;
  const generationRef = useRef(0);
  const readRef = useRef<(() => Promise<ModelSelectionRefreshResult>) | null>(null);
  const ownerMatches =
    owned.service === normalizedService &&
    owned.enabled === enabled &&
    owned.inputKey === inputKey &&
    owned.unavailableReason === unavailableReason;
  const visibleState = ownerMatches
    ? owned.state
    : initialState(
        normalizedService,
        enabled,
        unavailableReason,
        retainedCatalog(owned, normalizedService, enabled, unavailableReason),
      );

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    const previous = ownedRef.current;
    const catalog = retainedCatalog(previous, normalizedService, enabled, unavailableReason);
    const retainedReady =
      previous.service === normalizedService &&
      previous.enabled === enabled &&
      previous.inputKey === inputKey &&
      previous.unavailableReason === unavailableReason &&
      previous.state.status === "ready"
        ? previous.state
        : null;
    setOwned({
      service: normalizedService,
      enabled,
      unavailableReason,
      inputKey,
      state: retainedReady ?? initialState(normalizedService, enabled, unavailableReason, catalog),
    });
    if (!enabled || !normalizedService) return;

    let latestRevision = retainedReady?.view.revision ?? catalog?.revision ?? -1;
    let hasReadyView = retainedReady !== null;
    let requestId = 0;
    let retryCount = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const cancelRetry = () => {
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      retryTimer = undefined;
    };
    const commit = (candidate: ModelSelectionView): void => {
      if (generation !== generationRef.current || candidate.revision < latestRevision) return;
      latestRevision = candidate.revision;
      hasReadyView = true;
      cancelRetry();
      setOwned({
        service: normalizedService,
        enabled,
        unavailableReason,
        inputKey,
        state: { status: "ready", view: candidate },
      });
    };
    const read = (): Promise<ModelSelectionRefreshResult> => {
      cancelRetry();
      const request = ++requestId;
      return normalizedService.getView(stableInput).then(
        (candidate) => {
          if (generation !== generationRef.current || request !== requestId)
            return { kind: "superseded" };
          commit(candidate);
          return { kind: "ready", view: candidate };
        },
        (cause: unknown) => {
          if (generation !== generationRef.current || request !== requestId)
            return { kind: "superseded" };
          const error = cause instanceof Error ? cause : new Error(String(cause));
          logger.warn("[model-selection] 目标 Host View 读取失败", { error });
          if (hasReadyView) {
            setOwned((previous) =>
              previous.state.status === "ready"
                ? {
                    ...previous,
                    state: { ...previous.state, refreshError: { revision: latestRevision, error } },
                  }
                : previous,
            );
          } else {
            setOwned({
              service: normalizedService,
              enabled,
              unavailableReason,
              inputKey,
              state: { status: "error", error },
            });
            const delay = INITIAL_READ_RETRY_DELAYS[retryCount];
            if (delay !== undefined && isTransientReadError(cause)) {
              retryCount += 1;
              retryTimer = setTimeout(() => {
                void read().catch(() => {});
              }, delay);
            }
          }
          throw error;
        },
      );
    };
    readRef.current = read;
    const subscription = normalizedService.onDidChange((candidate) => {
      if (generation !== generationRef.current) return;
      if (stableInput === undefined) commit(candidate);
      else {
        latestRevision = Math.max(latestRevision, candidate.revision);
        void read().catch(() => {});
      }
    });
    void read().catch(() => {});
    return () => {
      generationRef.current += 1;
      if (readRef.current === read) readRef.current = null;
      cancelRetry();
      subscription.dispose();
    };
  }, [enabled, normalizedService, reloadVersion, unavailableReason, inputKey, stableInput]);

  return {
    state: visibleState,
    reload: useCallback(() => reload(), []),
    refresh: useCallback(
      () =>
        readRef.current
          ? readRef.current()
          : Promise.reject(new Error("Model selection owner unavailable")),
      [],
    ),
  };
}

export function useModelSelectionView(
  workspacePath: string | null | undefined,
  remoteSessionId?: string | null,
  workspaceIdentity?: string | null,
  remoteTarget?: unknown,
  input?: ModelSelectionViewInput,
): ModelSelectionRead {
  const hasTarget = Boolean(workspacePath?.trim() || workspaceIdentity?.trim());
  const resolution = useWorkspaceServicesResolution(
    workspacePath,
    remoteSessionId,
    workspaceIdentity,
    remoteTarget,
  );
  const remoteWaiting = resolution.connectionKind === "remote-waiting";
  return useModelSelectionServiceView(
    resolution.services.modelSelectionService,
    hasTarget && !remoteWaiting,
    hasTarget ? "remote-waiting" : "missing-target",
    input,
  );
}
