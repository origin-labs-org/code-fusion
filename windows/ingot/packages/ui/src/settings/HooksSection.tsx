import { useConfigWorkspaceTargets } from "@/workspace-config-catalog/index.js";
import { SettingsUserScopeProvider } from "@/settings/SettingsMachine.js";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import type { Hook, HookConfig, CfInstalledPluginSummary, CfPluginInfo } from "@origin-ai/cf-shared";
import type { IHooksService } from "@origin-ai/cf-services";
import { Button } from "@/components/ui/button.js";
import { toast } from "@/components/ui/toast.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { useServices } from "@/hooks/useServices.js";
import { useConfigWorkspaceServicesResolution as useWorkspaceServicesResolution } from "@/workspace-config-catalog/index.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { invalidateDeferredDraftSessionForRuntimeChange } from "@/lib/cfDraftSkillInvalidation.js";
import { useHooksStore } from "@/store/hooksStore.js";
import { usePluginManagementStore } from "@/store/pluginManagementStore.js";
import { HookForm } from "./HookForm.js";
import { SettingsBreadcrumbReporter } from "@/settings/SettingsHeaderBreadcrumb.js";
import { SettingsSearchInput } from "@/settings/SettingsSearchInput.js";
import { SettingsResourceHeaderActions } from "@/settings/SettingsResourceHeaderActions.js";
import { getWorkspaceKey } from "@/lib/workspaceKey.js";
import { HooksList, type HookScope, type PluginHookRow } from "./HooksList.js";
import { useWorkspaceHookInlineTrust } from "./useWorkspaceHookInlineTrust.js";
import { useWorkspaceHookReviewStore } from "@/store/workspaceHookReviewStore.js";
import { PluginScopeMenu, getPluginWorkspaceKey } from "@/settings/PluginScopeMenu.js";
import { PluginLoadingState, PluginSearchEmptyState } from "@/settings/PluginInstallEmptyState.js";
import {
  resolvePluginDisplayName,
  resolveUniquePluginListingByName,
} from "@/settings/pluginStoreListing.js";
import {
  shouldShowWorkspaceHookTrustNotice,
  WorkspaceHookTrustNotice,
} from "@/settings/WorkspaceHookTrustNotice.js";

interface HooksSectionProps {
  workspacePath?: string | null;
  workspaceIdentity?: string;
  settingsSourceServerId?: string | null;
}

function isEditableHook(hook: Hook): boolean {
  return hook.editable ?? (!hook.location || hook.location.source === "cf");
}

export function isReadOnlyCfHook(hook: Hook): boolean {
  return hook.editable === false && (hook.location?.source ?? "cf") === "cf";
}

function isInCompatibilitySection(hook: Hook): boolean {
  return !isEditableHook(hook) && !isReadOnlyCfHook(hook);
}

export function resolveLatestReviewScopeTarget(
  bindings: Record<
    string,
    {
      request: { interactionId: string; createdAt: number; workspaceIdentity?: string };
      workspacePath: string;
    }
  >,
  workspaceTabs: readonly { workspacePath: string; workspaceIdentity?: string }[],
): { interactionId: string; scopeKey: string } | null {
  let latest: {
    interactionId: string;
    createdAt: number;
    workspaceIdentity?: string;
    workspacePath: string;
  } | null = null;
  for (const binding of Object.values(bindings)) {
    if (!latest || binding.request.createdAt > latest.createdAt) {
      latest = {
        interactionId: binding.request.interactionId,
        createdAt: binding.request.createdAt,
        workspaceIdentity: binding.request.workspaceIdentity,
        workspacePath: binding.workspacePath,
      };
    }
  }
  if (!latest) return null;
  const scopeKeyOf = (tab: { workspacePath: string; workspaceIdentity?: string }) =>
    tab.workspaceIdentity?.trim() || tab.workspacePath;
  const identity = latest.workspaceIdentity?.trim();
  const tab = identity
    ? workspaceTabs.find((candidate) => scopeKeyOf(candidate) === identity)
    : workspaceTabs.find((candidate) => candidate.workspacePath === latest!.workspacePath);
  return tab ? { interactionId: latest.interactionId, scopeKey: scopeKeyOf(tab) } : null;
}

export function resolveHookScopeTarget(
  selectedWorkspace: { workspacePath: string; workspaceIdentity?: string } | undefined,
  workspacePath: string | null | undefined,
  workspaceIdentity: string | undefined,
): { workspacePath: string | null | undefined; workspaceIdentity: string | undefined } {
  return selectedWorkspace
    ? {
        workspacePath: selectedWorkspace.workspacePath,
        workspaceIdentity: selectedWorkspace.workspaceIdentity,
      }
    : { workspacePath, workspaceIdentity };
}

export function buildPluginHookRows(
  plugins: readonly Pick<CfPluginInfo, "enabled" | "hookDetails" | "id" | "name">[],
  installedPlugins: readonly Pick<CfInstalledPluginSummary, "id" | "scope">[],
  scopeMetadataKnown: boolean,
): PluginHookRow[] {
  const scopeByPluginId = new Map(
    installedPlugins.map((plugin) => [plugin.id, plugin.scope] as const),
  );
  return plugins.flatMap((plugin) =>
    (plugin.hookDetails ?? []).map((detail) => ({
      detail,
      pluginEnabled: plugin.enabled,
      pluginId: plugin.id,
      pluginName: plugin.name,
      pluginScope: scopeMetadataKnown ? scopeByPluginId.get(plugin.id) : undefined,
    })),
  );
}

export function filterPluginHooksByScope(
  pluginHooks: readonly PluginHookRow[],
  scope: HookScope,
): PluginHookRow[] {
  const expectedScope = scope === "project" ? "workspace" : "user";
  return pluginHooks.filter(
    (hook) => hook.pluginScope === undefined || hook.pluginScope === expectedScope,
  );
}

export function HooksSection({
  workspacePath,
  workspaceIdentity,
  settingsSourceServerId,
}: HooksSectionProps) {
  const { intl, locale } = useCfIntl();
  const confirmDialog = useConfirmDialog();
  const currentServices = useServices();
  const hooksState = useHooksStore();
  const plugins = usePluginManagementStore((state) => state.plugins);
  const availablePlugins = usePluginManagementStore((state) => state.availablePlugins);
  const installedPlugins = usePluginManagementStore((state) => state.installedPlugins);
  const marketplaceAvailabilityKnown = usePluginManagementStore(
    (state) => state.marketplaceAvailabilityKnown,
  );
  const pluginsLoading = usePluginManagementStore((state) => state.loading);
  const pluginsError = usePluginManagementStore((state) => state.error);
  const initializePlugins = usePluginManagementStore((state) => state.initialize);
  const [viewMode, setViewMode] = useState<"list" | "form">("list");
  const [editingHook, setEditingHook] = useState<Hook | null>(null);
  const [query, setQuery] = useState("");
  const workspaceTabs = useConfigWorkspaceTargets(settingsSourceServerId);
  const [selectedScopeKey, setSelectedScopeKey] = useState("user");
  const deferredQuery = useDeferredValue(query);
  const selectedWorkspace = workspaceTabs.find(
    (tab) => getPluginWorkspaceKey(tab) === selectedScopeKey,
  );
  const activeScope: HookScope = selectedWorkspace ? "project" : "user";
  const { workspacePath: targetWorkspacePath, workspaceIdentity: targetWorkspaceIdentity } =
    resolveHookScopeTarget(selectedWorkspace, workspacePath, workspaceIdentity);
  const targetWorkspaceKey = targetWorkspacePath
    ? getWorkspaceKey(targetWorkspacePath, targetWorkspaceIdentity)
    : null;
  const cacheAuthorityKey =
    settingsSourceServerId && !selectedWorkspace
      ? `source-settings:${settingsSourceServerId}`
      : undefined;
  const targetServiceResolution = useWorkspaceServicesResolution(
    targetWorkspacePath,
    selectedWorkspace?.remoteSessionId,
    targetWorkspaceIdentity,
    selectedWorkspace?.remoteTarget,
    {
      unscopedServices: settingsSourceServerId && !selectedWorkspace ? currentServices : undefined,
      forceUnscoped: Boolean(settingsSourceServerId && !selectedWorkspace),
    },
  );
  const { hooksService: targetHooksService, pluginManagementService } =
    targetServiceResolution.services;
  const hooksService = useMemo<IHooksService>(() => {
    if (!settingsSourceServerId || activeScope !== "user") return targetHooksService;
    return {
      loadHooks: (params) => targetHooksService.loadHooks({ ...params, scope: "user" }),
      saveHooks: (params) => targetHooksService.saveHooks({ ...params, scope: "user" }),
      ...(targetHooksService.grantWorkspaceHookTrust
        ? {
            grantWorkspaceHookTrust:
              targetHooksService.grantWorkspaceHookTrust.bind(targetHooksService),
          }
        : {}),
    };
  }, [activeScope, settingsSourceServerId, targetHooksService]);
  const { trustActionAvailable, trustingHookId, trustHook } = useWorkspaceHookInlineTrust({
    workspacePath: targetWorkspacePath,
    workspaceIdentity: targetWorkspaceIdentity,
    authorityKey: cacheAuthorityKey,
    hooksService: targetServiceResolution.rpcReady ? hooksService : undefined,
    rpcReady: targetServiceResolution.rpcReady,
  });
  const reviewBindings = useWorkspaceHookReviewStore((state) => state.bindings);

  const editableHooks = useMemo(
    () =>
      hooksState.hooks.filter(
        (hook) =>
          (isEditableHook(hook) || isReadOnlyCfHook(hook)) &&
          (hook.location?.scope ?? "user") === activeScope,
      ),
    [activeScope, hooksState.hooks],
  );
  const compatibilityHooks = useMemo(
    () =>
      hooksState.hooks.filter(
        (hook) =>
          isInCompatibilitySection(hook) && (hook.location?.scope ?? "user") === activeScope,
      ),
    [activeScope, hooksState.hooks],
  );
  const pluginHooks = useMemo(
    () => buildPluginHookRows(plugins, installedPlugins, marketplaceAvailabilityKnown),
    [installedPlugins, marketplaceAvailabilityKnown, plugins],
  );
  const pluginListingById = useMemo(
    () => new Map(availablePlugins.map((plugin) => [plugin.id, plugin.listing])),
    [availablePlugins],
  );
  const scopedPluginHooks = useMemo(
    () =>
      filterPluginHooksByScope(pluginHooks, activeScope).map((hook) => ({
        ...hook,
        pluginIconItem: {
          name: hook.pluginName,
          listing: pluginListingById.get(hook.pluginId),
        },
      })),
    [activeScope, pluginHooks, pluginListingById],
  );
  const normalizedQuery = deferredQuery.trim().toLowerCase();
  const filteredEditableHooks = useMemo(
    () => editableHooks.filter((hook) => hookMatchesQuery(hook, normalizedQuery)),
    [editableHooks, normalizedQuery],
  );
  const filteredCompatibilityHooks = useMemo(
    () => compatibilityHooks.filter((hook) => hookMatchesQuery(hook, normalizedQuery)),
    [compatibilityHooks, normalizedQuery],
  );
  const filteredPluginHooks = useMemo(
    () =>
      scopedPluginHooks.filter((hook) =>
        [
          hook.pluginName,
          hook.detail.event,
          hook.detail.type,
          hook.detail.matcher,
          hook.detail.command,
          hook.detail.sourcePath,
        ].some((value) => value?.toLowerCase().includes(normalizedQuery)),
      ),
    [normalizedQuery, scopedPluginHooks],
  );

  useEffect(() => {
    if (!targetServiceResolution.rpcReady) return;
    void hooksState.initialize(
      targetWorkspacePath ?? undefined,
      targetWorkspaceIdentity,
      hooksService,
      cacheAuthorityKey,
    );
  }, [
    hooksService,
    cacheAuthorityKey,
    hooksState.initialize,
    targetServiceResolution.rpcReady,
    targetWorkspaceIdentity,
    targetWorkspacePath,
  ]);

  useEffect(() => {
    if (!targetWorkspacePath || !targetServiceResolution.rpcReady) return;
    void initializePlugins({
      workspacePath: targetWorkspacePath,
      workspaceIdentity: targetWorkspaceIdentity,
      authorityKey: cacheAuthorityKey,
      pluginService: pluginManagementService,
    });
  }, [
    initializePlugins,
    cacheAuthorityKey,
    pluginManagementService,
    targetServiceResolution.rpcReady,
    targetWorkspaceIdentity,
    targetWorkspacePath,
  ]);

  const handleRefresh = useCallback(async () => {
    if (!targetServiceResolution.rpcReady) return;
    await Promise.all([
      hooksState.initialize(
        targetWorkspacePath ?? undefined,
        targetWorkspaceIdentity,
        hooksService,
        cacheAuthorityKey,
      ),
      targetWorkspacePath
        ? initializePlugins({
            workspacePath: targetWorkspacePath,
            workspaceIdentity: targetWorkspaceIdentity,
            authorityKey: cacheAuthorityKey,
            pluginService: pluginManagementService,
          })
        : Promise.resolve(),
    ]);
  }, [
    hooksService,
    cacheAuthorityKey,
    hooksState.initialize,
    initializePlugins,
    pluginManagementService,
    targetServiceResolution.rpcReady,
    targetWorkspaceIdentity,
    targetWorkspacePath,
  ]);

  useEffect(() => {
    if (
      selectedScopeKey !== "user" &&
      !workspaceTabs.some((tab) => getPluginWorkspaceKey(tab) === selectedScopeKey)
    ) {
      setSelectedScopeKey("user");
    }
  }, [selectedScopeKey, workspaceTabs]);

  const latestReviewScopeTarget = useMemo(
    () => resolveLatestReviewScopeTarget(reviewBindings, workspaceTabs),
    [reviewBindings, workspaceTabs],
  );
  const handledReviewInteractionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!latestReviewScopeTarget) return;
    if (handledReviewInteractionRef.current === latestReviewScopeTarget.interactionId) return;
    handledReviewInteractionRef.current = latestReviewScopeTarget.interactionId;
    if (latestReviewScopeTarget.scopeKey !== selectedScopeKey) {
      setSelectedScopeKey(latestReviewScopeTarget.scopeKey);
    }
  }, [latestReviewScopeTarget, selectedScopeKey]);

  const invalidateDraft = useCallback(
    async (reason: string) => {
      await invalidateDeferredDraftSessionForRuntimeChange({
        logScope: "hooks",
        reason,
        workspaceIdentity: targetWorkspaceIdentity,
        workspacePath: targetWorkspacePath,
      });
    },
    [targetWorkspaceIdentity, targetWorkspacePath],
  );

  const handleSaveHook = useCallback(
    async (config: HookConfig) => {
      try {
        if (editingHook) {
          await hooksState.updateHook(editingHook.id, config, hooksService);
          await invalidateDraft("hook-updated");
        } else {
          await hooksState.addHook(config, hooksService);
          await invalidateDraft("hook-added");
        }
        setViewMode("list");
        setEditingHook(null);
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error));
      }
    },
    [editingHook, hooksService, hooksState.addHook, hooksState.updateHook, invalidateDraft],
  );
  const handleCreateHook = useCallback(() => {
    setEditingHook(null);
    setViewMode("form");
  }, []);

  const handleDelete = useCallback(
    async (hook: Hook) => {
      const confirmed = await confirmDialog({
        confirmVariant: "destructive",
        title: intl.formatMessage({ id: "settings.hooks.delete" }),
        description: intl.formatMessage(
          { id: "settings.hooks.deleteDescription" },
          { event: hook.event },
        ),
        confirmLabel: intl.formatMessage({ id: "common.delete" }),
      });
      if (!confirmed) return;
      try {
        await hooksState.deleteHook(hook.id, hooksService);
        await invalidateDraft("hook-deleted");
        setEditingHook(null);
        setViewMode("list");
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error));
      }
    },
    [confirmDialog, hooksService, hooksState.deleteHook, intl, invalidateDraft],
  );

  const handleToggle = useCallback(
    async (hook: Hook, enabled: boolean) => {
      try {
        await hooksState.toggleHook(hook.id, enabled, hooksService);
        await invalidateDraft(enabled ? "hook-enabled" : "hook-disabled");
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error));
      }
    },
    [hooksService, hooksState.toggleHook, invalidateDraft],
  );

  const handleImport = useCallback(
    async (hook: Hook) => {
      try {
        await hooksState.importHook(hook.id, hooksService);
        await invalidateDraft("hook-imported");
        toast(intl.formatMessage({ id: "settings.hooks.imported" }));
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error));
      }
    },
    [hooksService, hooksState.importHook, intl, invalidateDraft],
  );

  if (viewMode === "form" && targetServiceResolution.rpcReady) {
    return (
      <>
        <SettingsBreadcrumbReporter
          items={[
            {
              label: editingHook?.event ?? intl.formatMessage({ id: "settings.hooks.add" }),
            },
          ]}
          onSectionSelect={() => {
            setEditingHook(null);
            setViewMode("list");
          }}
        />
        <SettingsUserScopeProvider
          target={{ workspaceIdentity }}
          sourceServerId={settingsSourceServerId}
        >
          <HookForm
            hook={editingHook ?? undefined}
            workspaceAvailable={Boolean(targetWorkspacePath)}
            defaultStorageLevel={activeScope}
            selectedScopeKey={selectedScopeKey}
            workspaceTabs={workspaceTabs}
            onScopeKeyChange={setSelectedScopeKey}
            onSave={handleSaveHook}
            onDelete={editingHook ? handleDelete : undefined}
            onCancel={() => {
              setEditingHook(null);
              setViewMode("list");
            }}
            isEditing={Boolean(editingHook)}
          />
        </SettingsUserScopeProvider>
      </>
    );
  }

  const loading = hooksState.loading || pluginsLoading;
  const error = hooksState.error || pluginsError;
  const visibleCount =
    filteredEditableHooks.length + filteredCompatibilityHooks.length + filteredPluginHooks.length;
  const totalCount = editableHooks.length + compatibilityHooks.length + scopedPluginHooks.length;
  const hasSearchResultEmpty = Boolean(normalizedQuery) && visibleCount === 0;
  const showWorkspaceHookTrustNotice = shouldShowWorkspaceHookTrustNotice({
    hooks: editableHooks,
    loadedWorkspaceKey: hooksState.loadedWorkspaceKey,
    rpcReady: targetServiceResolution.rpcReady,
    targetWorkspaceKey,
  });
  return (
    <div className="space-y-6" data-testid="hooks-settings-section">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <PluginScopeMenu
            userTarget={{ workspaceIdentity }}
            userSourceServerId={settingsSourceServerId}
            align="start"
            selectedScopeKey={selectedScopeKey}
            workspaceTabs={workspaceTabs}
            onScopeKeyChange={setSelectedScopeKey}
          />
          <div className="hidden h-4 w-px bg-border sm:block" aria-hidden="true" />
          <div
            data-independent-capability-count="true"
            className="flex h-7 items-center gap-1 px-3 text-ui-base font-medium text-foreground"
          >
            <span>{intl.formatMessage({ id: "settings.hooks.title" })}</span>
            <span className="text-ui-sm text-foreground-subtle">{visibleCount}</span>
          </div>
        </div>
        <SettingsSearchInput
          containerClassName="w-full sm:ml-auto sm:w-64"
          clearLabel={intl.formatMessage({ id: "settings.search.clear" })}
          value={query}
          onClear={() => setQuery("")}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={intl.formatMessage({
            id: "settings.hooks.searchPlaceholder",
          })}
        />
      </div>

      {showWorkspaceHookTrustNotice ? <WorkspaceHookTrustNotice hooks={editableHooks} /> : null}

      {targetServiceResolution.rpcReady && error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-ui-base text-destructive">
          {error}
        </div>
      ) : null}

      {!targetServiceResolution.rpcReady ? (
        <PluginLoadingState label={intl.formatMessage({ id: "common.connecting" })} />
      ) : loading && totalCount === 0 ? (
        <PluginLoadingState label={intl.formatMessage({ id: "common.loading" })} />
      ) : hasSearchResultEmpty ? (
        <PluginSearchEmptyState label={intl.formatMessage({ id: "settings.hooks.searchEmpty" })} />
      ) : (
        <HooksList
          compatibilityHooks={filteredCompatibilityHooks}
          editableHooks={filteredEditableHooks}
          operatingHookId={hooksState.operatingHookId}
          pluginHooks={filteredPluginHooks}
          showInstalledSection={!normalizedQuery}
          installedEmptyTitle={intl.formatMessage({
            id: "settings.plugin.hooks.emptyInstalledTitle",
          })}
          installedEmptyDescription={intl.formatMessage({
            id: "settings.plugin.hooks.emptyInstalledDescription",
          })}
          installedEmptyActions={
            <Button type="button" variant="default" size="lg" onClick={handleCreateHook}>
              <Plus data-icon="inline-start" aria-hidden="true" />
              {intl.formatMessage({ id: "settings.hooks.add" })}
            </Button>
          }
          installedAction={
            <SettingsResourceHeaderActions
              onRefresh={() => void handleRefresh()}
              onNew={handleCreateHook}
              newActionId="settings.hooks.add"
            />
          }
          formatPluginName={(name, pluginId) =>
            resolvePluginDisplayName(
              {
                name,
                listing:
                  (pluginId ? pluginListingById.get(pluginId) : undefined) ??
                  resolveUniquePluginListingByName(availablePlugins, name),
              },
              locale,
            )
          }
          onEdit={(target) => {
            setEditingHook(target);
            setViewMode("form");
          }}
          onImport={handleImport}
          onTrust={trustHook}
          trustActionAvailable={trustActionAvailable}
          trustingHookId={trustingHookId}
          onToggle={handleToggle}
        />
      )}
    </div>
  );
}

function hookMatchesQuery(hook: Hook, normalizedQuery: string): boolean {
  if (!normalizedQuery) {
    return true;
  }
  return [
    hook.event,
    hook.type,
    hook.matcher,
    hook.command,
    ...(hook.args ?? []),
    hook.location?.directoryPath,
  ].some((value) => value?.toLowerCase().includes(normalizedQuery));
}
