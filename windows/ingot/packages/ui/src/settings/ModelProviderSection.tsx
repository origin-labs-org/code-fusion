
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { marketingNavigation, finishMarketingNavigation } from "@/lib/marketingNavigation.js";
import {
  getProviderFormApiKey,
  type ProviderSettingsFormProvider,
} from "@/lib/providerSettingsFormTypes.js";
import {
  BIGMODEL_PROVIDER_ID,
  BUILTIN_MODEL_PROVIDER_IDS,
  DesktopCommandIds,
  isStartPlanModelProviderId,
  type BuiltinModelProviderId,
  type ModelConnectivityResult,
  type ProviderFamilyConnectionSelection,
  type ProviderFamilyConnectionSelectionSettings,
  type ProviderFamilyDomain,
  type OAuthProviderId,
  resolveModelProviderFamilyIdByProviderId,
  resolveModelProviderFamilySpecByProviderId,
  resolveProviderFamilyDomainFromOAuthProvider,
  ZAI_PROVIDER_ID,
} from "@origin-ai/cf-shared";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { Button } from "@/components/ui/button.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { useModelProviders } from "@/hooks/useModelProviders.js";
import { resolveEntitledAccountProviderAccess } from "@/lib/accountProviderAccess.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useServices } from "@/hooks/useServices.js";
import { useCfStore } from "@/store/StoreProvider.js";
import { logger } from "@/logger.js";
import {
  PRESET_PROVIDER_SPECS,
  PRESET_SUBSCRIPTION_TIMEOUT_MS,
  BIGMODEL_REGISTRATION_URL,
  type CodingPlanStatus,
  type ModelProviderNavGroup,
} from "./model-provider-section/constants.js";
import { ModelProviderSectionDetail } from "./model-provider-section/Detail.js";
import { ModelProviderSectionLayout } from "./model-provider-section/SectionLayout.js";
import { ProviderTemplatePicker } from "./model-provider-section/ProviderTemplatePicker.js";
import type { CodingPlanLoginOptions } from "./model-provider-section/codingPlanPricingCards.js";
import { useModelProviderNavigation } from "./model-provider-section/useModelProviderNavigation.js";
import { reportPresetSubscriptionSuccess } from "./model-provider-section/oauthActions.js";
import {
  createCodingPlanProviderNodeKey,
  createCustomProviderNodeKey,
  createPresetProviderNodeKey,
} from "./model-provider-section/utils.js";
import {
  confirmAndDeleteModelProvider,
  refreshModelProviderSection,
  refreshProviderPanelAfterAuthChange as refreshModelProviderPanelAfterAuthChange,
} from "./model-provider-section/modelProviderActions.js";
import {
  useCodingPlanAccessRefresh,
  useCodingPlanEntitlements,
} from "./model-provider-section/useCodingPlanEntitlements.js";
import { sortModelProvidersForDisplay } from "@/lib/modelProviderOrdering.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { resolveLogoutProviderFamilyDomain } from "@/lib/providerFamilyDomainSettings.js";
import {
  addPendingSettingsSectionListener,
  consumePendingSettingsModelProviderTarget,
  type SettingsModelProviderTarget,
} from "@/lib/settingsNavigation.js";
import { useEnterpriseCodingPlanProducts } from "@/settings/model-provider-section/useEnterpriseCodingPlanProducts.js";

export {
  fuzzyMatch,
  handleEndpointSuggestionPopoverOpenAutoFocus,
  resolveEndpointSuggestionOpenRequest,
} from "./model-provider-section/utils.js";

type CodingPlanConnectionNavItem = Extract<
  ModelProviderNavGroup["items"][number],
  { type: "codingPlan" | "teamPlan" }
>;

export function resolveCodingPlanProviderSyncAttemptKey({
  activeOAuthProvider,
  oauthProviderId,
  providerId,
}: {
  activeOAuthProvider: OAuthProviderId | null;
  oauthProviderId: OAuthProviderId;
  providerId: BuiltinModelProviderId;
}): string | null {
  if (activeOAuthProvider !== oauthProviderId) {
    return null;
  }
  return `${providerId}:${activeOAuthProvider}`;
}

export function shouldRetryUnchangedCodingPlanProviderSync({
  attemptKey,
  attemptStatus,
  modeUnchanged,
  selectedKeyUnchanged,
}: {
  attemptKey: string | null;
  attemptStatus: "inFlight" | "succeeded" | "failed" | undefined;
  modeUnchanged: boolean;
  selectedKeyUnchanged: boolean;
}): boolean {
  return modeUnchanged && selectedKeyUnchanged && attemptKey !== null && attemptStatus === "failed";
}

function resolveCodingPlanIntentProviderId(
  target: SettingsModelProviderTarget | undefined,
): BuiltinModelProviderId | null {
  switch (target?.providerId) {
    case BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan:
    case BUILTIN_MODEL_PROVIDER_IDS.zaiTeamCodingPlan:
    case BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan:
    case BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan:
    case BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan:
    case BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan:
      return target.providerId;
    default:
      return null;
  }
}

function shouldRefreshCodingPlanEntitlementsAfterSave(
  previousProvider: ProviderSettingsFormProvider | undefined,
  nextProvider: ProviderSettingsFormProvider,
): boolean {
  const isCodingPlanProvider =
    nextProvider.providerId === BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan ||
    nextProvider.providerId === BUILTIN_MODEL_PROVIDER_IDS.zaiTeamCodingPlan ||
    nextProvider.providerId === BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan ||
    nextProvider.providerId === BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan ||
    nextProvider.providerId === BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan ||
    nextProvider.providerId === BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan;
  if (!isCodingPlanProvider) {
    return false;
  }

  return (
    (previousProvider ? getProviderFormApiKey(previousProvider).trim() : "") !==
    getProviderFormApiKey(nextProvider).trim()
  );
}

function resolveBuiltinPresetOAuthProvider(
  presetId: BuiltinModelProviderId,
): OAuthProviderId | null {
  if (
    presetId === BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan ||
    presetId === BUILTIN_MODEL_PROVIDER_IDS.zaiTeamCodingPlan ||
    presetId === BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan
  ) {
    return ZAI_PROVIDER_ID;
  }
  if (
    presetId === BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan ||
    presetId === BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan ||
    presetId === BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan
  ) {
    return BIGMODEL_PROVIDER_ID;
  }
  return null;
}

function shouldShowPresetProviderForActiveOAuth(
  presetId: BuiltinModelProviderId,
  providerFamilyDomain: ProviderFamilyDomain | null | undefined,
): boolean {
  const presetOAuthProvider = resolveBuiltinPresetOAuthProvider(presetId);
  if (!providerFamilyDomain || !presetOAuthProvider) {
    return true;
  }
  return resolveModelProviderFamilyIdByProviderId(presetId) === providerFamilyDomain;
}

function clearPendingProviderFamilyConnectionSelection(
  selections: ProviderFamilyConnectionSelectionSettings,
  familyId: ProviderFamilyDomain,
  selection: ProviderFamilyConnectionSelection,
): ProviderFamilyConnectionSelectionSettings {
  if (JSON.stringify(selections[familyId]) !== JSON.stringify(selection)) {
    return selections;
  }
  const { [familyId]: _removed, ...rest } = selections;
  return rest;
}

function resolveProviderFamilySideNodeKey(providerId: BuiltinModelProviderId): string | null {
  if (isStartPlanModelProviderId(providerId)) return createCodingPlanProviderNodeKey(providerId);
  const familySpec = resolveModelProviderFamilySpecByProviderId(providerId);
  return familySpec ? createPresetProviderNodeKey(familySpec.startPlanProviderId) : null;
}

function resolveConnectionSelectionForNavItem(
  item: Extract<
    ModelProviderNavGroup["items"][number],
    { type: "preset" | "codingPlan" | "teamPlan" }
  >,
): ProviderFamilyConnectionSelection | null {
  if (item.type === "preset") return null;
  if (item.type === "teamPlan") {
    const productId = item.currentProductId?.trim() ?? "";
    const organizationId = item.organizationId?.trim() ?? "";
    const projectId = item.projectId?.trim() ?? "";
    return productId && organizationId && projectId
      ? { kind: "team-coding-plan", productId, organizationId, projectId }
      : null;
  }
  return isStartPlanModelProviderId(item.presetId) ? null : { kind: "individual-coding-plan" };
}

export function resolveModelProviderSideSelectionKey(
  item: ModelProviderNavGroup["items"][number],
): string {
  if (item.type !== "preset" && item.type !== "codingPlan" && item.type !== "teamPlan") {
    return item.key;
  }
  if (
    item.type === "preset" ||
    (item.type === "codingPlan" && isStartPlanModelProviderId(item.presetId))
  )
    return item.key;
  return resolveProviderFamilySideNodeKey(item.presetId) ?? item.key;
}

export function ModelProviderSection({
  workspacePath = "",
  connectivityWorkspacePath,
  connectivityWorkspaceRequired = false,
  pendingModelProviderTarget,
  onConsumePendingModelProviderTarget,
}: {
  workspacePath?: string;
  connectivityWorkspacePath?: string;
  connectivityWorkspaceRequired?: boolean;
  pendingModelProviderTarget?: SettingsModelProviderTarget;
  onConsumePendingModelProviderTarget?: () => void;
} = {}) {
  const { intl, locale } = useCfIntl();
  const confirmDialog = useConfirmDialog();
  const platform = usePlatform();
  const { modelSelectionService, oauthService, credentialService } = useServices();
  const {
    modelProviders,
    providerTemplates,
    displayOrder,
    loading,
    loadError,
    reload,
    refreshing: modelProvidersRefreshing,
    refresh,
    saveProvider,
    createPersonalProvider,
    addPersonalModel,
    savePersonalModelDraft,
    setPersonalModelEnabled,
    deletePersonalModel,
    deleteProvider,
    reorderProviderModels,
    saveDisplayOrder,
    reorderableProviderIds,
    testModelConnectivity,
    providerSettingsView,
  } = useModelProviders({
    workspacePath,
    connectivityWorkspacePath,
    connectivityWorkspaceRequired,
    connectivityUnavailableMessage: intl.formatMessage({
      id: "settings.modelProvider.testModel.localWorkspaceUnavailable",
    }),
  });
  const entitledAccountProviderIds = useMemo<ReadonlySet<string>>(() => {
    return new Set(
      (providerSettingsView?.providers ?? [])
        .filter(
          (provider) =>
            provider.effectiveConfig.access?.type === "zhipu-account" &&
            provider.effectiveConfig.access.entitled === true,
        )
        .map((provider) => provider.providerId),
    );
  }, [providerSettingsView]);
  const providerConnectionRefreshSignal = providerSettingsView?.revision;
  const [initialModelProviderTarget] = useState(() => consumePendingSettingsModelProviderTarget());
  const [invalidProviderTarget, setInvalidProviderTarget] = useState(() =>
    Boolean(
      initialModelProviderTarget && !resolveCodingPlanIntentProviderId(initialModelProviderTarget),
    ),
  );
  const [selectedNodeKey, setSelectedNodeKey] = useState<string | null>(() => {
    const providerId = resolveCodingPlanIntentProviderId(initialModelProviderTarget);
    return providerId ? resolveProviderFamilySideNodeKey(providerId) : null;
  });
  const [presetSubscriptionProviderId, setPresetSubscriptionProviderId] =
    useState<BuiltinModelProviderId | null>(null);
  const [codingPlanStatusSyncProviderId, setCodingPlanStatusSyncProviderId] =
    useState<BuiltinModelProviderId | null>(null);
  const [codingPlanDisconnectProviderId, setCodingPlanDisconnectProviderId] =
    useState<BuiltinModelProviderId | null>(null);
  const [, setCodingPlanProductsRefreshToken] = useState(0);
  const [pendingCreatedProviderId, setPendingCreatedProviderId] = useState<string | null>(null);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [creatingProvider, setCreatingProvider] = useState(false);

  useEffect(() => {
    if (
      !pendingCreatedProviderId ||
      !modelProviders.some((provider) => provider.providerId === pendingCreatedProviderId)
    ) {
      return;
    }
    setSelectedNodeKey(createCustomProviderNodeKey(pendingCreatedProviderId));
    setPendingCreatedProviderId(null);
  }, [modelProviders, pendingCreatedProviderId]);

  const applyModelProviderTarget = useCallback(
    (target: SettingsModelProviderTarget | undefined) => {
      if (!target) return false;
      const providerId = resolveCodingPlanIntentProviderId(target);
      if (!providerId) {
        logger.warn("[ModelProviderSection] 无法打开目标供应商", { providerId: target.providerId });
        setInvalidProviderTarget(true);
        setTemplatePickerOpen(false);
        return true;
      }

      setInvalidProviderTarget(false);
      setTemplatePickerOpen(false);
      setSelectedNodeKey(resolveProviderFamilySideNodeKey(providerId));
      return true;
    },
    [],
  );

  useEffect(() => {
    if (!pendingModelProviderTarget) {
      return;
    }
    if (applyModelProviderTarget(pendingModelProviderTarget)) {
      onConsumePendingModelProviderTarget?.();
    }
  }, [applyModelProviderTarget, onConsumePendingModelProviderTarget, pendingModelProviderTarget]);

  useEffect(
    () =>
      addPendingSettingsSectionListener((section, detail) => {
        if (section !== "modelProvider") {
          return;
        }
        applyModelProviderTarget(
          detail?.modelProviderId
            ? {
                providerId: detail.modelProviderId,
              }
            : undefined,
        );
      }),
    [applyModelProviderTarget],
  );
  const [
    codingPlanPurchaseTokenAuthenticatedByProviderId,
    setCodingPlanPurchaseTokenAuthenticatedByProviderId,
  ] = useState<Partial<Record<BuiltinModelProviderId, boolean>>>({});
  const [activeOAuthProvider, setActiveOAuthProvider] = useState<OAuthProviderId | null>(null);
  const [pendingConnectionSelections, setPendingConnectionSelections] =
    useState<ProviderFamilyConnectionSelectionSettings>({});
  const presetSubscriptionCompletionProviderIdRef = useRef<BuiltinModelProviderId | null>(null);
  const codingPlanStatusSyncAttemptsRef = useRef(
    new Map<string, "inFlight" | "succeeded" | "failed">(),
  );
  const requestLoginEntry = useCfStore((state) => state.requestLoginEntry);
  const setUser = useCfStore((state) => state.setUser);
  const oauthError = useCfStore((state) => state.oauthError);
  const setOAuthError = useCfStore((state) => state.setOAuthError);
  const {
    settings: sharedSettings,
    loading: sharedSettingsLoading,
    error: sharedSettingsError,
    update: updateSharedSettings,
  } = useSettings();
  const authenticatedEnterpriseProducts = useEnterpriseCodingPlanProducts({
    enabled:
      codingPlanPurchaseTokenAuthenticatedByProviderId[
        BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan
      ] === true,
    authenticated: true,
    family: "bigmodel",
  });
  const authenticatedZaiEnterpriseProducts = useEnterpriseCodingPlanProducts({
    enabled:
      codingPlanPurchaseTokenAuthenticatedByProviderId[
        BUILTIN_MODEL_PROVIDER_IDS.zaiTeamCodingPlan
      ] === true,
    authenticated: true,
    family: "zai",
  });
  const refreshAuthenticatedEnterpriseProducts = useCallback(async () => {
    await Promise.all([
      authenticatedEnterpriseProducts.refresh(),
      authenticatedZaiEnterpriseProducts.refresh(),
    ]);
  }, [authenticatedEnterpriseProducts, authenticatedZaiEnterpriseProducts]);
  const subscribedTeamProducts = useMemo(
    () => [
      ...(authenticatedEnterpriseProducts.snapshot?.productList.filter(
        (product) => product.subscribed === true,
      ) ?? []),
      ...(authenticatedZaiEnterpriseProducts.snapshot?.productList.filter(
        (product) => product.subscribed === true,
      ) ?? []),
    ],
    [
      authenticatedEnterpriseProducts.snapshot?.productList,
      authenticatedZaiEnterpriseProducts.snapshot?.productList,
    ],
  );
  const connectionSelections = sharedSettings?.providerFamilyConnectionSelections ?? {};
  const familyConnectionSettingsFailed = sharedSettingsError !== null && sharedSettings === null;
  const effectiveConnectionSelections = useMemo(
    () => ({
      ...connectionSelections,
      ...pendingConnectionSelections,
    }),
    [connectionSelections, pendingConnectionSelections],
  );
  const showPurchasedTeamPlanFallback = Boolean(
    effectiveConnectionSelections.bigmodel?.kind === "team-coding-plan" ||
    effectiveConnectionSelections.zai?.kind === "team-coding-plan",
  );
  const effectiveProviderFamilyDomain =
    sharedSettings?.providerFamilyDomain ??
    resolveProviderFamilyDomainFromOAuthProvider(activeOAuthProvider);
  const { entitlements: codingPlanEntitlements, refresh: refreshCodingPlanEntitlements } =
    useCodingPlanEntitlements({
      providerSettingsView,
      connectionSelections: effectiveConnectionSelections,
      suppressProviderFingerprintAutoRefresh: codingPlanStatusSyncProviderId !== null,
    });
  useEffect(() => {
    setPendingConnectionSelections((current) => {
      let next = current;
      for (const [familyId, selection] of Object.entries(current) as Array<
        [ProviderFamilyDomain, ProviderFamilyConnectionSelection]
      >) {
        if (JSON.stringify(connectionSelections[familyId]) !== JSON.stringify(selection)) {
          continue;
        }
        next = clearPendingProviderFamilyConnectionSelection(next, familyId, selection);
      }
      return next;
    });
  }, [connectionSelections]);

  const refreshCodingPlanProducts = useCallback(() => {
    setCodingPlanProductsRefreshToken((current) => current + 1);
  }, []);

  const refreshCodingPlanPurchaseTokenState = useCallback(
    async (
      options: {
        clearUserWhenLoggedOut?: boolean;
        shouldApply?: () => boolean;
      } = {},
    ) => {
      const [activeProvider, zaiToken, bigmodelToken] = await Promise.all([
        credentialService.load("oauth:active_provider"),
        credentialService.load(`oauth:${ZAI_PROVIDER_ID}:access_token`),
        credentialService.load(`oauth:${BIGMODEL_PROVIDER_ID}:access_token`),
      ]);
      if (options.shouldApply && !options.shouldApply()) {
        return null;
      }
      const normalizedActiveProvider =
        activeProvider === ZAI_PROVIDER_ID || activeProvider === BIGMODEL_PROVIDER_ID
          ? activeProvider
          : null;
      setActiveOAuthProvider(normalizedActiveProvider);
      setCodingPlanPurchaseTokenAuthenticatedByProviderId({
        [BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan]:
          normalizedActiveProvider === ZAI_PROVIDER_ID && (zaiToken?.trim().length ?? 0) > 0,
        [BUILTIN_MODEL_PROVIDER_IDS.zaiTeamCodingPlan]:
          normalizedActiveProvider === ZAI_PROVIDER_ID && (zaiToken?.trim().length ?? 0) > 0,
        [BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan]:
          normalizedActiveProvider === ZAI_PROVIDER_ID && (zaiToken?.trim().length ?? 0) > 0,
        [BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan]:
          normalizedActiveProvider === BIGMODEL_PROVIDER_ID &&
          (bigmodelToken?.trim().length ?? 0) > 0,
        [BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan]:
          normalizedActiveProvider === BIGMODEL_PROVIDER_ID &&
          (bigmodelToken?.trim().length ?? 0) > 0,
        [BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan]:
          normalizedActiveProvider === BIGMODEL_PROVIDER_ID &&
          (bigmodelToken?.trim().length ?? 0) > 0,
      });
      if (!normalizedActiveProvider && options.clearUserWhenLoggedOut) {
        setUser(null);
        setOAuthError(null);
      }
      return normalizedActiveProvider;
    },
    [credentialService, setOAuthError, setUser],
  );

  const refreshProviderPanelAfterAuthChange = useCallback(
    async ({
      refreshPlanSnapshots = true,
      refreshReason = "auth",
    }: {
      refreshPlanSnapshots?: boolean;
      refreshReason?: "auth" | "purchase";
    }) => {
      await refreshModelProviderPanelAfterAuthChange({
        refreshModelProviders: refresh,
        refreshCodingPlanEntitlements: () =>
          refreshCodingPlanEntitlements({ force: true, reason: refreshReason }),
        refreshTeamPlanProducts: refreshAuthenticatedEnterpriseProducts,
        refreshCodingPlanProducts,
        refreshPurchaseTokenState: refreshCodingPlanPurchaseTokenState,
        refreshPlanSnapshots,
      });
    },
    [
      refresh,
      refreshAuthenticatedEnterpriseProducts,
      refreshCodingPlanEntitlements,
      refreshCodingPlanProducts,
      refreshCodingPlanPurchaseTokenState,
      refreshModelProviderPanelAfterAuthChange,
    ],
  );

  const syncCodingPlanProviderOnce = useCallback(
    async (
      item: CodingPlanConnectionNavItem,
      options: { userTransition?: boolean; refreshPlanSnapshots?: boolean } = {},
    ) => {
      const attemptKey = resolveCodingPlanProviderSyncAttemptKey({
        activeOAuthProvider,
        oauthProviderId: item.oauthProviderId,
        providerId: item.presetId,
      });
      if (!attemptKey) {
        return;
      }
      if (
        options.userTransition !== true &&
        codingPlanStatusSyncAttemptsRef.current.has(attemptKey)
      ) {
        return;
      }
      codingPlanStatusSyncAttemptsRef.current.set(attemptKey, "inFlight");
      setCodingPlanStatusSyncProviderId(item.presetId);
      try {
        await refreshProviderPanelAfterAuthChange({
          refreshPlanSnapshots: options.refreshPlanSnapshots,
        });
        codingPlanStatusSyncAttemptsRef.current.set(attemptKey, "succeeded");
      } catch (error) {
        codingPlanStatusSyncAttemptsRef.current.set(attemptKey, "failed");
        throw error;
      } finally {
        setCodingPlanStatusSyncProviderId((current) =>
          current === item.presetId ? null : current,
        );
      }
    },
    [activeOAuthProvider, refreshProviderPanelAfterAuthChange],
  );

  useEffect(() => {
    let disposed = false;

    void refreshCodingPlanPurchaseTokenState({
      shouldApply: () => !disposed,
    });

    return () => {
      disposed = true;
    };
  }, [providerConnectionRefreshSignal, refreshCodingPlanPurchaseTokenState]);

  const presetProviders = useMemo(
    () =>
      PRESET_PROVIDER_SPECS.filter((preset) =>
        shouldShowPresetProviderForActiveOAuth(preset.id, effectiveProviderFamilyDomain),
      ).map((preset) => ({
        ...preset,
        provider: modelProviders.find((provider) => provider.providerId === preset.id) ?? null,
      })),
    [effectiveProviderFamilyDomain, modelProviders],
  );

  useEffect(() => {
    if (!presetSubscriptionProviderId) {
      return;
    }

    const accountEntitled = Boolean(
      resolveEntitledAccountProviderAccess(providerSettingsView, presetSubscriptionProviderId),
    );
    if (accountEntitled) {
      if (presetSubscriptionCompletionProviderIdRef.current === presetSubscriptionProviderId) {
        return;
      }

      presetSubscriptionCompletionProviderIdRef.current = presetSubscriptionProviderId;
      void (async () => {
        void reportPresetSubscriptionSuccess({
          platform,
          presetId: presetSubscriptionProviderId,
        });
        try {
          await refreshProviderPanelAfterAuthChange({});
        } finally {
          presetSubscriptionCompletionProviderIdRef.current = null;
          setCodingPlanStatusSyncProviderId((current) =>
            current === presetSubscriptionProviderId ? null : current,
          );
          setPresetSubscriptionProviderId((current) =>
            current === presetSubscriptionProviderId ? null : current,
          );
        }
      })();
    }
  }, [
    platform,
    presetSubscriptionProviderId,
    providerSettingsView,
    refreshProviderPanelAfterAuthChange,
  ]);

  useEffect(() => {
    if (!presetSubscriptionProviderId) {
      return;
    }

    const timeoutId = setTimeout(() => {
      setCodingPlanStatusSyncProviderId((current) =>
        current === presetSubscriptionProviderId ? null : current,
      );
      setPresetSubscriptionProviderId((current) => {
        if (current !== presetSubscriptionProviderId) {
          return current;
        }
        return null;
      });
    }, PRESET_SUBSCRIPTION_TIMEOUT_MS);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [presetSubscriptionProviderId]);

  const { navigationGroups, navigationItems, selectedNavItem, navigationUnavailable } =
    useModelProviderNavigation({
      presetProviders,
      modelProviders,
      entitledAccountProviderIds,
      modelProvidersLoading: loading,
      displayOrder,
      codingPlanEntitlements,
      subscribedTeamProducts,
      providerFamilyDomain: effectiveProviderFamilyDomain,
      connectionSelections: effectiveConnectionSelections,
      pendingConnectionSelections,
      showPurchasedTeamPlanFallback,
      familyConnectionSettingsLoading: sharedSettingsLoading && sharedSettings === null,
      familyConnectionSettingsFailed,
      selectedNodeKey,
      setSelectedNodeKey,
      intl,
    });
  const selectedPlanAccessKey =
    selectedNavItem?.type === "codingPlan" || selectedNavItem?.type === "teamPlan"
      ? selectedNavItem.key
      : null;
  useCodingPlanAccessRefresh({
    refresh: refreshCodingPlanEntitlements,
    selectedPlanKey: selectedPlanAccessKey,
  });

  useEffect(() => {
    if (selectedNavItem?.type !== "codingPlan" && selectedNavItem?.type !== "teamPlan") {
      return;
    }
    if (
      activeOAuthProvider !== selectedNavItem.oauthProviderId ||
      presetSubscriptionProviderId === selectedNavItem.presetId ||
      codingPlanDisconnectProviderId === selectedNavItem.presetId
    ) {
      return;
    }

    const accountEntitled = selectedNavItem.accountEntitled === true;
    if (accountEntitled) {
      return;
    }

    void syncCodingPlanProviderOnce(selectedNavItem).catch((error) => {
      logger.warn("[ModelProviderSection] 自动同步 Coding Plan provider 失败", {
        providerId: selectedNavItem.presetId,
        error,
      });
    });
  }, [
    activeOAuthProvider,
    codingPlanDisconnectProviderId,
    presetSubscriptionProviderId,
    selectedNavItem,
    syncCodingPlanProviderOnce,
  ]);

  const handleSave = useCallback(
    async (config: ProviderSettingsFormProvider) => {
      try {
        const previousProvider = modelProviders.find(
          (provider) => provider.providerId === config.providerId,
        );
        await saveProvider(config);
        if (shouldRefreshCodingPlanEntitlementsAfterSave(previousProvider, config)) {
          refreshCodingPlanEntitlements();
        }
      } catch (error) {
        logger.error("[ModelProviderSection] 保存模型供应商失败", error);
        throw error;
      }
    },
    [modelProviders, refreshCodingPlanEntitlements, saveProvider],
  );

  const handleDelete = useCallback(
    async (provider: ProviderSettingsFormProvider) => {
      await confirmAndDeleteModelProvider({
        provider,
        confirmDialog,
        intl,
        deleteProvider,
      });
    },
    [confirmDialog, deleteProvider, intl],
  );

  const handleOpenApiKeyUrl = useCallback(
    (url: string) => {
      const normalizedUrl = url.trim();
      if (!normalizedUrl) {
        return;
      }
      platform.openExternal(normalizedUrl);
    },
    [platform],
  );

  const handleCodingPlanLogin = useCallback(
    (
      presetId: BuiltinModelProviderId,
      providerId: OAuthProviderId,
      providerName: string,
      status: CodingPlanStatus,
      options?: CodingPlanLoginOptions,
    ) => {
      setPresetSubscriptionProviderId(presetId);
      setCodingPlanStatusSyncProviderId(presetId);
      logger.info("[ModelProviderSection] Request login and connect to Coding Plan via unified login", {
        presetId,
        providerId,
        providerName,
        status,
        forceOAuth: options?.forceOAuth === true,
      });
      if (activeOAuthProvider === providerId && options?.forceOAuth !== true) {
        void refreshProviderPanelAfterAuthChange({}).finally(() => {
          setPresetSubscriptionProviderId((current) => (current === presetId ? null : current));
          setCodingPlanStatusSyncProviderId((current) => (current === presetId ? null : current));
        });
        return;
      }
      return requestLoginEntry(providerId);
    },
    [activeOAuthProvider, refreshProviderPanelAfterAuthChange, requestLoginEntry],
  );

  const handleCodingPlanDisconnect = useCallback(
    async (presetId: BuiltinModelProviderId, providerId: OAuthProviderId, providerName: string) => {
      if (providerId !== BIGMODEL_PROVIDER_ID && providerId !== ZAI_PROVIDER_ID) {
        return;
      }

      setCodingPlanDisconnectProviderId(presetId);
      setCodingPlanStatusSyncProviderId(presetId);
      try {
        logger.info("[ModelProviderSection] Request to unbind Coding Plan provider", {
          presetId,
          providerId,
          providerName,
        });
        const nextProviderFamilyDomain = resolveLogoutProviderFamilyDomain({
          currentDomain: sharedSettings?.providerFamilyDomain,
        });
        await oauthService.logout(providerId);
        if (typeof platform.executeDesktopCommand === "function") {
          await platform.executeDesktopCommand(DesktopCommandIds.ClearCodingPlanWebviewStorage);
        }
        await updateSharedSettings({
          providerFamilyDomain: (nextProviderFamilyDomain ?? "") as never,
          providerFamilyDomainUpdatedAt: Date.now(),
          providerFamilyDomainMigrated: true,
        });
        await refreshCodingPlanPurchaseTokenState({ clearUserWhenLoggedOut: true });
        await refresh();
        refreshCodingPlanProducts();
      } catch (error) {
        logger.error("[ModelProviderSection] 解绑 Coding Plan provider 失败", {
          presetId,
          providerId,
          providerName,
          error,
        });
      } finally {
        setCodingPlanDisconnectProviderId((current) => (current === presetId ? null : current));
        setCodingPlanStatusSyncProviderId((current) => (current === presetId ? null : current));
      }
    },
    [
      oauthService,
      platform,
      updateSharedSettings,
      sharedSettings?.providerFamilyDomain,
      modelSelectionService,
      refresh,
      refreshCodingPlanEntitlements,
      refreshCodingPlanProducts,
      refreshCodingPlanPurchaseTokenState,
    ],
  );

  const persistProviderFamilyModeForNavItem = useCallback(
    async (item: (typeof navigationItems)[number]) => {
      if (item.type !== "preset" && item.type !== "codingPlan" && item.type !== "teamPlan") {
        return;
      }
      const familySpec = resolveModelProviderFamilySpecByProviderId(item.presetId);
      if (!familySpec) {
        return;
      }
      const selection = resolveConnectionSelectionForNavItem(item);
      if (!selection) return;
      const selectionUnchanged =
        JSON.stringify(connectionSelections[familySpec.id]) === JSON.stringify(selection);
      const modeUnchanged = sharedSettings?.providerFamilyDomain === familySpec.id;
      const selectedKeyUnchanged = selectionUnchanged;
      const planSyncAttemptKey =
        item.type === "codingPlan" || item.type === "teamPlan"
          ? resolveCodingPlanProviderSyncAttemptKey({
              activeOAuthProvider,
              oauthProviderId: item.oauthProviderId,
              providerId: item.presetId,
            })
          : null;
      if (modeUnchanged && selectedKeyUnchanged) {
        const isPlanItem = item.type === "codingPlan" || item.type === "teamPlan";
        const planSyncAttemptStatus = planSyncAttemptKey
          ? codingPlanStatusSyncAttemptsRef.current.get(planSyncAttemptKey)
          : undefined;
        if (
          isPlanItem &&
          shouldRetryUnchangedCodingPlanProviderSync({
            attemptKey: planSyncAttemptKey,
            attemptStatus: planSyncAttemptStatus,
            modeUnchanged,
            selectedKeyUnchanged,
          })
        ) {
          try {
            await syncCodingPlanProviderOnce(item, {
              userTransition: true,
              refreshPlanSnapshots: false,
            });
          } catch (error) {
            logger.warn("[ModelProviderSection] 重试同步 Coding Plan provider 失败", {
              providerId: item.presetId,
              error,
            });
          }
        }
        return;
      }
      setPendingConnectionSelections((current) => ({
        ...current,
        [familySpec.id]: selection,
      }));
      if (planSyncAttemptKey) {
        codingPlanStatusSyncAttemptsRef.current.set(planSyncAttemptKey, "inFlight");
      }
      try {
        await updateSharedSettings(
          {
            providerFamilyDomain: familySpec.id,
            providerFamilyDomainUpdatedAt: Date.now(),
            providerFamilyDomainMigrated: true,
            providerFamilyConnectionSelections: {
              ...sharedSettings?.providerFamilyConnectionSelections,
              [familySpec.id]: selection,
            },
          },
          {
            providerFamilyDomain: sharedSettings?.providerFamilyDomain,
            providerFamilyConnectionSelections: sharedSettings?.providerFamilyConnectionSelections,
            providerFamilyDomainUpdatedAt: sharedSettings?.providerFamilyDomainUpdatedAt ?? 0,
          },
        );
        if (item.type === "codingPlan" || item.type === "teamPlan") {
          await syncCodingPlanProviderOnce(item, {
            userTransition: true,
            refreshPlanSnapshots: false,
          });
        }
      } catch (error) {
        if (planSyncAttemptKey) {
          codingPlanStatusSyncAttemptsRef.current.set(planSyncAttemptKey, "failed");
        }
        logger.warn("[ModelProviderSection] 保存模型供应商连接方式失败", {
          familyId: familySpec.id,
          error,
        });
        setPendingConnectionSelections((current) =>
          clearPendingProviderFamilyConnectionSelection(current, familySpec.id, selection),
        );
      }
    },
    [
      activeOAuthProvider,
      connectionSelections,
      sharedSettings,
      syncCodingPlanProviderOnce,
      updateSharedSettings,
    ],
  );

  const handleSelectNavItem = useCallback(
    (item: (typeof navigationItems)[number]) => {
      setInvalidProviderTarget(false);
      setSelectedNodeKey(resolveModelProviderSideSelectionKey(item));
      setTemplatePickerOpen(false);
      void persistProviderFamilyModeForNavItem(item);
    },
    [persistProviderFamilyModeForNavItem],
  );

  const handleCreateProvider = useCallback(
    async (input: { templateId?: string; providerName?: string }) => {
      setCreatingProvider(true);
      try {
        const created = await createPersonalProvider({ ...input, locale });
        setPendingCreatedProviderId(created.providerId);
        setSelectedNodeKey(createCustomProviderNodeKey(created.providerId));
        setTemplatePickerOpen(false);
      } catch (error) {
        setPendingCreatedProviderId(null);
        throw error;
      } finally {
        setCreatingProvider(false);
      }
    },
    [createPersonalProvider, locale],
  );

  const marketingRequest = useStore(marketingNavigation, (state) => state.request);
  useEffect(() => {
    if (marketingRequest?.target.page !== "settings" || !marketingRequest.target.provider_id)
      return;
    if (
      loading ||
      modelProvidersRefreshing ||
      sharedSettingsLoading ||
      navigationItems.some((item) => item.type === "codingPlanLoading")
    )
      return;
    const providerId = marketingRequest.target.provider_id;
    const item = navigationItems.find((item) =>
      item.type === "custom"
        ?
          item.provider.providerId === providerId
        : "presetId" in item &&
          item.presetId === providerId &&
          (!isStartPlanModelProviderId(providerId) || item.type === "codingPlan"),
    );
    if (!item) {
      finishMarketingNavigation(marketingRequest.id, new Error("marketing_provider_unavailable"));
      return;
    }
    const key = resolveModelProviderSideSelectionKey(item);
    if (selectedNodeKey !== key) {
      setSelectedNodeKey(key);
    } else if (selectedNavItem) {
      finishMarketingNavigation(marketingRequest.id);
    }
  }, [
    marketingRequest,
    loading,
    modelProvidersRefreshing,
    sharedSettingsLoading,
    navigationItems,
    selectedNodeKey,
    selectedNavItem,
  ]);

  const handleReorderProviderIds = useCallback(
    async (orderedGroupProviderIds: string[]) => {
      const groupProviderIdSet = new Set(orderedGroupProviderIds);
      const currentProviderIds = sortModelProvidersForDisplay(modelProviders, displayOrder).map(
        (provider) => provider.providerId,
      );
      const insertionIndex = currentProviderIds.findIndex((providerId) =>
        groupProviderIdSet.has(providerId),
      );
      if (insertionIndex < 0) {
        return;
      }
      const nextProviderIds = currentProviderIds.filter(
        (providerId) => !groupProviderIdSet.has(providerId),
      );
      nextProviderIds.splice(insertionIndex, 0, ...orderedGroupProviderIds);
      await saveDisplayOrder({
        providerIds: nextProviderIds,
      });
    },
    [displayOrder, modelProviders, saveDisplayOrder],
  );

  const handleTestModel = useCallback(
    async (providerId: string, modelId: string): Promise<ModelConnectivityResult> => {
      return testModelConnectivity(providerId, modelId);
    },
    [testModelConnectivity],
  );

  const presetLoading = loading || modelProvidersRefreshing;
  const customLoading = loading || modelProvidersRefreshing;

  if (loadError) {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-ui-base">
        <p className="text-destructive">{loadError.message}</p>
        <Button type="button" variant="outline" onClick={reload}>
          {intl.formatMessage({ id: "common.retry" })}
        </Button>
      </div>
    );
  }

  return (
    <ModelProviderSectionLayout
      description={intl.formatMessage({ id: "settings.modelProviderDescription" })}
      refreshLabel={intl.formatMessage({ id: "settings.modelProvider.refresh" })}
      loadingLabel={intl.formatMessage({ id: "common.loading" })}
      presetLoading={presetLoading}
      customLoading={customLoading}
      onRefresh={() => {
        void refreshModelProviderSection({
          refresh,
          refreshTeamPlanProducts: refreshAuthenticatedEnterpriseProducts,
        });
        refreshCodingPlanEntitlements();
      }}
      addProviderLabel={intl.formatMessage({ id: "settings.modelProvider.addProviderAction" })}
      onAddProvider={() => setTemplatePickerOpen(true)}
      navigationGroups={navigationGroups}
      selectedNodeKey={selectedNodeKey}
      onSelectNavItem={handleSelectNavItem}
      onReorderProviderIds={handleReorderProviderIds}
      reorderableProviderIds={reorderableProviderIds}
    >
      {(invalidProviderTarget || navigationUnavailable) && !templatePickerOpen ? (
        <p role="alert" className="mb-3 text-ui-base text-destructive">
          {intl.formatMessage({
            id: invalidProviderTarget
              ? "settings.modelProvider.navigationUnavailable"
              : "settings.modelProvider.connectionUnavailable",
          })}
        </p>
      ) : null}
      {templatePickerOpen ? (
        <ProviderTemplatePicker
          templates={providerTemplates}
          creating={creatingProvider}
          onBack={() => setTemplatePickerOpen(false)}
          onCreateFromTemplate={(templateId) => {
            return handleCreateProvider({ templateId });
          }}
          onCreateCustom={(label) => {
            return handleCreateProvider({ providerName: label });
          }}
        />
      ) : (
        <ModelProviderSectionDetail
          connectionSelections={effectiveConnectionSelections}
          providerSettingsView={providerSettingsView}
          selectedNavItem={selectedNavItem}
          navigationItems={navigationItems}
          connectionSettingsFailed={familyConnectionSettingsFailed}
          startPlanSubscriptionCount={(() => {
            const providerId =
              selectedNavItem && "presetId" in selectedNavItem ? selectedNavItem.presetId : null;
            const family = providerId
              ? resolveModelProviderFamilySpecByProviderId(providerId)
              : null;
            const entitlement = family ? codingPlanEntitlements[family.startPlanProviderId] : null;
            return entitlement?.error
              ? 0
              : (entitlement?.snapshot?.subscription?.details.length ?? 0);
          })()}
          presetLoading={presetLoading}
          codingPlanAuthError={oauthError}
          codingPlanPurchaseTokenAuthenticatedByProviderId={
            codingPlanPurchaseTokenAuthenticatedByProviderId
          }
          presetSubscriptionProviderId={presetSubscriptionProviderId}
          codingPlanStatusSyncProviderId={codingPlanStatusSyncProviderId}
          codingPlanDisconnectProviderId={codingPlanDisconnectProviderId}
          onSave={handleSave}
          onAddPersonalModel={addPersonalModel}
          onSavePersonalModelDraft={savePersonalModelDraft}
          onSetPersonalModelEnabled={setPersonalModelEnabled}
          onDeletePersonalModel={deletePersonalModel}
          onDelete={handleDelete}
          onReorderProviderModels={reorderProviderModels}
          onTestModel={handleTestModel}
          onCodingPlanLogin={handleCodingPlanLogin}
          onRetryCodingPlan={() => {
            logger.info("[ModelProviderSection] Retry fetching plan status");
            return refresh().then(() =>
              refreshCodingPlanEntitlements({ force: true, reason: "manual" }),
            );
          }}
          onCodingPlanDisconnect={handleCodingPlanDisconnect}
          onOpenApiKeyUrl={handleOpenApiKeyUrl}
          onSelectNavItem={handleSelectNavItem}
          onOpenBigModelRegistration={() => {
            setOAuthError(null);
            setPresetSubscriptionProviderId((current) =>
              current === BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan ? null : current,
            );
            platform.openExternal(BIGMODEL_REGISTRATION_URL);
          }}
          onCodingPlanPurchaseComplete={async () => {
            await refreshProviderPanelAfterAuthChange({ refreshReason: "purchase" });
          }}
        />
      )}
    </ModelProviderSectionLayout>
  );
}
