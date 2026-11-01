import { withPluginTelemetry } from "@origin-ai/cf-services";
import { usePlatform } from "@/hooks/usePlatform.js";
import { reportAppTelemetryEvent } from "@/lib/appTelemetry.js";

import { PluginAddMenu } from "@/conversation-workspace-target/PluginAddMenu.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { useOptionalTabStore } from "@/store/TabStoreProvider.js";
import { isWorkspaceTab } from "@/store/tabStore.js";
import { marketingNavigation, finishMarketingNavigation } from "@/lib/marketingNavigation.js";
import { ArrowLeft, RefreshCw, Store } from "lucide-react";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { Button } from "@/components/ui/button.js";
import { toast } from "@/components/ui/toast.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { useServices } from "@/hooks/useServices.js";
import { usePluginStoreOrder } from "@/hooks/usePluginStoreOrder.js";
import { useScopedPluginManagementStore } from "@/store/pluginManagementStore.js";
import { useMarketPluginUi } from "@/plugin-ui/index.js";
import { PluginsSection } from "@/settings/PluginsSection.js";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog.js";
import { resolvePluginUiSurfaceTitle } from "@/plugin-ui/index.js";
import type { CreateTaskRequest } from "@/app-shell/types.js";
import { invalidateDeferredDraftSessionForSkillChange } from "@/lib/cfDraftSkillInvalidation.js";
import { refreshSharedSkillStoreForWorkspace } from "@/lib/skillStoreRefresh.js";
import {
  PluginDetailRow,
  PluginHookDetails,
  PluginWarningList,
} from "@/settings/InstalledPluginManagement.js";
import { AddMarketplaceSourceDialog } from "@/settings/AddMarketplaceSourceDialog.js";
import { PluginStoreListView, type PluginStoreSegment } from "@/settings/PluginStoreListView.js";
import {
  PluginStoreAdvancedSection,
  PluginStoreDetailView,
} from "@/settings/PluginStoreDetailView.js";
import { PluginStoreSourcesDialog } from "@/settings/PluginStoreSourcesDialog.js";
import type { PluginStoreActions } from "@/settings/PluginStoreCard.js";
import {
  buildStoreItems,
  canUpdatePluginItem,
  isPluginUpdatePending,
  resolveItemDisplayName,
  resolvePluginDisplayName,
  type StorePluginItem,
} from "@/settings/pluginStoreListing.js";
import { CF_OFFICIAL_PLUGIN_MARKETPLACE_ID } from "@origin-ai/cf-shared";
import { PluginUninstallConfirmDialog } from "@/settings/PluginUninstallConfirmDialog.js";
import { usePluginUninstall } from "@/settings/usePluginUninstall.js";
import { claimMarketplaceAutoRefresh } from "@/settings/officialMarketplaceAutoRefresh.js";
import { consumePluginStoreOpenTarget } from "@/lib/pluginStoreNavigation.js";
import { SettingsBreadcrumbReporter } from "@/settings/SettingsHeaderBreadcrumb.js";
import {
  buildPluginStoreTryMention,
  buildPluginStoreTryPrompt,
} from "@/settings/pluginStoreTryPrompt.js";

interface PluginStorePageProps {
  isDesktop?: boolean;
  isMacDesktop?: boolean;
  isWindowsDesktop?: boolean;
  isWebRemoteControl?: boolean;
  workspacePath?: string | null;
  workspaceIdentity?: string;
  onCreateTask?: (request?: CreateTaskRequest) => void;
  sessionId?: string | null;
  remoteSessionId?: string | null;
  embedded?: boolean;
  onBack?: () => void;
}

type PluginStoreView = "store" | "detail" | "manage";

export function PluginStorePage({
  isDesktop = false,
  isMacDesktop = false,
  isWindowsDesktop = false,
  isWebRemoteControl = false,
  workspacePath,
  workspaceIdentity,
  onCreateTask,
  sessionId,
  remoteSessionId,
  embedded = false,
  onBack,
}: PluginStorePageProps) {
  const platform = usePlatform();
  const { intl, locale } = useCfIntl();
  const { order: storeOrder, refresh: refreshStoreOrder } = usePluginStoreOrder();
  const { pluginManagementService, skillsService } = useServices();
  const usePluginManagementStore = useScopedPluginManagementStore(pluginManagementService);
  const pluginUi = useMarketPluginUi({
    workspacePath,
    workspaceIdentity,
    sessionId,
    remoteSessionId,
  });
  const [managementScope, setManagementScope] = useState("user");
  const plugins = usePluginManagementStore((state) => state.plugins);
  const pluginDiagnostics = usePluginManagementStore((state) => state.diagnostics);
  const marketplaces = usePluginManagementStore((state) => state.marketplaces);
  const marketplaceAvailabilityKnown = usePluginManagementStore(
    (state) => state.marketplaceAvailabilityKnown,
  );
  const availablePlugins = usePluginManagementStore((state) => state.availablePlugins);
  const installedPlugins = usePluginManagementStore((state) => state.installedPlugins);
  const restorableBuiltins = usePluginManagementStore((state) => state.restorableBuiltins);
  const loading = usePluginManagementStore((state) => state.loading);
  const loadedWorkspacePath = usePluginManagementStore((state) => state.workspacePath);
  const loadedWorkspaceIdentity = usePluginManagementStore((state) => state.workspaceIdentity);
  const error = usePluginManagementStore((state) => state.error);
  const activeOperations = usePluginManagementStore((state) => state.activeOperations);
  const describeCache = usePluginManagementStore((state) => state.describeCache);
  const initialize = usePluginManagementStore((state) => state.initialize);
  const updateMarketplace = usePluginManagementStore((state) => state.updateMarketplace);
  const addMarketplace = usePluginManagementStore((state) => state.addMarketplace);
  const removeMarketplace = usePluginManagementStore((state) => state.removeMarketplace);
  const installPlugin = usePluginManagementStore((state) => state.installPlugin);
  const describePlugin = usePluginManagementStore((state) => state.describePlugin);
  const updatePlugin = usePluginManagementStore((state) => state.updatePlugin);
  const restoreBuiltin = usePluginManagementStore((state) => state.restoreBuiltin);
  const setEnabled = usePluginManagementStore((state) => state.setEnabled);
  const togglingPluginId = usePluginManagementStore((state) => state.togglingPluginId);

  const [view, setView] = useState<PluginStoreView>("store");
  const operationService = useMemo(() => {
    const telemetry = {
      entry: embedded
        ? ("side_pane_market" as const)
        : view === "detail"
          ? ("store_detail" as const)
          : ("store_list" as const),
      client_kind: isWebRemoteControl ? ("mobile" as const) : ("desktop" as const),
    };
    return withPluginTelemetry(pluginManagementService, telemetry);
  }, [pluginManagementService, embedded, isWebRemoteControl, view]);

  const [detailPluginId, setDetailPluginId] = useState<string | null>(null);
  const [segment, setSegment] = useState<PluginStoreSegment>("public");
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [addSourceOpen, setAddSourceOpen] = useState(false);
  const [addMarketplaceError, setAddMarketplaceError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const storeScrollTopRef = useRef(0);
  const [initialNavigationTarget] = useState(() =>
    embedded ? null : consumePluginStoreOpenTarget(),
  );
  const initialNavigationTargetRef = useRef(initialNavigationTarget);
  useEffect(() => {
    if (initialNavigationTarget?.intent === "add-marketplace") setAddSourceOpen(true);
  }, [initialNavigationTarget]);

  const normalizedWorkspaceIdentity = workspaceIdentity?.trim() || null;

  useEffect(() => {
    if (!workspacePath) {
      return;
    }
    void initialize({
      workspacePath,
      workspaceIdentity,
      pluginService: pluginManagementService,
    });
  }, [initialize, pluginManagementService, workspaceIdentity, workspacePath]);

  useEffect(() => {
    const official = marketplaces.find((item) => item.id === CF_OFFICIAL_PLUGIN_MARKETPLACE_ID);
    if (
      official &&
      claimMarketplaceAutoRefresh(CF_OFFICIAL_PLUGIN_MARKETPLACE_ID, official.lastUpdated)
    ) {
      void updateMarketplace(
        CF_OFFICIAL_PLUGIN_MARKETPLACE_ID,
        withPluginTelemetry(pluginManagementService, {
          trigger: "automatic",
          client_kind: isWebRemoteControl ? "mobile" : "desktop",
        }),
      );
    }
  }, [marketplaces, isWebRemoteControl, pluginManagementService, updateMarketplace]);

  const items = useMemo(
    () =>
      buildStoreItems({
        marketplaces,
        marketplaceAvailabilityKnown,
        availablePlugins,
        installedPlugins,
        plugins,
        restorableBuiltins,
      }),
    [
      availablePlugins,
      installedPlugins,
      marketplaceAvailabilityKnown,
      marketplaces,
      plugins,
      restorableBuiltins,
    ],
  );
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const detailItem = detailPluginId ? (itemById.get(detailPluginId) ?? null) : null;
  const marketingRequest = useStore(marketingNavigation, (state) => state.request);
  const isMarketingDestinationVisible = useOptionalTabStore((state) => {
    const tab = state.tabs.find((tab) => tab.id === state.activeTabId);
    return Boolean(
      tab &&
      isWorkspaceTab(tab) &&
      (tab.workspaceIdentity?.trim() || tab.workspacePath) ===
        (workspaceIdentity?.trim() || workspacePath),
    );
  });
  useEffect(() => {
    const root = rootRef.current;
    if (!root || view === "manage" || typeof IntersectionObserver === "undefined") return;
    let visible = false;
    const observer = new IntersectionObserver(([entry]) => {
      const next = Boolean(entry?.isIntersecting);
      if (next && !visible) {
        void reportAppTelemetryEvent(
          platform,
          {
            elementName: "plugin_discovery",
            eventRegion: "app",
            eventType: "view",
            eventExtraDetail: {
              schema_version: "1",
              action: view === "detail" ? "detail_view" : "store_view",
              entry: embedded
                ? "side_pane_market"
                : view === "detail"
                  ? "store_detail"
                  : "store_list",
              client_kind: isWebRemoteControl ? "mobile" : "desktop",
              ...(view === "detail" && detailPluginId ? { plugin_id: detailPluginId } : {}),
            },
          },
          "plugin-discovery",
        );
      }
      visible = next;
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [platform, view, detailPluginId, embedded, isWebRemoteControl]);
  useEffect(() => {
    if (embedded || marketingRequest?.target.page !== "plugin_marketplace") return;
    if (!isMarketingDestinationVisible) return;
    const pluginId = marketingRequest.target.plugin_id;
    if (!workspacePath) {
      finishMarketingNavigation(marketingRequest.id, new Error("marketing_navigation_unavailable"));
      return;
    }
    if (
      loading ||
      loadedWorkspacePath !== workspacePath ||
      loadedWorkspaceIdentity !== normalizedWorkspaceIdentity
    )
      return;
    if (error || (pluginId && !itemById.has(pluginId))) {
      finishMarketingNavigation(marketingRequest.id, new Error("marketing_plugin_unavailable"));
    } else if (pluginId ? view === "detail" && detailPluginId === pluginId : view === "store") {
      finishMarketingNavigation(marketingRequest.id);
    } else {
      setDetailPluginId(pluginId ?? null);
      setView(pluginId ? "detail" : "store");
      setQuery("");
    }
  }, [
    embedded,
    marketingRequest,
    isMarketingDestinationVisible,
    workspacePath,
    loading,
    loadedWorkspacePath,
    loadedWorkspaceIdentity,
    normalizedWorkspaceIdentity,
    error,
    itemById,
    view,
    detailPluginId,
  ]);
  const detailPluginInfo = detailItem?.info;
  const detailPluginWarnings = detailPluginInfo
    ? pluginDiagnostics.filter(
        (diagnostic) =>
          diagnostic.pluginId === detailPluginInfo.id && diagnostic.severity === "warning",
      )
    : [];

  useEffect(() => {
    if (view !== "detail" || !detailItem || detailItem.info) return;
    void describePlugin(
      detailItem.id,
      detailItem.name,
      detailItem.marketplace,
      pluginManagementService,
    );
  }, [describePlugin, detailItem, pluginManagementService, view]);

  useEffect(() => {
    if (view === "detail" && detailPluginId && !itemById.has(detailPluginId)) {
      setView("store");
      setDetailPluginId(null);
    }
  }, [detailPluginId, itemById, view]);

  const scrollContainer = (): HTMLElement | null => rootRef.current?.closest("main") ?? null;

  const openDetail = useCallback((pluginId: string) => {
    storeScrollTopRef.current =
      (rootRef.current?.closest("main") as HTMLElement | null)?.scrollTop ?? 0;
    setDetailPluginId(pluginId);
    setView("detail");
    requestAnimationFrame(() => {
      const main = rootRef.current?.closest("main");
      if (main) main.scrollTop = 0;
    });
  }, []);

  useEffect(() => {
    const target = initialNavigationTargetRef.current;
    if (
      !target?.pluginId ||
      loading ||
      loadedWorkspacePath !== workspacePath ||
      loadedWorkspaceIdentity !== normalizedWorkspaceIdentity
    ) {
      return;
    }
    initialNavigationTargetRef.current = null;
    if (itemById.has(target.pluginId)) {
      openDetail(target.pluginId);
      return;
    }
    setView("store");
    setQuery(target.pluginId);
  }, [
    itemById,
    loadedWorkspaceIdentity,
    loadedWorkspacePath,
    loading,
    normalizedWorkspaceIdentity,
    openDetail,
    workspacePath,
  ]);

  const backToStore = useCallback(() => {
    setView("store");
    setDetailPluginId(null);
    requestAnimationFrame(() => {
      const main = scrollContainer();
      if (main) main.scrollTop = storeScrollTopRef.current;
    });
  }, []);

  const handleRefresh = async () => {
    void refreshStoreOrder(true);
    setRefreshing(true);
    try {
      await handleCheckForUpdates();
    } finally {
      setRefreshing(false);
    }
  };

  const refreshAfterPluginChange = useCallback(async () => {
    await invalidateDeferredDraftSessionForSkillChange({
      workspacePath,
      workspaceIdentity: normalizedWorkspaceIdentity ?? undefined,
      reason: "settings-plugin-enabled",
    });
    await refreshSharedSkillStoreForWorkspace({
      workspacePath,
      workspaceIdentity: normalizedWorkspaceIdentity,
      skillsService,
    });
  }, [normalizedWorkspaceIdentity, skillsService, workspacePath]);

  const uninstall = usePluginUninstall({
    store: usePluginManagementStore,
    pluginService: operationService,
    installedPlugins,
    plugins,
    activeOperations,
    onAfterUninstall: async () => {
      await refreshAfterPluginChange();
    },
  });

  const handleInstall = useCallback(
    async (item: StorePluginItem) => {
      const succeeded = item.restorable
        ? await restoreBuiltin(item.id, operationService)
        : await installPlugin(item.name, item.marketplace, operationService, "user");
      if (!succeeded) return;
      await refreshAfterPluginChange();
    },
    [installPlugin, operationService, refreshAfterPluginChange, restoreBuiltin],
  );

  const handleUpdatePlugin = useCallback(
    async (pluginId: string) => {
      await updatePlugin(pluginId, operationService);
      if (usePluginManagementStore.getState().error) {
        return;
      }
      await refreshAfterPluginChange();
    },
    [operationService, refreshAfterPluginChange, updatePlugin],
  );

  const handleCheckForUpdates = useCallback(async () => {
    const succeeded = await updateMarketplace(null, operationService);
    if (!succeeded) {
      const message = usePluginManagementStore.getState().error;
      if (message) {
        toast(message);
      }
      return;
    }
    const pendingCount = usePluginManagementStore
      .getState()
      .installedPlugins.filter((item) => isPluginUpdatePending(item.updateStatus)).length;
    if (pendingCount > 0) {
      toast(
        intl.formatMessage(
          { id: "settings.plugins.checkForUpdates.found" },
          { count: String(pendingCount) },
        ),
      );
      return;
    }
    toast(intl.formatMessage({ id: "settings.plugins.checkForUpdates.none" }));
  }, [intl, operationService, updateMarketplace]);

  const handleAddMarketplace = useCallback(
    async (source: string) => {
      const succeeded = await addMarketplace(source, operationService);
      setAddMarketplaceError(
        succeeded ? null : (usePluginManagementStore.getState().error ?? null),
      );
      if (succeeded) setSegment("personal");
      return succeeded;
    },
    [addMarketplace, operationService],
  );

  const handleUsePrompt = useCallback(
    (item: StorePluginItem, prompt: string) => {
      if (!item.installed) {
        void handleInstall(item);
        return;
      }
      if (!workspacePath || !onCreateTask) {
        return;
      }
      onCreateTask({
        initialPrompt: buildPluginStoreTryPrompt({ item, locale, prompt }),
        initialPromptMention: buildPluginStoreTryMention({ item, locale }),
      });
    },
    [handleInstall, locale, onCreateTask, workspacePath],
  );

  const actions: PluginStoreActions = useMemo(
    () => ({
      onOpenDetail: openDetail,
      onOpenUi: embedded
        ? (item) =>
            void pluginUi.open(
              item.id,
              item.info?.enabled
                ? undefined
                : () => setEnabled(item.id, true, operationService, "workspace"),
            )
        : undefined,
      onSetEnabled: (pluginId, enabled) => {
        void setEnabled(pluginId, enabled, operationService, "workspace");
      },
      onInstall: (item) => void handleInstall(item),
      onUninstall: uninstall.requestUninstall,
      onUpdate: (pluginId) => void handleUpdatePlugin(pluginId),
      activeOperations,
      togglingPluginId,
    }),
    [
      handleInstall,
      handleUpdatePlugin,
      openDetail,
      activeOperations,
      uninstall.requestUninstall,
      pluginUi,
      operationService,
      setEnabled,
      togglingPluginId,
      embedded,
    ],
  );

  if (!workspacePath) {
    return (
      <div className="rounded-lg border border-border bg-card px-3 py-2 text-ui-base text-foreground-subtle">
        {intl.formatMessage({ id: "settings.plugins.noWorkspace" })}
      </div>
    );
  }

  const detailUpdatePending = canUpdatePluginItem(detailItem);

  return (
    <div
      ref={rootRef}
      className="@container/plugin-store space-y-5"
      data-testid="plugin-store-root"
      data-view={view}
    >
      {!embedded ? (
        <SettingsBreadcrumbReporter
          items={
            view === "detail" && detailItem
              ? [{ label: resolveItemDisplayName(detailItem, locale) }]
              : []
          }
          onSectionSelect={backToStore}
        />
      ) : null}
      {view === "detail" ? (
        <Button variant="ghost" data-testid="plugin-store-detail-back" onClick={backToStore}>
          {intl.formatMessage({ id: "settings.plugins.store.browseAll" })}
        </Button>
      ) : null}
      {view === "store" ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {onBack ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={intl.formatMessage({ id: "project.back" })}
                onClick={onBack}
              >
                <ArrowLeft className="size-4" aria-hidden="true" />
              </Button>
            ) : null}
            <h1
              data-testid="plugin-store-title"
              className="text-ui-xl font-semibold tracking-tight text-foreground"
            >
              {intl.formatMessage({ id: "workspace.openPluginsSettings" })}
            </h1>
          </div>
          {}
          <div className="flex flex-wrap items-center gap-2">
            <ControlHintTooltip
              title={
                refreshing
                  ? intl.formatMessage({ id: "settings.plugins.refreshing" })
                  : intl.formatMessage({ id: "settings.plugins.refresh" })
              }
            >
              <Button
                type="button"
                data-testid="plugin-store-refresh"
                variant="secondary"
                size="icon-lg"
                aria-label={
                  refreshing
                    ? intl.formatMessage({ id: "settings.plugins.refreshing" })
                    : intl.formatMessage({ id: "settings.plugins.refresh" })
                }
                onClick={() => void handleRefresh()}
                disabled={refreshing}
              >
                <RefreshCw
                  className={refreshing ? "size-3.5 animate-spin" : "size-3.5"}
                  aria-hidden="true"
                />
              </Button>
            </ControlHintTooltip>
            <ControlHintTooltip
              title={intl.formatMessage({ id: "settings.plugins.store.sources.title" })}
            >
              <Button
                type="button"
                data-testid="plugin-store-sources-open"
                variant="secondary"
                size="icon-lg"
                aria-label={intl.formatMessage({ id: "settings.plugins.store.sources.title" })}
                onClick={() => setSourcesOpen(true)}
              >
                <Store className="size-3.5" aria-hidden="true" />
              </Button>
            </ControlHintTooltip>
            <PluginAddMenu
              testId="plugin-store-create"
              variant="secondary"
              size="lg"
              isWebRemoteControl={isWebRemoteControl}
              onCreateTask={onCreateTask}
              onAddMarketplace={() => {
                setAddMarketplaceError(null);
                setAddSourceOpen(true);
              }}
            />
            <Button
              type="button"
              variant="secondary"
              size="lg"
              className="font-medium"
              data-testid="plugin-store-manage-open"
              onClick={() => setView("manage")}
            >
              {intl.formatMessage({ id: "settings.plugins.store.manageInstalled" })}
            </Button>
          </div>
        </div>
      ) : null}

      {error && !addSourceOpen ? (
        <div
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-ui-base text-destructive"
          data-testid="plugin-store-error"
        >
          {error}
        </div>
      ) : null}

      {view === "manage" ? (
        <div data-testid="plugin-store-manage" className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-ui-xl font-semibold">
              {intl.formatMessage({ id: "settings.plugins.store.manageInstalled" })}
            </h1>
            <Button variant="outline" data-testid="plugin-store-browse-all" onClick={backToStore}>
              {intl.formatMessage({ id: "settings.plugins.store.browseAll" })}
            </Button>
          </div>
          <PluginsSection
            mode="market"
            isDesktop={isDesktop}
            isMacDesktop={isMacDesktop}
            isWindowsDesktop={isWindowsDesktop}
            workspacePath={workspacePath}
            workspaceIdentity={workspaceIdentity}
            isWebRemoteControl={isWebRemoteControl}
            initialScopeKey={managementScope}
            onScopeChange={setManagementScope}
            onCreateTask={onCreateTask}
            onOpenPluginStore={(_scope, intent) => {
              backToStore();
              if (intent === "add-marketplace") setAddSourceOpen(true);
            }}
            onOpenUi={
              embedded
                ? (item, target, enable) => {
                    if (
                      (target?.workspaceIdentity?.trim() || target?.workspacePath) !==
                      (workspaceIdentity?.trim() || workspacePath)
                    ) {
                      toast(intl.formatMessage({ id: "settings.plugins.store.ui.needsSession" }));
                      return;
                    }
                    void pluginUi.open(item.id, enable);
                  }
                : undefined
            }
          />
        </div>
      ) : view === "detail" && detailItem ? (
        <PluginStoreDetailView
          item={detailItem}
          actions={actions}
          describeEntry={describeCache[detailItem.id]}
          onRetryDescribe={() =>
            void describePlugin(
              detailItem.id,
              detailItem.name,
              detailItem.marketplace,
              operationService,
              true,
            )
          }
          onUsePrompt={handleUsePrompt}
          advanced={
            detailItem.info ? (
              <div className="space-y-4">
                {detailUpdatePending ? (
                  <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-ui-base font-medium text-foreground">
                        {detailItem.installedMeta?.updateStatus === "update-available"
                          ? intl.formatMessage(
                              { id: "settings.plugins.detail.updateAvailable" },
                              { version: detailItem.installedMeta?.latestVersion ?? "" },
                            )
                          : intl.formatMessage({ id: "settings.plugins.detail.versionChanged" })}
                      </p>
                      <p className="text-ui-xs text-foreground-subtle">
                        {intl.formatMessage({
                          id: "settings.plugins.detail.updateNewSessionsNote",
                        })}
                      </p>
                    </div>
                    <Button
                      type="button"
                      data-testid="plugin-store-detail-update"
                      variant="outline"
                      size="sm"
                      disabled={activeOperations.some(
                        (operation) => operation.id === `plugin:update:${detailItem.id}`,
                      )}
                      onClick={() => void handleUpdatePlugin(detailItem.id)}
                    >
                      {intl.formatMessage({ id: "settings.plugins.detail.update" })}
                    </Button>
                  </div>
                ) : null}
                <PluginStoreAdvancedSection>
                  {detailPluginWarnings.length > 0 ? (
                    <div>
                      <div className="mb-2 text-ui-xs font-medium text-foreground">
                        {intl.formatMessage({ id: "settings.plugins.detail.warnings" })}
                      </div>
                      <PluginWarningList warnings={detailPluginWarnings} />
                    </div>
                  ) : null}
                  <PluginDetailRow
                    label={intl.formatMessage({ id: "settings.plugins.detail.rootPath" })}
                    value={detailItem.info.rootPath}
                  />
                  {(detailItem.info.hookDetails ?? []).length > 0 ? (
                    <PluginHookDetails hooks={detailItem.info.hookDetails ?? []} />
                  ) : null}
                </PluginStoreAdvancedSection>
              </div>
            ) : undefined
          }
        />
      ) : null}
      <div hidden={view !== "store"}>
        <PluginStoreListView
          order={storeOrder}
          items={items}
          marketplaces={marketplaces}
          actions={actions}
          loading={
            loading ||
            activeOperations.some((operation) => operation.id.startsWith("marketplace:update:"))
          }
          query={query}
          onQueryChange={setQuery}
          onSearchSubmit={() => {
            if (!query.trim()) return;
            void reportAppTelemetryEvent(
              platform,
              {
                elementName: "plugin_discovery",
                eventRegion: "app",
                eventType: "view",
                eventExtraDetail: {
                  schema_version: "1",
                  action: "search",
                  entry: embedded ? "side_pane_market" : "store_list",
                  client_kind: isWebRemoteControl ? "mobile" : "desktop",
                },
              },
              "plugin-discovery",
            );
          }}
          segment={segment}
          onSegmentChange={setSegment}
        />
      </div>

      <Dialog
        open={pluginUi.surfaces.length > 1}
        onOpenChange={(open) => {
          if (!open) pluginUi.closeSelection();
        }}
      >
        <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
          <DialogTitle>
            {intl.formatMessage({ id: "settings.plugins.store.ui.chooseSurface" })}
          </DialogTitle>
          {pluginUi.surfaces.map((surface) => (
            <Button
              key={surface.id}
              variant="outline"
              onClick={() => pluginUi.selectSurface(surface)}
            >
              {resolvePluginUiSurfaceTitle(surface.title, locale)}
            </Button>
          ))}
        </DialogContent>
      </Dialog>

      <PluginUninstallConfirmDialog
        open={uninstall.pendingPlugin !== null}
        pluginName={
          uninstall.pendingPlugin
            ? resolvePluginDisplayName(
                itemById.get(uninstall.pendingPlugin.id) ?? {
                  name: uninstall.pendingPlugin.name,
                },
                locale,
              )
            : ""
        }
        pending={uninstall.uninstalling}
        onCancel={uninstall.cancelUninstall}
        onConfirm={() => void uninstall.confirmUninstall()}
      />
      <PluginStoreSourcesDialog
        open={sourcesOpen}
        onOpenChange={setSourcesOpen}
        marketplaces={marketplaces}
        onUpdateMarketplace={(marketplace) => void updateMarketplace(marketplace, operationService)}
        onRemoveMarketplace={(marketplace) => void removeMarketplace(marketplace, operationService)}
        activeOperations={activeOperations}
      />
      <AddMarketplaceSourceDialog
        open={addSourceOpen}
        onOpenChange={setAddSourceOpen}
        onAddMarketplace={handleAddMarketplace}
        activeOperations={activeOperations}
        error={addMarketplaceError}
      />
    </div>
  );
}
