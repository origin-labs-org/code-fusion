// ============================================================
// ============================================================
// docs/dynamic-workflow/presentation.md「The settings popover」「The confirmation window」。
//

import { useCallback, useMemo } from "react";
import { completeNewModelSelection } from "@origin-ai/cf-provider";
import { CF_AGENT_PROVIDER, type CfConfigOption } from "@origin-ai/cf-shared";
import { useModelSelectionView } from "@/hooks/useModelSelectionView.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { buildRegistryModelSelectGroups } from "@/lib/modelSelectionGroups.js";
import { resolveModelThoughtOption } from "@/lib/modelThoughtOption.js";
import { encodeCustomModelValue } from "@/lib/cfCustomModelValue.js";
import { parseModelPickerValue } from "@/lib/cfSessionProjection.js";
import type { ModelSelectGroup, ModelSelectGroupItem } from "@/ModelConfigSelect.js";
import { formatProviderModelLabel } from "@/v4/composer/modelTriggerDisplay.js";
import { describeWorkflowSubagentModel } from "./subagent-model-label.js";
import {
  workflowRunSettingsModelCanonical,
  type WorkflowRunSettingsModel,
} from "./workflowRunSettings.js";

const SESSION_MODEL_VALUE = "workflow-settings:session-model";

export interface WorkflowSettingsModelScope {
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  
  sessionModel?: { providerId: string; modelId: string };
}

export interface WorkflowSettingsModelFace {
  
  value: string;
  
  triggerLabel: string;
  
  unavailable: boolean;
  
  thoughtOption: CfConfigOption | null;
}

export function useWorkflowSettingsModelChoices(scope: WorkflowSettingsModelScope) {
  const { intl } = useCfIntl();
  const format = useCallback(
    (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values),
    [intl],
  );
  const modelRead = useModelSelectionView(
    scope.workspacePath,
    scope.remoteSessionId,
    scope.workspaceIdentity,
  );
  const view = modelRead.state.status === "ready" ? modelRead.state.view : null;
  const groups: ModelSelectGroup[] = useMemo(
    () =>
      view === null
        ? []
        : buildRegistryModelSelectGroups(CF_AGENT_PROVIDER, view, {
            apiKeyLabel: format("settings.modelProvider.apiKey"),
            apiKeyBadgeLabel: format("settings.modelProvider.connectionMode.apiKeyBadge"),
            codingPlanLabel: format("settings.modelProvider.connectionMode.codingPlan"),
            codingPlanBadgeLabel: format("settings.modelProvider.connectionMode.codingPlanBadge"),
            startPlanLabel: format("settings.modelProvider.connectionMode.startPlan"),
            startPlanBadgeLabel: format("settings.modelProvider.connectionMode.startPlanBadge"),
            teamPlanBadgeLabel: format("settings.modelProvider.connectionMode.teamPlanBadge"),
            teamPlanFallbackLabel: format("settings.modelProvider.connectionMode.teamPlan"),
          }),
    [format, view],
  );
  const providerName = useCallback(
    (providerId: string) =>
      view?.providers.find((provider) => provider.providerId === providerId)?.providerName ??
      undefined,
    [view],
  );

  const sessionModel = scope.sessionModel;
  const sessionModelName =
    sessionModel === undefined
      ? format("chat.toolCall.workflow.run.settings.model.sessionFallback")
      : formatProviderModelLabel(
          sessionModel.providerId,
          providerName(sessionModel.providerId),
          sessionModel.modelId,
        );
  const sessionBadge = format("chat.toolCall.workflow.run.settings.model.session");
  const sessionModelItem: ModelSelectGroupItem = useMemo(
    () => ({
      key: "workflow-settings:session-model",
      value: SESSION_MODEL_VALUE,
      name: sessionModelName,
      badgeLabel: sessionBadge,
    }),
    [sessionModelName, sessionBadge],
  );

  const describe = useCallback(
    (model: WorkflowRunSettingsModel): WorkflowSettingsModelFace => {
      const value =
        model.kind === "session"
          ? SESSION_MODEL_VALUE
          : encodeCustomModelValue(model.providerId, model.modelId);
      const listed = groups.some((group) => group.items.some((item) => item.value === value));
      const unavailable = model.kind === "model" && view !== null && groups.length > 0 && !listed;
      const canonical = workflowRunSettingsModelCanonical(model);
      const triggerLabel =
        model.kind === "session" || canonical === undefined
          ? sessionModelName
          : describeWorkflowSubagentModel(canonical, {
              formatMessage: intl.formatMessage.bind(intl),
              providerName,
            }).name;
      const thoughtOption =
        model.kind === "model" && view !== null && !unavailable
          ? resolveModelThoughtOption({
              modelSelectionView: view,
              providerId: model.providerId,
              modelId: model.modelId,
              ...(model.level === undefined ? {} : { currentValue: model.level }),
            })
          : null;
      return { value, triggerLabel, unavailable, thoughtOption };
    },
    [groups, intl, providerName, sessionModelName, view],
  );

  
  const pick = useCallback(
    (value: string, current: WorkflowRunSettingsModel): WorkflowRunSettingsModel => {
      if (value === SESSION_MODEL_VALUE) return { kind: "session" };
      const picked = parseModelPickerValue(value);
      const same =
        current.kind === "model" &&
        current.providerId === picked.providerId &&
        current.modelId === picked.modelId;
      const level = same
        ? current.level
        : view === null
          ? undefined
          : completeNewModelSelection(view, picked)?.options?.reasoningLevel;
      return {
        kind: "model",
        providerId: picked.providerId,
        modelId: picked.modelId,
        ...(level === undefined ? {} : { level }),
      };
    },
    [view],
  );

  return {
    
    loading: view === null,
    
    noCatalog: view !== null && groups.length === 0,
    groups,
    providerName,
    sessionBadge,
    sessionModelItem,
    sessionModelName,
    describe,
    pick,
  };
}
