

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlarmClockIcon } from "lucide-react";
import { cn } from "@/components/lib/utils.js";
import {
  BUILTIN_MODEL_PROVIDER_IDS,
  getModelProviderFamilySpec,
  resolveModelProviderFamilySpecByProviderId,
  CF_AGENT_PROVIDER,
  type ProviderFamilyConnectionSelection,
  type ProviderFamilyConnectionSelectionSettings,
  type ProviderFamilyDomain,
  type UsageEntitlementSnapshot,
  type CfAccountAccess,
  type CfProviderAccountAccess,
  type CfConfigOption,
  type CfProvider,
} from "@origin-ai/cf-shared";
import { TID_V4_MODEL_CONFIG, TID_V4_COMPOSER_INPUT } from "@origin-ai/cf-shared/test-ids";
import type {
  SessionConfigState,
  SessionPhase,
  SessionUsageState,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import { ModelConfigSelect, type ModelSelectGroup } from "@/ModelConfigSelect.js";
import type { ComposerModelOptions } from "@/chat-input-toolbar/ComposerModelMenu.js";
import { Button } from "@/components/ui/button.js";
import { HighspeedModelIndicator } from "@/highspeed/HighspeedModelIndicator.js";
import { formatHighspeedRemainingTime } from "@/highspeed/highspeedTime.js";
import { ChatContextUsage } from "@/chat-input-toolbar/display.js";
import {
  hasChatCodingPlanUsageRemaining,
  type ChatCodingPlanUsageRemainingConfig,
} from "@/chat-input-toolbar/CodingPlanContextUsage.js";
import {
  hasChatStartPlanBalance,
  type ChatStartPlanBalanceConfig,
} from "@/chat-input-toolbar/StartPlanContextBalance.js";
import { ThoughtLevelCycleControl } from "@/chat-input-toolbar/ThoughtLevelCycleControl.js";
import {
  getNextThoughtLevelValue,
  getThoughtLevelLabel,
} from "@/chat-input-toolbar/thoughtLevelOptions.js";
import type { V4ComposerConfigPicker } from "@/v4/composer/configPickerState.js";
import { useToolbarShortcutBindings } from "@/v4/composer/toolbarShortcuts.js";
import {
  resolveModelSelectTriggerDisplay,
  shouldShowManageModelsAction,
} from "@/chat-input-toolbar/modelSelection.js";
import { resolveV4ModelTriggerDisplay } from "@/v4/composer/modelTriggerDisplay.js";
import {
  setPendingSettingsSectionIntent,
  setPendingSettingsUsageCodingPlanIntent,
} from "@/lib/settingsNavigation.js";
import { useTabStore } from "@/store/TabStoreProvider.js";
import type { ModelSelectionView } from "@origin-ai/cf-services";
import type {
  ModelSelectionState,
  ModelSelectionRefreshResult,
} from "@/hooks/useModelSelectionView.js";
import { useProviderSettingsView } from "@/hooks/useProviderSettingsView.js";
import { useBaseWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { useComposerConnectionSwitch } from "@/hooks/useComposerConnectionSwitch.js";
import {
  buildComposerPlanGroups,
  composerConnectionKey,
  chooseConnectionModel,
} from "@/lib/composerPlanGroups.js";
import { useCfStoreWithDefault } from "@/store/StoreProvider.js";
import { useSettings } from "@/hooks/useSettingService.js";
import {
  useUsageEntitlement,
  type UsageEntitlementRefreshOptions,
} from "@/hooks/useUsageEntitlement.js";
import { useToolbarConfigOptions } from "@/hooks/useCfConfig.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import {
  createCodingPlanFunnelContext,
  resolveCodingPlanEntryPlanState,
} from "@/lib/codingPlanFunnelTelemetry.js";
import { useShortcutCommandLabel } from "@/shortcuts/useShortcutBindings.js";
import { logger } from "@/logger.js";
import { useCodingPlanUpgradeDialog } from "@/settings/CodingPlanUpgradeDialogProvider.js";
import { useCodingPlanEntitlements } from "@/settings/model-provider-section/useCodingPlanEntitlements.js";
import { decodeCustomModelValue, encodeCustomModelValue } from "@/lib/cfCustomModelValue.js";
import { buildRegistryModelSelectGroups } from "@/lib/modelSelectionGroups.js";
import {
  buildCodingPlanUsageSources,
  type CodingPlanUsageSource,
} from "@/lib/codingPlanUsageSources.js";
import {
  type SidebarUsageCodingPlanProviderId,
  type SidebarUsageCodingPlanSourceId,
  writeSidebarUsageCodingPlanProviderPreference,
} from "@/lib/sidebarUsageCodingPlanProviderPreference.js";
import { resolveEntitledAccountProviderAccess } from "@/lib/accountProviderAccess.js";
import { useEnterpriseCodingPlanProducts } from "@/settings/model-provider-section/useEnterpriseCodingPlanProducts.js";
import {
  resolveDraftDisplayedConfig,
  resolveDraftModelThoughtOption,
  resolveDraftThoughtCurrentValue,
} from "@/v4/composer/draftWorkspaceDefaults.js";

export { V4ComposerModeSwitch } from "@/v4/composer/V4ComposerModeControls.js";

const V4_COMPOSER_INPUT_SELECTOR = `[data-testid="${TID_V4_COMPOSER_INPUT}"]`;
const MODEL_SELECTION_LOADING_STATE: ModelSelectionState = { status: "loading" };

function noop(): void {}

function HighspeedCountdown({ expiresAt }: { expiresAt: number }) {
  const { intl, locale } = useCfIntl();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const remainingTime = formatHighspeedRemainingTime(expiresAt, now);
  const absoluteExpiryLabel = intl.formatMessage(
    { id: "chat.highspeed.expiresAt" },
    {
      time: new Date(expiresAt).toLocaleTimeString(locale, {
        hour: "2-digit",
        minute: "2-digit",
      }),
    },
  );
  const remainingTimeLabel = intl.formatMessage(
    { id: "chat.highspeed.remainingTime" },
    { time: remainingTime },
  );

  return (
    <span
      aria-label={absoluteExpiryLabel}
      title={remainingTimeLabel}
      data-highspeed-countdown="true"
      className="highspeed-inline-countdown inline-flex h-7 w-[82px] shrink-0 items-center justify-center gap-1 rounded-md p-1 text-ui-caption @max-xl/composer:w-7 @max-xl/composer:gap-0 @max-xl/composer:p-0"
    >
      <AlarmClockIcon className="size-4 shrink-0" aria-hidden="true" />
      <span
        data-highspeed-countdown-value="true"
        className="relative h-[18px] w-[54px] shrink-0 leading-4 tabular-nums @max-xl/composer:hidden"
      >
        <span className="absolute left-0 top-0.5">{remainingTime}</span>
      </span>
    </span>
  );
}

export interface ModelSelectionSource {
  provider: string;
  model: string;
}

type V4ContextPlanConnection =
  | { kind: "none" }
  | {
      family: ProviderFamilyDomain;
      kind: "personalCoding";
      providerId:
        | typeof BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan
        | typeof BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan;
    }
  | {
      family: ProviderFamilyDomain;
      kind: "teamCoding";
      providerId:
        | typeof BUILTIN_MODEL_PROVIDER_IDS.zaiTeamCodingPlan
        | typeof BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan;
      selection: Extract<ProviderFamilyConnectionSelection, { kind: "team-coding-plan" }>;
    }
  | {
      family: ProviderFamilyDomain;
      kind: "start";
      providerId:
        | typeof BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan
        | typeof BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan;
    };

function resolveFamilyForPlanProviderId(providerId: string | null | undefined): {
  family: ProviderFamilyDomain;
  kind: "personalCoding" | "teamCoding" | "start";
} | null {
  switch (providerId?.trim()) {
    case BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan:
      return { family: "zai", kind: "personalCoding" };
    case BUILTIN_MODEL_PROVIDER_IDS.zaiTeamCodingPlan:
      return { family: "zai", kind: "teamCoding" };
    case BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan:
      return { family: "zai", kind: "start" };
    case BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan:
      return { family: "bigmodel", kind: "personalCoding" };
    case BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan:
      return { family: "bigmodel", kind: "teamCoding" };
    case BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan:
      return { family: "bigmodel", kind: "start" };
    default:
      return null;
  }
}

function resolveV4ContextPlanConnection(params: {
  connectionSelections?: ProviderFamilyConnectionSelectionSettings | null;
  providerId?: string | null;
}): V4ContextPlanConnection {
  const providerFamily = resolveFamilyForPlanProviderId(params.providerId);
  if (!providerFamily) {
    return { kind: "none" };
  }

  if (providerFamily.kind === "start") {
    const providerId = params.providerId?.trim();
    if (
      providerId !== BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan &&
      providerId !== BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan
    ) {
      return { kind: "none" };
    }
    return {
      family: providerFamily.family,
      kind: "start",
      providerId,
    };
  }

  const selection = params.connectionSelections?.[providerFamily.family];
  if (!selection) return { kind: "none" };

  const providerId = params.providerId?.trim();
  if (providerFamily.kind === "teamCoding" && selection.kind === "team-coding-plan") {
    return {
      family: providerFamily.family,
      kind: "teamCoding",
      providerId: providerId as
        | typeof BUILTIN_MODEL_PROVIDER_IDS.zaiTeamCodingPlan
        | typeof BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan,
      selection,
    };
  }
  if (providerFamily.kind !== "personalCoding" || selection.kind !== "individual-coding-plan") {
    return { kind: "none" };
  }

  return {
    family: providerFamily.family,
    kind: "personalCoding",
    providerId: providerId as
      | typeof BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan
      | typeof BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
  };
}

function resolveContextTeamUsageSourceFromEntitlementSnapshot({
  accountAccess,
  snapshot,
}: {
  accountAccess?: CfProviderAccountAccess | CfAccountAccess | null;
  snapshot?: UsageEntitlementSnapshot | null;
}): CodingPlanUsageSource | null {
  if (snapshot?.context?.scope !== "team") {
    return null;
  }
  const organizationId = snapshot.context.organizationId?.trim() ?? "";
  const projectId = snapshot.context.projectId?.trim() ?? "";
  if (!organizationId || !projectId) {
    return null;
  }
  const subscription = snapshot.subscription?.details[0] ?? null;
  const productId =
    snapshot.context.productId?.trim() || subscription?.productId?.trim() || "current";
  const familySpec = resolveModelProviderFamilySpecByProviderId(snapshot.provider?.id ?? "");
  const family: ProviderFamilyDomain = familySpec?.id ?? "bigmodel";
  if (!accountAccess) {
    return null;
  }
  if ("mode" in accountAccess && accountAccess.mode !== "team-coding-plan") {
    return null;
  }
  if (
    "planKind" in accountAccess &&
    (accountAccess.planKind !== "team-coding-plan" ||
      accountAccess.productId !== productId ||
      accountAccess.organizationId !== organizationId ||
      accountAccess.projectId !== projectId)
  ) {
    return null;
  }
  const codingPlanProviderId = getModelProviderFamilySpec(family).teamCodingPlanProviderId;
  const sourceId = ["team", family, productId, organizationId, projectId]
    .map(encodeURIComponent)
    .join(":") as SidebarUsageCodingPlanSourceId;
  const displayName =
    snapshot.context.displayName?.trim() || subscription?.productName?.trim() || "Team";

  return {
    id: sourceId,
    providerId: codingPlanProviderId,
    accountAccess: {
      type: "zhipu-account",
      family,
      planKind: "team-coding-plan",
      productId,
      organizationId,
      projectId,
    },
    label: `${familySpec?.id === "zai" ? "ZAI" : "BigModel"} - ${displayName}`,
  };
}

function resolveContextCodingPlanUsageSource(params: {
  accountAccess?: CfProviderAccountAccess | CfAccountAccess | null;
  cachedTeamSources?: readonly CodingPlanUsageSource[];
  entitlementSnapshot?: UsageEntitlementSnapshot | null;
  providerId?:
    | typeof BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan
    | typeof BUILTIN_MODEL_PROVIDER_IDS.zaiTeamCodingPlan;
  teamSelection?: Extract<ProviderFamilyConnectionSelection, { kind: "team-coding-plan" }>;
  subscribedTeamProducts: Parameters<
    typeof buildCodingPlanUsageSources
  >[0]["subscribedTeamProducts"];
}): CodingPlanUsageSource | null {
  if (!params.teamSelection) return null;
  if (!params.accountAccess) return null;

  return (
    buildCodingPlanUsageSources({
      accountAccesses: {
        [resolveModelProviderFamilySpecByProviderId(params.providerId ?? "")?.id ?? "bigmodel"]:
          params.accountAccess,
      },
      subscribedTeamProducts: params.subscribedTeamProducts,
    }).find(
      (source) =>
        "planKind" in source.accountAccess &&
        source.accountAccess.planKind === "team-coding-plan" &&
        source.accountAccess.productId === params.teamSelection?.productId &&
        source.accountAccess.organizationId === params.teamSelection?.organizationId &&
        source.accountAccess.projectId === params.teamSelection?.projectId,
    ) ??
    params.cachedTeamSources?.find(
      (source) =>
        "planKind" in source.accountAccess &&
        source.accountAccess.planKind === "team-coding-plan" &&
        source.accountAccess.productId === params.teamSelection?.productId &&
        source.accountAccess.organizationId === params.teamSelection?.organizationId &&
        source.accountAccess.projectId === params.teamSelection?.projectId,
    ) ??
    resolveContextTeamUsageSourceFromEntitlementSnapshot({
      accountAccess: params.accountAccess,
      snapshot: params.entitlementSnapshot,
    })
  );
}

export interface V4ComposerToolbarProps {
  workspacePath: string;
  workspaceIdentity?: string;
  modelSelectionView?: ModelSelectionView | null;
  modelSelectionState?: ModelSelectionState;
  modelSelectionReload?: () => void;
  modelSelectionRefresh?: () => Promise<ModelSelectionRefreshResult>;
  sessionId: string | null;
  phase: SessionPhase | null;
  provider?: CfProvider;
  
  isWebRemoteControl?: boolean;
  
  isMobileViewport?: boolean;
  
  draftMode?: boolean;
  
  draftConfig?: Partial<SessionConfigState>;
  usage: SessionUsageState | null;
  disabled: boolean;
  
  modelLocked?: boolean;
  
  highspeedPresented?: boolean;
  
  highspeedEntranceAnimated?: boolean;
  
  highspeedSweepActive?: boolean;
  
  highspeedExpiresAt?: number;
  
  highspeedModel?: string;
  
  activeConfigPicker: V4ComposerConfigPicker | null;
  onConfigPickerOpenChange: (picker: V4ComposerConfigPicker, open: boolean) => void;
  
  onSelectModel: (
    provider: string,
    model: string,
    sourceModel: ModelSelectionSource | null,
    reasoningLevel?: string,
  ) => void;
  
  onSelectThought: (thought: string, modelContext: { provider: string; model: string }) => void;
  onSwitchMode: (mode: string) => void;
  
  onRecoverCustomModelSelection?: (
    value: string,
    sourceModel: ModelSelectionSource | null,
  ) => Promise<void> | void;
  onSendCompressionCommand?: (command: string) => void;
}

function V4ComposerModelControlsImpl({
  workspacePath,
  workspaceIdentity,
  modelSelectionView = null,
  modelSelectionState = MODEL_SELECTION_LOADING_STATE,
  modelSelectionReload,
  modelSelectionRefresh,
  provider,
  isWebRemoteControl = false,
  isMobileViewport = false,
  draftMode = false,
  draftConfig,
  usage,
  disabled,
  modelLocked = false,
  highspeedPresented = false,
  highspeedEntranceAnimated = false,
  highspeedSweepActive = false,
  highspeedExpiresAt,
  highspeedModel,
  activeConfigPicker,
  onConfigPickerOpenChange,
  onSelectModel,
  onSelectThought,
  onSendCompressionCommand,
  onRecoverCustomModelSelection,
}: V4ComposerToolbarProps) {
  const { intl, locale } = useCfIntl();
  const { openCodingPlanUpgrade } = useCodingPlanUpgradeDialog();
  const displayProvider = provider ?? CF_AGENT_PROVIDER;
  const { error: configOptionsError } = useToolbarConfigOptions(
    workspacePath,
    null,
    workspaceIdentity,
  );
  const providerSettingsRead = useProviderSettingsView();
  const providerSettingsView =
    providerSettingsRead.state.status === "ready" ? providerSettingsRead.state.view : null;
  const providerSourcesLoading = providerSettingsRead.state.status !== "ready";
  const baseServices = useBaseWorkspaceServices();
  const { settings: sharedSettings } = useSettings({ services: baseServices });
  const {
    entitlements,
    enabledStartPlanProviderIds,
    refresh: refreshCodingPlanEntitlements,
  } = useCodingPlanEntitlements({
    providerSettingsView,
    connectionSelections: sharedSettings?.providerFamilyConnectionSelections,
    suppressProviderFingerprintAutoRefresh: true,
  });
  const openSettingsTab = useTabStore((state) => state.openSettingsTab);
  const modelTriggerRef = useRef<HTMLSpanElement | null>(null);
  const thoughtTriggerRef = useRef<HTMLSpanElement | null>(null);
  const [modelMenuOpenRequestKey, setModelMenuOpenRequestKey] = useState(0);
  const [recoveryPending, setRecoveryPending] = useState(false);
  const handleOpenModelMenuShortcut = useCallback(() => {
    setModelMenuOpenRequestKey((current) => current + 1);
  }, []);
  const handleModelPickerOpenChange = useCallback(
    (open: boolean) => {
      onConfigPickerOpenChange("model", open);
    },
    [onConfigPickerOpenChange],
  );
  const handleThoughtPickerOpenChange = useCallback(
    (open: boolean) => {
      onConfigPickerOpenChange("thought", open);
    },
    [onConfigPickerOpenChange],
  );

  const modelOption = modelSelectionView?.providers.some((provider) => provider.models.length > 0)
    ? ({
        id: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: "",
        options: [],
      } satisfies CfConfigOption)
    : undefined;

  const effectiveConfig = useMemo<SessionConfigState | null>(() => {
    return resolveDraftDisplayedConfig(draftConfig ?? {});
  }, [draftConfig]);

  const handleOpenStartPlanUpgrade = useCallback(
    (providerId: string) => {
      openCodingPlanUpgrade({
        providerId,
        funnelContext: createCodingPlanFunnelContext({
          providerId,
          upgradeSource: "session_token_usage",
          eventRegion: "app.session",
          eventText: intl.formatMessage({ id: "chat.quota.action.upgrade" }),
          entryPlanState: resolveCodingPlanEntryPlanState({
            providerId,
            displayStatus: "purchased",
            planLevel: "start",
          }),
        }),
      });
    },
    [intl, openCodingPlanUpgrade],
  );
  const handleOpenUsageDetails = useCallback(
    (sourceId?: SidebarUsageCodingPlanSourceId) => {
      if (sourceId) {
        writeSidebarUsageCodingPlanProviderPreference(sourceId);
      }
      setPendingSettingsUsageCodingPlanIntent();
      openSettingsTab();
    },
    [openSettingsTab],
  );

  const contextPlanConnection = useMemo(
    () =>
      resolveV4ContextPlanConnection({
        connectionSelections: sharedSettings?.providerFamilyConnectionSelections,
        providerId: effectiveConfig?.provider,
      }),
    [effectiveConfig?.provider, sharedSettings?.providerFamilyConnectionSelections],
  );
  const contextAccountProviderAccess = useMemo(
    () =>
      contextPlanConnection.kind === "personalCoding" || contextPlanConnection.kind === "teamCoding"
        ? resolveEntitledAccountProviderAccess(
            providerSettingsView,
            contextPlanConnection.providerId,
          )
        : null,
    [contextPlanConnection, providerSettingsView],
  );
  const contextStartPlanBalanceConfig = useMemo<ChatStartPlanBalanceConfig | undefined>(() => {
    if (contextPlanConnection.kind !== "start") {
      return undefined;
    }
    const entitlement = entitlements[contextPlanConnection.providerId];
    const startPlanEntitlementEnabled = enabledStartPlanProviderIds.includes(
      contextPlanConnection.providerId,
    );
    return {
      loading: entitlement?.loading ?? providerSourcesLoading,
      ...(startPlanEntitlementEnabled
        ? {
            onAccess: () => refreshCodingPlanEntitlements({ silent: true, reason: "access" }),
          }
        : {}),
      onUpgradeClick: () => handleOpenStartPlanUpgrade(contextPlanConnection.providerId),
      snapshot:
        entitlement?.snapshot?.provider?.id === contextPlanConnection.providerId
          ? entitlement.snapshot
          : null,
    };
  }, [
    contextPlanConnection,
    enabledStartPlanProviderIds,
    entitlements,
    handleOpenStartPlanUpgrade,
    providerSourcesLoading,
    refreshCodingPlanEntitlements,
  ]);
  const contextStartPlanBalance = hasChatStartPlanBalance(contextStartPlanBalanceConfig)
    ? contextStartPlanBalanceConfig
    : undefined;

  const connectionFamily =
    resolveModelProviderFamilySpecByProviderId(effectiveConfig?.provider ?? "")?.id ??
    sharedSettings?.providerFamilyDomain ??
    "bigmodel";
  const user = useCfStoreWithDefault((state) => state.user, undefined);
  const connectionAuthenticated =
    user !== null &&
    Boolean(
      providerSettingsView?.providers.some(
        (p) =>
          p.effectiveConfig.access?.type === "zhipu-account" &&
          p.effectiveConfig.access.accountType === connectionFamily &&
          p.enabled &&
          p.accountState?.unavailableReason !== "not-authenticated" &&
          (p.effectiveConfig.access.mode === "team-coding-plan" ||
            p.accountState?.availability === "available"),
      ),
    );
  const enterpriseProducts = useEnterpriseCodingPlanProducts({
    enabled:
      !providerSourcesLoading &&
      (contextPlanConnection.kind === "teamCoding" || activeConfigPicker === "model") &&
      connectionAuthenticated,
    authenticated: connectionAuthenticated,
    family: connectionFamily,
  });
  const subscribedTeamProducts = useMemo(
    () =>
      (connectionAuthenticated
        ? enterpriseProducts.snapshot?.productList.filter((product) => product.subscribed === true)
        : undefined) ?? [],
    [connectionAuthenticated, enterpriseProducts.snapshot?.productList],
  );
  const authSessionSeq = useCfStoreWithDefault((state) => state.authSessionSeq, 0);
  const teamUsageScope = useMemo(
    () => ({}),
    [baseServices, connectionFamily, user?.id, authSessionSeq],
  );
  const contextTeamUsageSourceCacheRef = useRef<{
    scope: object;
    sources: CodingPlanUsageSource[];
  }>({ scope: teamUsageScope, sources: [] });
  if (contextTeamUsageSourceCacheRef.current.scope !== teamUsageScope || !connectionAuthenticated)
    contextTeamUsageSourceCacheRef.current = { scope: teamUsageScope, sources: [] };
  const contextCodingPlanUsageProviderId =
    contextPlanConnection.kind === "personalCoding" || contextPlanConnection.kind === "teamCoding"
      ? contextPlanConnection.providerId
      : undefined;
  const contextCodingPlanUsageTeamSource = useMemo(
    () =>
      connectionAuthenticated && contextPlanConnection.kind === "teamCoding"
        ? resolveContextCodingPlanUsageSource({
            accountAccess: contextAccountProviderAccess?.access,
            cachedTeamSources: contextTeamUsageSourceCacheRef.current.sources,
            entitlementSnapshot: entitlements[contextPlanConnection.providerId]?.snapshot ?? null,
            providerId: contextPlanConnection.providerId,
            teamSelection: contextPlanConnection.selection,
            subscribedTeamProducts,
          })
        : null,
    [
      connectionAuthenticated,
      teamUsageScope,
      contextAccountProviderAccess?.access,
      contextPlanConnection,
      entitlements,
      subscribedTeamProducts,
    ],
  );
  useEffect(() => {
    if (!contextCodingPlanUsageTeamSource) {
      return;
    }
    const cache = contextTeamUsageSourceCacheRef.current.sources;
    const nextCache = cache.filter((source) => source.id !== contextCodingPlanUsageTeamSource.id);
    nextCache.unshift(contextCodingPlanUsageTeamSource);
    contextTeamUsageSourceCacheRef.current = {
      scope: teamUsageScope,
      sources: nextCache.slice(0, 8),
    };
  }, [contextCodingPlanUsageTeamSource, teamUsageScope]);
  const contextCodingPlanUsageSelectedSourceId: SidebarUsageCodingPlanSourceId | undefined =
    contextPlanConnection.kind === "teamCoding"
      ? contextCodingPlanUsageTeamSource?.id
      : contextCodingPlanUsageProviderId;
  const teamEntitlement = useUsageEntitlement({
    enabled: !providerSourcesLoading && Boolean(contextCodingPlanUsageTeamSource),
    includeSubscription: true,
    preferredProviderId:
      contextCodingPlanUsageTeamSource?.providerId ??
      BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
    accountAccess: contextCodingPlanUsageTeamSource?.accountAccess,
    allowDisabledPreferredProvider: true,
    requirePreferredProvider: true,
    allowEnvApiKey: false,
    cacheKey: contextCodingPlanUsageTeamSource?.id,
    refreshOnMount: false,
  });
  const refreshTaskEntitlements = useCallback(
    async (options?: UsageEntitlementRefreshOptions) => {
      await Promise.all([refreshCodingPlanEntitlements(options), teamEntitlement.refresh(options)]);
    },
    [refreshCodingPlanEntitlements, teamEntitlement.refresh],
  );
  const contextCodingPlanUsageProviders = useMemo(() => {
    if (contextPlanConnection.kind !== "personalCoding" || !contextCodingPlanUsageProviderId) {
      return [];
    }
    const access = contextAccountProviderAccess;
    if (!access) return [];
    return [
      {
        providerId: contextCodingPlanUsageProviderId as SidebarUsageCodingPlanProviderId,
        accountAccess: access.access,
        label:
          access.label ||
          (contextCodingPlanUsageProviderId === BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan
            ? "Z.ai - Coding Plan"
            : "BigModel - Coding Plan"),
      },
    ];
  }, [contextAccountProviderAccess, contextCodingPlanUsageProviderId, contextPlanConnection.kind]);
  const codingPlanUsageEntitlements = useMemo<
    ChatCodingPlanUsageRemainingConfig["entitlements"]
  >(() => {
    if (contextCodingPlanUsageTeamSource) {
      return [
        {
          sourceId: contextCodingPlanUsageTeamSource.id,
          providerId: contextCodingPlanUsageTeamSource.providerId,
          accountAccess: contextCodingPlanUsageTeamSource.accountAccess,
          label: contextCodingPlanUsageTeamSource.label,
          snapshot: teamEntitlement.snapshot,
          loading: teamEntitlement.loading,
          error: teamEntitlement.error,
        },
      ];
    }

    if (
      contextPlanConnection.kind !== "personalCoding" ||
      !contextCodingPlanUsageProviderId ||
      contextCodingPlanUsageProviders.length === 0
    ) {
      return [];
    }
    const providerId = contextCodingPlanUsageProviderId;
    const entitlement = entitlements[providerId];
    return [
      {
        sourceId: providerId,
        providerId,
        accountAccess: contextCodingPlanUsageProviders[0]!.accountAccess,
        snapshot: entitlement?.snapshot ?? null,
        loading: entitlement?.loading ?? providerSourcesLoading,
        error: entitlement?.error ?? null,
      },
    ];
  }, [
    contextCodingPlanUsageProviderId,
    contextCodingPlanUsageProviders.length,
    contextCodingPlanUsageTeamSource,
    contextPlanConnection.kind,
    entitlements,
    providerSourcesLoading,
    teamEntitlement.error,
    teamEntitlement.loading,
    teamEntitlement.snapshot,
  ]);
  const handleUsageClick = useCallback(
    () => handleOpenUsageDetails(contextCodingPlanUsageSelectedSourceId),
    [contextCodingPlanUsageSelectedSourceId, handleOpenUsageDetails],
  );
  const codingPlanUsageRemainingConfig = useMemo<
    ChatCodingPlanUsageRemainingConfig | undefined
  >(() => {
    if (contextPlanConnection.kind !== "personalCoding" && !contextCodingPlanUsageTeamSource) {
      return undefined;
    }
    return {
      availableProviders: contextCodingPlanUsageProviders,
      entitlements: codingPlanUsageEntitlements,
      modelProvidersLoading: providerSourcesLoading,
      onEntitlementRefresh: () => refreshTaskEntitlements({ force: true, silent: true }),
      onAccess: () => refreshTaskEntitlements({ silent: true, reason: "access" }),
      onUsageClick: handleUsageClick,
      selectedProviderId: contextCodingPlanUsageSelectedSourceId,
    };
  }, [
    contextCodingPlanUsageProviders,
    contextCodingPlanUsageSelectedSourceId,
    contextCodingPlanUsageTeamSource,
    contextPlanConnection.kind,
    codingPlanUsageEntitlements,
    handleUsageClick,
    providerSourcesLoading,
    refreshTaskEntitlements,
  ]);
  const codingPlanUsageRemaining =
    codingPlanUsageRemainingConfig &&
    hasChatCodingPlanUsageRemaining(codingPlanUsageRemainingConfig)
      ? codingPlanUsageRemainingConfig
      : undefined;

  useEffect(() => {
    if (!draftMode) return;
    logger.debug("[v4-toolbar] draft effectiveConfig changed", {
      provider: effectiveConfig?.provider ?? null,
      model: effectiveConfig?.model ?? null,
      thought: effectiveConfig?.thought ?? null,
      modelSelectionRevision: modelSelectionView?.revision ?? null,
    });
  }, [draftMode, effectiveConfig, modelSelectionView?.revision]);

  const modelGroupLabels = useMemo(
    () => ({
      apiKeyLabel: intl.formatMessage({ id: "settings.modelProvider.apiKey" }),
      apiKeyBadgeLabel: intl.formatMessage({
        id: "settings.modelProvider.connectionMode.apiKeyBadge",
      }),
      codingPlanLabel: intl.formatMessage({
        id: "settings.modelProvider.connectionMode.codingPlan",
      }),
      codingPlanBadgeLabel: intl.formatMessage({
        id: "settings.modelProvider.connectionMode.codingPlanBadge",
      }),
      startPlanLabel: intl.formatMessage({
        id: "settings.modelProvider.connectionMode.startPlan",
      }),
      startPlanBadgeLabel: intl.formatMessage({
        id: "settings.modelProvider.connectionMode.startPlanBadge",
      }),
      teamPlanBadgeLabel: intl.formatMessage({
        id: "settings.modelProvider.connectionMode.teamPlanBadge",
      }),
      teamPlanFallbackLabel: intl.formatMessage({
        id: "settings.modelProvider.connectionMode.teamPlan",
      }),
    }),
    [intl],
  );
  const modelSelectGroups = useMemo<ModelSelectGroup[]>(() => {
    if (!modelSelectionView) return [];
    return buildRegistryModelSelectGroups(displayProvider, modelSelectionView, modelGroupLabels);
  }, [displayProvider, modelGroupLabels, modelSelectionView]);

  const handleOpenModelProviderSettings = useCallback(() => {
    setPendingSettingsSectionIntent("modelProvider");
    openSettingsTab();
  }, [openSettingsTab]);
  const showManageModelsAction = shouldShowManageModelsAction(handleOpenModelProviderSettings);
  const manageModelsLabel = intl.formatMessage({
    id: "chat.toolbar.model.manageModels",
  });

  const rawModelValue = useMemo(() => {
    if (!effectiveConfig || !effectiveConfig.model) return "";
    const providerExists = modelSelectionView?.providers.some(
      (candidate) => candidate.providerId === effectiveConfig.provider,
    );
    if (providerExists) {
      return encodeCustomModelValue(effectiveConfig.provider, effectiveConfig.model);
    }
    return effectiveConfig.model;
  }, [effectiveConfig, modelSelectionView]);

  const triggerDisplay = useMemo(
    () =>
      resolveModelSelectTriggerDisplay(
        rawModelValue,
        modelSelectGroups,
        showManageModelsAction,
        manageModelsLabel,
      ),
    [manageModelsLabel, modelSelectGroups, rawModelValue, showManageModelsAction],
  );
  const normalizedModelValue = triggerDisplay.value ?? "";

  const modelTriggerDisplay = useMemo(() => {
    const fallbackLabel =
      triggerDisplay.placeholder ?? intl.formatMessage({ id: "chat.toolbar.model.label" });
    const providerName =
      modelSelectionView?.providers.find(
        (candidate) => candidate.providerId === effectiveConfig?.provider,
      )?.providerName ?? undefined;
    return resolveV4ModelTriggerDisplay({
      modelGroups: modelSelectGroups,
      normalizedValue: normalizedModelValue,
      fallbackLabel,
      providerId: effectiveConfig?.provider,
      providerName,
    });
  }, [
    effectiveConfig?.provider,
    intl,
    modelSelectionView,
    modelSelectGroups,
    normalizedModelValue,
    triggerDisplay.placeholder,
  ]);
  const handleModelValueChange = useCallback(
    (value: string, reasoningLevel?: string) => {
      if (modelLocked) return;
      const decoded = decodeCustomModelValue(value);
      const sourceModel =
        effectiveConfig?.provider && effectiveConfig.model
          ? {
              provider: effectiveConfig.provider,
              model: effectiveConfig.model,
            }
          : null;
      logger.debug("[v4-toolbar] model select onValueChange", {
        value,
        decodedProviderId: decoded?.providerId ?? null,
        decodedModelName: decoded?.modelName ?? null,
        draftMode,
      });
      const selectedRegistryProvider = decoded?.providerId
        ? modelSelectionView?.providers.find(
            (candidate) => candidate.providerId === decoded.providerId,
          )
        : undefined;
      const customRecoveryEligible = isApiKeyAccess(selectedRegistryProvider?.config.access);
      if (
        configOptionsError &&
        decoded?.providerId &&
        customRecoveryEligible &&
        onRecoverCustomModelSelection
      ) {
        setRecoveryPending(true);
        void Promise.resolve(onRecoverCustomModelSelection(value, sourceModel))
          .catch((error) => {
            logger.warn("[v4-toolbar] custom provider recovery failed", {
              error: error instanceof Error ? error.message : String(error),
              providerId: decoded.providerId,
            });
          })
          .finally(() => {
            setRecoveryPending(false);
          });
        return;
      }
      if (decoded) {
        if (reasoningLevel !== undefined)
          onSelectModel(decoded.providerId, decoded.modelName ?? "", sourceModel, reasoningLevel);
        else onSelectModel(decoded.providerId, decoded.modelName ?? "", sourceModel);
        return;
      }
      const slashIndex = value.indexOf("/");
      if (slashIndex > 0) {
        onSelectModel(value.slice(0, slashIndex), value.slice(slashIndex + 1), sourceModel);
        return;
      }
      onSelectModel("", value, sourceModel);
    },
    [
      configOptionsError,
      displayProvider,
      draftMode,
      effectiveConfig?.model,
      effectiveConfig?.provider,
      onRecoverCustomModelSelection,
      onSelectModel,
      modelLocked,
      modelSelectionView,
      workspaceIdentity,
      workspacePath,
    ],
  );

  const planGroups = useMemo(
    () =>
      buildComposerPlanGroups(
        modelSelectGroups,
        subscribedTeamProducts,
        providerSettingsView,
        displayProvider,
        modelGroupLabels,
        sharedSettings?.providerFamilyConnectionSelections,
      ),
    [
      modelSelectGroups,
      subscribedTeamProducts,
      providerSettingsView,
      displayProvider,
      modelGroupLabels,
      sharedSettings?.providerFamilyConnectionSelections,
    ],
  );
  const connectionSwitch = useComposerConnectionSwitch({
    workspacePath,
    workspaceIdentity,
    agentProvider: displayProvider,
    normalizedValue: normalizedModelValue,
    onSelectModel: handleModelValueChange,
    waitForPresentation: true,
    refreshPresentation: modelSelectionRefresh,
    presentationStatus: modelSelectionState.status,
    presentationRevision: modelSelectionView?.revision,
    presentationErrorRevision:
      modelSelectionState.status === "ready"
        ? modelSelectionState.refreshError?.revision
        : undefined,
  });
  const selectedProviderId = decodeCustomModelValue(normalizedModelValue)?.providerId;
  const selectedPlanGroup = planGroups.find((group) => {
    const connection = group.connection;
    if (!connection || connection.providerId !== selectedProviderId) return false;
    const selection = sharedSettings?.providerFamilyConnectionSelections?.[connection.family];
    return (
      connection.selection?.kind !== "team-coding-plan" ||
      (selection && composerConnectionKey(connection.family, selection) === connection.key)
    );
  });
  const selectedPlanKey = connectionSwitch.pending
    ? connectionSwitch.previousKey
    : (selectedPlanGroup?.key ??
      planGroups.find(
        (group) =>
          group.connection?.selection?.kind !== "team-coding-plan" &&
          group.items.some((item) => item.value === normalizedModelValue),
      )?.key);

  const draftModelThoughtOption = useMemo(
    () =>
      effectiveConfig
        ? resolveDraftModelThoughtOption(
            effectiveConfig.provider,
            effectiveConfig.model,
            modelSelectionView,
          )
        : null,
    [effectiveConfig, modelSelectionView],
  );

  const thoughtOption = useMemo<CfConfigOption | null>(() => {
    if (!effectiveConfig) return null;
    if (!draftModelThoughtOption) return null;
    return {
      ...draftModelThoughtOption,
      currentValue: resolveDraftThoughtCurrentValue({
        thought: effectiveConfig.thought,
        thoughtLevels: draftModelThoughtOption.options?.map((option) => option.value) ?? [],
      }),
    };
  }, [draftModelThoughtOption, effectiveConfig]);

  const handleThoughtValueChange = useCallback(
    (value: string) => {
      if (!effectiveConfig) return;
      if (!value.trim()) {
        logger.debug("[v4-toolbar] ignore synthetic empty thought change", {
          model: effectiveConfig.model,
          provider: effectiveConfig.provider,
        });
        return;
      }
      onSelectThought(value, {
        provider: effectiveConfig.provider,
        model: effectiveConfig.model,
      });
    },
    [effectiveConfig, onSelectThought],
  );

  const handleCycleThoughtLevel = useCallback(() => {
    if (!thoughtOption || thoughtOption.type !== "select") {
      return;
    }
    const nextValue = getNextThoughtLevelValue(thoughtOption);
    if (nextValue == null) {
      return;
    }
    if (!effectiveConfig) return;
    onSelectThought(nextValue, {
      provider: effectiveConfig.provider,
      model: effectiveConfig.model,
    });
  }, [effectiveConfig, onSelectThought, thoughtOption]);

  const taskUsage = useMemo(() => {
    const contextWindow = usage?.contextWindow;
    if (!contextWindow) return null;
    return {
      used: contextWindow.usedTokens,
      size: contextWindow.maxTokens,
      ...(contextWindow.cache ? { cache: contextWindow.cache } : {}),
      ...(contextWindow.breakdown ? { breakdown: contextWindow.breakdown } : {}),
    };
  }, [usage?.contextWindow]);
  const modelShortcutLabel = useShortcutCommandLabel("openModelMenu");
  const thoughtShortcutLabel = useShortcutCommandLabel("cycleThoughtLevel");
  const selectConnection = connectionSwitch.select;
  const composerOptions = useMemo<ComposerModelOptions>(
    () => ({
      providerMenu: {
        groups: planGroups,
        selectedKey: selectedPlanKey,
        pending: connectionSwitch.pending,
        error: connectionSwitch.error,
        onSelect: (group) => {
          if (group.key === selectedPlanKey && !connectionSwitch.error) return;
          if (group.connection) {
            void selectConnection(group.connection, selectedPlanKey);
          } else {
            const model = chooseConnectionModel(
              group.items,
              decodeCustomModelValue(normalizedModelValue)?.modelName,
            );
            const providerId = decodeCustomModelValue(model?.value ?? "")?.providerId;
            if (providerId)
              void selectConnection(
                {
                  key: group.key,
                  label: group.label,
                  providerId,
                  family: connectionFamily,
                  items: group.items,
                },
                selectedPlanKey,
              );
          }
        },
      },
      providerLabel: intl.formatMessage({ id: "chat.toolbar.combined.provider" }),
      modelsLabel: intl.formatMessage({ id: "chat.toolbar.combined.models" }),
      effortLabel: intl.formatMessage({ id: "chat.toolbar.combined.effort" }),
      effortShortcutLabel: thoughtShortcutLabel,
      selectModelLabel: intl.formatMessage({ id: "chat.toolbar.combined.selectModel" }),
      levels:
        thoughtOption?.options?.map((entry) => ({
          value: entry.value,
          label: getThoughtLevelLabel(intl, displayProvider, thoughtOption, entry),
        })) ?? [],
      value: String(thoughtOption?.currentValue ?? ""),
      onValueChange: handleThoughtValueChange,
    }),
    [
      planGroups,
      selectedPlanKey,
      connectionSwitch.pending,
      connectionSwitch.error,
      selectConnection,
      normalizedModelValue,
      connectionFamily,
      intl,
      thoughtShortcutLabel,
      thoughtOption,
      displayProvider,
      handleThoughtValueChange,
    ],
  );
  const isModelOptionLocked = useCallback(() => false, []);

  const modelMenuVisible = modelSelectGroups.length > 0 || showManageModelsAction;
  const providerSubmenuClassName =
    isWebRemoteControl && isMobileViewport
      ? "w-40 min-w-0 max-w-(--radix-dropdown-menu-content-available-width)"
      : undefined;
  useToolbarShortcutBindings({
    hasAnyOption: Boolean(modelOption) || Boolean(thoughtOption),
    toolbarDisabled: disabled || recoveryPending || connectionSwitch.pending,
    modelMenuDisabled:
      disabled || recoveryPending || modelLocked || connectionSwitch.pending || !modelMenuVisible,
    modelOption,
    thoughtOption: thoughtOption ?? undefined,
    onOpenModelMenu: handleOpenModelMenuShortcut,
    onCycleThoughtLevel: handleCycleThoughtLevel,
    onCycleSessionMode: noop,
  });

  return (
    <>
      {}
      <span
        data-testid={TID_V4_MODEL_CONFIG}
        data-source={effectiveConfig || draftConfig?.mode ? "composer" : ""}
        data-provider={effectiveConfig?.provider ?? ""}
        data-model={effectiveConfig?.model ?? ""}
        data-thought={
          thoughtOption?.type === "select"
            ? String(thoughtOption.currentValue ?? "")
            : (effectiveConfig?.thought ?? "")
        }
        data-thought-levels={
          thoughtOption?.type === "select"
            ? (thoughtOption.options ?? []).map((option) => option.value).join(",")
            : ""
        }
        data-mode={draftConfig?.mode ?? ""}
        data-plan-enabled={draftConfig?.planEnabled ?? false}
        data-usage-used={usage?.contextWindow?.usedTokens ?? ""}
        data-usage-max={usage?.contextWindow?.maxTokens ?? ""}
        className="hidden"
      />
      {}
      {!modelLocked ? (
        <ChatContextUsage
          codingPlanUsageRemaining={codingPlanUsageRemaining}
          taskUsage={taskUsage}
          startPlanBalance={contextStartPlanBalance}
          selectedProvider={displayProvider}
          intl={intl}
          locale={locale}
          onSendCompressionCommand={onSendCompressionCommand}
          compressionDisabled={disabled || recoveryPending}
        />
      ) : null}
      {}
      {highspeedPresented && highspeedModel ? (
        <HighspeedModelIndicator
          model={highspeedModel}
          originalModel={modelTriggerDisplay.fullLabel}
          sweepActive={highspeedSweepActive}
          animateEntrance={highspeedEntranceAnimated}
        />
      ) : modelSelectionState.status === "error" && modelSelectionReload ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-ui-sm text-destructive"
          onClick={modelSelectionReload}
        >
          {intl.formatMessage({ id: "chat.toolbar.model.loadFailedRetry" })}
        </Button>
      ) : modelSelectionState.status === "unavailable" ? (
        <span className="px-2 text-ui-sm text-foreground-subtle">
          {intl.formatMessage({
            id:
              modelSelectionState.reason === "remote-waiting"
                ? "chat.toolbar.model.remoteWaiting"
                : "chat.toolbar.model.targetMissing",
          })}
        </span>
      ) : modelMenuVisible &&
        !providerSourcesLoading &&
        planGroups.length === 0 &&
        !connectionSwitch.pending ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-ui-sm"
          data-testid="chat-model-select-trigger"
          onClick={handleOpenModelProviderSettings}
        >
          {manageModelsLabel}
        </Button>
      ) : modelMenuVisible ? (
        <ModelConfigSelect
          key={workspaceIdentity?.trim() || workspacePath}
          modelGroups={modelSelectGroups}
          contentAlign="center"
          normalizedValue={normalizedModelValue}
          triggerLabel={modelTriggerDisplay.modelLabel}
          composerOptions={composerOptions}
          showManageModelsAction={showManageModelsAction}
          manageModelsLabel={manageModelsLabel}
          onManageModels={handleOpenModelProviderSettings}
          lockReasonMessage={intl.formatMessage({
            id: modelLocked
              ? "chat.highspeed.modelLocked"
              : "chat.toolbar.modelSwitch.lockedByRunningTask",
          })}
          isItemLocked={isModelOptionLocked}
          onValueChange={handleModelValueChange}
          disabled={
            disabled ||
            recoveryPending ||
            modelLocked ||
            (modelSelectionState.status !== "ready" &&
              !(modelSelectionState.status === "loading" && modelSelectionState.catalog))
          }
          tooltipTitle={modelTriggerDisplay.fullLabel}
          shortcutLabel={modelShortcutLabel}
          triggerRef={modelTriggerRef}
          open={!modelLocked && activeConfigPicker === "model"}
          onOpenChange={handleModelPickerOpenChange}
          openRequestKey={modelMenuOpenRequestKey}
          labelVisibilityClassName="hidden @sm/composer:inline-flex"
          indicatorClassName="block group-data-[composer-model-icon=true]/toolbar:hidden"
          triggerLabelClassName="block min-w-0 text-left group-data-[composer-model-icon=true]/toolbar:hidden [&>span]:max-w-full [&>span>span]:block [&>span>span]:truncate"
          triggerClassName="composer-model-trigger group-data-[composer-model-icon=true]/toolbar:px-1.5 group-data-[composer-model-icon=true]/toolbar:justify-center"
          triggerIconClassName="hidden group-data-[composer-model-icon=true]/toolbar:inline-flex"
          focusSelectorOnClose={V4_COMPOSER_INPUT_SELECTOR}
          providerSubmenuClassName={providerSubmenuClassName}
        />
      ) : null}
      {highspeedPresented && highspeedExpiresAt !== undefined ? (
        <HighspeedCountdown expiresAt={highspeedExpiresAt} />
      ) : null}
      {thoughtOption && (modelLocked || highspeedPresented) ? (
        <ThoughtLevelCycleControl
          composerCollapsePriority={3}
          labelVisibilityClassName="inline-flex"
          indicatorClassName="block"
          triggerClassName={cn(highspeedPresented && "text-ui-caption")}
          option={thoughtOption}
          onValueChange={handleThoughtValueChange}
          disabled={disabled || recoveryPending}
          intl={intl}
          provider={displayProvider}
          shortcutLabel={thoughtShortcutLabel}
          triggerRef={thoughtTriggerRef}
          open={activeConfigPicker === "thought"}
          onOpenChange={handleThoughtPickerOpenChange}
          restoreFocusSelector={V4_COMPOSER_INPUT_SELECTOR}
        />
      ) : null}
    </>
  );
}

export const V4ComposerModelControls = memo(V4ComposerModelControlsImpl);
import { isApiKeyAccess } from "@origin-ai/cf-provider";
