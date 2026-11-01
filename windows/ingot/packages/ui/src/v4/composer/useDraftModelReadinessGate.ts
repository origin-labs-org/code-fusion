import { useCallback, useEffect, useMemo, useState } from "react";
import { isCfAgentProvider, CF_AGENT_PROVIDER, type CfProvider } from "@origin-ai/cf-shared";
import type { IModelSelectionService, ModelSelectionView } from "@origin-ai/cf-services";
import {
  buildModelConfigMissingUiError,
  type ModelConfigMissingUiError,
} from "@/lib/chatPrepareError.js";
import { logger } from "@/logger.js";

type DraftModelReadinessStatus = "checking" | "ready" | "missing" | "check-failed";

interface DraftModelReadinessState {
  scope: object;
  status: DraftModelReadinessStatus;
  dismissed: boolean;
}

export interface DraftModelReadinessGate {
  
  agentStartupAllowed: boolean;
  error: ModelConfigMissingUiError | null;
  dismissError(): void;
  
  ensureReadyForSend(): Promise<boolean>;
  
  markProviderNotReady(): void;
}

export function resolveModelSelectionReadinessStatus(
  view: ModelSelectionView,
): Extract<DraftModelReadinessStatus, "ready" | "missing"> {
  return view.providers.some((provider) => provider.models.length > 0) ? "ready" : "missing";
}

export function useDraftModelReadinessGate(params: {
  workspacePath: string;
  workspaceIdentity?: string;
  provider?: CfProvider;
  sessionId: string | null;
  modelSelectionService: Pick<IModelSelectionService, "getView" | "onDidChange">;
}): DraftModelReadinessGate {
  const { workspacePath, workspaceIdentity, provider, sessionId, modelSelectionService } = params;
  const workspaceKey = workspaceIdentity?.trim() || workspacePath;
  const displayProvider = provider ?? CF_AGENT_PROVIDER;
  const enabled = sessionId === null && isCfAgentProvider(displayProvider);
  const gateKey = `${workspaceKey}\u0000${displayProvider}`;
  const scope = useMemo(() => ({ gateKey }), [enabled, gateKey, modelSelectionService]);
  const [state, setState] = useState<DraftModelReadinessState>(() => ({
    scope,
    status: enabled ? "checking" : "ready",
    dismissed: false,
  }));
  const effectiveState: DraftModelReadinessState =
    state.scope === scope
      ? state
      : { scope, status: enabled ? "checking" : "ready", dismissed: false };
  if (state.scope !== scope) setState(effectiveState);

  const commitStatus = useCallback(
    (status: DraftModelReadinessStatus, options: { revealMissing?: boolean } = {}) => {
      setState((current) =>
        current.scope !== scope
          ? current
          : {
              scope,
              status,
              dismissed:
                status === "missing"
                  ? options.revealMissing
                    ? false
                    : current.status === "missing"
                      ? current.dismissed
                      : false
                  : false,
            },
      );
    },
    [scope],
  );

  useEffect(() => {
    if (!enabled) {
      commitStatus("ready");
      return;
    }

    commitStatus("checking");
    let disposed = false;
    let registryEventVersion = 0;
    const applyStatus = (status: DraftModelReadinessStatus) => {
      if (disposed) return;
      commitStatus(status);
    };
    const subscription = modelSelectionService.onDidChange((view) => {
      registryEventVersion += 1;
      applyStatus(resolveModelSelectionReadinessStatus(view));
    });
    const initialReadVersion = registryEventVersion;
    void modelSelectionService
      .getView()
      .then((view) => {
        if (registryEventVersion !== initialReadVersion) return;
        applyStatus(resolveModelSelectionReadinessStatus(view));
      })
      .catch((error) => {
        handleReadinessFailure(error);
      });

    function handleReadinessFailure(error: unknown) {
      if (disposed) return;
      commitStatus("check-failed");
      logger.warn("[v4-draft-readiness] Provider registry check failed; falling back to Host gate", {
        error: error instanceof Error ? error.message : String(error),
        workspaceKey,
      });
    }

    return () => {
      disposed = true;
      subscription?.dispose();
    };
  }, [commitStatus, enabled, modelSelectionService, workspaceKey]);

  const markProviderNotReady = useCallback(() => {
    commitStatus("missing", { revealMissing: true });
  }, [commitStatus]);

  const ensureReadyForSend = useCallback(async (): Promise<boolean> => {
    if (!enabled) return true;
    try {
      const view = await modelSelectionService.getView();
      const status = resolveModelSelectionReadinessStatus(view);
      commitStatus(status, { revealMissing: status === "missing" });
      if (status === "missing") {
        logger.info("[v4-draft-readiness] 无可用 provider/model，草稿首发在 UI admission 拒绝", {
          providerCount: view.providers.length,
          revision: view.revision,
          workspaceKey,
        });
        return false;
      }
      return true;
    } catch (error) {
      commitStatus("check-failed");
      logger.warn("[v4-draft-readiness] Initial send provider registry recheck failed; falling back to Host gate", {
        error: error instanceof Error ? error.message : String(error),
        workspaceKey,
      });
      return true;
    }
  }, [commitStatus, enabled, modelSelectionService, workspaceKey]);

  const error = useMemo(
    () =>
      enabled && effectiveState.status === "missing" && !effectiveState.dismissed
        ? buildModelConfigMissingUiError()
        : null,
    [effectiveState.dismissed, effectiveState.status, enabled],
  );

  const dismissError = useCallback(() => {
    setState((current) =>
      current.scope === scope && current.status === "missing"
        ? { ...current, dismissed: true }
        : current,
    );
  }, [scope]);

  return {
    agentStartupAllowed:
      !enabled || effectiveState.status === "ready" || effectiveState.status === "check-failed",
    error,
    dismissError,
    ensureReadyForSend,
    markProviderNotReady,
  };
}
