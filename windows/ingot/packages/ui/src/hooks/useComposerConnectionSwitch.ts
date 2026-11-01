import { completeNewModelSelection } from "@origin-ai/cf-provider";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useBaseWorkspaceServices,
  useWorkspaceServicesResolution,
} from "@/hooks/useWorkspaceServices.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { persistProviderFamilyConnection } from "@/lib/providerFamilyConnectionTransition.js";
import { chooseConnectionModel, type ComposerConnection } from "@/lib/composerPlanGroups.js";
import { buildRegistryModelSelectGroups } from "@/lib/modelSelectionGroups.js";
import { decodeCustomModelValue } from "@/lib/cfCustomModelValue.js";
import { logger } from "@/logger.js";
import { resolveModelProviderFamilySpecByProviderId, type CfProvider } from "@origin-ai/cf-shared";

export function useComposerConnectionSwitch({
  workspacePath,
  workspaceIdentity,
  agentProvider,
  normalizedValue,
  onSelectModel,
  waitForPresentation = false,
  presentationStatus = "ready",
  presentationRevision,
  presentationErrorRevision,
  refreshPresentation,
}: {
  workspacePath: string;
  workspaceIdentity?: string;
  agentProvider: CfProvider;
  normalizedValue: string;
  onSelectModel: (value: string, reasoningLevel?: string) => void;
  waitForPresentation?: boolean;
  presentationStatus?: "ready" | "loading" | "error" | "unavailable";
  presentationRevision?: number;
  presentationErrorRevision?: number;
  refreshPresentation?: () => Promise<unknown>;
}) {
  const base = useBaseWorkspaceServices();
  const { services: target, rpcReady } = useWorkspaceServicesResolution(
    workspacePath,
    undefined,
    workspaceIdentity,
  );
  const { update } = useSettings({ services: base });
  const { intl } = useCfIntl();
  const workspaceKey = workspaceIdentity?.trim() || workspacePath;
  const token = useMemo(() => ({}), [target, base, workspaceKey]);
  const owner = useRef({ token, mounted: true });
  owner.current = { token, mounted: true };
  const inFlight = useRef(false);
  const [state, setState] = useState<{
    pending: boolean;
    error: string | null;
    previousKey?: string;
    expectedValue?: string;
    expectedRevision?: number;
  }>({
    pending: false,
    error: null,
  });
  useEffect(() => {
    setState({ pending: false, error: null });
    inFlight.current = false;
    return () => {
      owner.current.mounted = false;
    };
  }, [target, base, workspaceKey]);
  useEffect(() => {
    if (!state.expectedValue) return;
    if (
      presentationStatus === "error" ||
      presentationStatus === "unavailable" ||
      (presentationErrorRevision !== undefined &&
        state.expectedRevision !== undefined &&
        presentationErrorRevision >= state.expectedRevision)
    ) {
      inFlight.current = false;
      setState({
        pending: false,
        error: intl.formatMessage({ id: "chat.toolbar.connection.switchFailed" }),
      });
    } else if (presentationStatus === "ready") {
      if (
        presentationRevision !== undefined &&
        state.expectedRevision !== undefined &&
        presentationRevision < state.expectedRevision
      )
        return;
      inFlight.current = false;
      const matched = normalizedValue === state.expectedValue;
      if (!matched)
        logger.lifecycle.warn("[composer-connection] 展示选择与目标不匹配", {
          expectedValue: state.expectedValue,
          normalizedValue,
        });
      setState({
        pending: false,
        error: matched ? null : intl.formatMessage({ id: "chat.toolbar.connection.switchFailed" }),
      });
    }
  }, [
    state.expectedValue,
    state.expectedRevision,
    presentationStatus,
    presentationRevision,
    presentationErrorRevision,
    normalizedValue,
    intl,
  ]);
  const select = useCallback(
    async (connection: ComposerConnection, previousKey?: string) => {
      if (inFlight.current || !rpcReady || connection.disabled) return;
      const currentOwner = owner.current;
      const stillCurrent = () =>
        owner.current.mounted && owner.current.token === currentOwner.token;
      inFlight.current = true;
      setState({ pending: true, error: null, previousKey });
      let awaitingPresentation = false;
      try {
        const readModels = async (restoring = false) => {
          if (!restoring && !stillCurrent()) throw new Error("Composer connection owner changed");
          const baseView = await base.providerSettingsService.refresh("composer-connection");
          if (target !== base && stillCurrent()) {
            const targetView = await target.providerSettingsService.refresh("composer-connection");
            const expected = baseView.providers.find((p) => p.providerId === connection.providerId)
              ?.accountState?.connectionKey;
            const actual = targetView.providers.find((p) => p.providerId === connection.providerId)
              ?.accountState?.connectionKey;
            if (!restoring && (!expected || actual !== expected))
              throw new Error("Target connection has not synchronized");
          }
          const view = await (stillCurrent() ? target : base).modelSelectionService.getView();
          const candidate = buildRegistryModelSelectGroups(agentProvider, view).find(
            (g) => g.key === `registry-provider:${connection.providerId}`,
          );
          if (!restoring && !candidate?.items.length)
            throw new Error("Selected connection has no available models");
          return view;
        };
        const view = connection.selection
          ? await persistProviderFamilyConnection({
              family: connection.family,
              selection: connection.selection,
              read: () => base.settingService.get(),
              update,
              synchronize: readModels,
            })
          : await target.modelSelectionService.getView();
        if (!stillCurrent()) return;
        const group = buildRegistryModelSelectGroups(agentProvider, view).find(
          (g) => g.key === `registry-provider:${connection.providerId}`,
        );
        const model = chooseConnectionModel(
          group?.items ?? [],
          decodeCustomModelValue(normalizedValue)?.modelName,
        );
        if (!model) throw new Error("Selected connection has no available models");
        logger.debug("[composer-connection] 连接同步完成", {
          providerId: connection.providerId,
          connectionKey: connection.key,
          workspaceKey,
        });
        const source = decodeCustomModelValue(normalizedValue);
        const family = resolveModelProviderFamilySpecByProviderId(source?.providerId ?? "");
        const sameAccountModel =
          connection.selection &&
          family?.id === connection.family &&
          (source?.providerId === family.individualCodingPlanProviderId ||
            source?.providerId === family.teamCodingPlanProviderId) &&
          source?.modelName === model.name;
        if (!sameAccountModel) {
          const selection = completeNewModelSelection(view, {
            providerId: connection.providerId,
            modelId: model.name,
          });
          const reasoningLevel = selection?.options?.reasoningLevel;
          if (reasoningLevel) onSelectModel(model.value, reasoningLevel);
          else onSelectModel(model.value);
        }
        if (waitForPresentation) {
          await refreshPresentation?.();
          if (!stillCurrent()) return;
          awaitingPresentation = true;
          setState({
            pending: true,
            error: null,
            previousKey,
            expectedValue: model.value,
            expectedRevision: view.revision,
          });
        }
      } catch (error) {
        logger.lifecycle.warn("[composer-connection] 切换连接失败", {
          providerId: connection.providerId,
          workspaceKey,
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
          causes:
            error instanceof AggregateError
              ? error.errors.map((cause) => String(cause))
              : undefined,
        });
        if (stillCurrent())
          setState({
            pending: false,
            error: intl.formatMessage({ id: "chat.toolbar.connection.switchFailed" }),
          });
      } finally {
        if (stillCurrent() && !awaitingPresentation) {
          inFlight.current = false;
          setState((previous) => ({ ...previous, pending: false }));
        }
      }
    },
    [
      agentProvider,
      base,
      intl,
      normalizedValue,
      onSelectModel,
      rpcReady,
      target,
      update,
      workspaceKey,
      waitForPresentation,
      refreshPresentation,
    ],
  );
  return { ...state, select };
}
