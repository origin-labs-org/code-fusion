
/**
 * MCP Settings Section
 *
 * Manages MCP server configuration in the settings page.
 * Supports the unified CodeFusion Agent MCP source backed by settings directories.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertToCfAgentMcpServer } from "@origin-ai/cf-shared";
import {
  TID_MCP_OPEN_AUTHORIZATION_BUTTON,
  TID_PLUGIN_MCP_SERVER_ROW,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import type {
  RemoteTarget,
  CfAvailablePluginSummary,
  CfAgentMcpServer,
  CfMcpListMode,
  CfMcpServer,
  CfMcpServerStatusSnapshot,
  CfPluginInfo,
} from "@origin-ai/cf-shared";
import {
  isCfAgentMcpStatusModeUnsupportedError,
  type IServiceAccessor,
  type IMcpSyncService,
} from "@origin-ai/cf-services";
import { Button } from "@/components/ui/button.js";
import { toast } from "@/components/ui/toast.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { logger } from "@/logger.js";
import { McpServerForm } from "@/settings/McpServerForm.js";
import { McpServerList, McpStatusDot } from "@/settings/McpServerList.js";
import {
  formToConfig,
  type FormState,
  type McpEditorMode,
  type ServerScope,
} from "@/settings/mcpSettingsShared.js";
import { SettingsBreadcrumbReporter } from "@/settings/SettingsHeaderBreadcrumb.js";
import { SettingsResourceHeaderActions } from "@/settings/SettingsResourceHeaderActions.js";
import { PluginStoreAvatar } from "@/settings/PluginStoreAvatar.js";
import {
  PluginInstallEmptyState,
  PluginLoadingState,
  PluginSearchEmptyState,
} from "@/settings/PluginInstallEmptyState.js";
import {
  buildPluginMcpServerItems,
  filterLocalMcpServers,
  groupPluginMcpServersByPlugin,
  type PluginMcpServerItem,
} from "@/settings/pluginManagedResourceGroups.js";
import { resolvePluginDisplayName } from "@/settings/pluginStoreListing.js";
import {
  McpFailurePresentation,
  resolveMcpFailureMessageId,
} from "@/settings/McpFailurePresentation.js";
import {
  SettingsResourceGroupHeader,
  SettingsResourceList,
} from "@/settings/SettingsResourceGroup.js";
import { McpServersImportDialog } from "@/settings/ExternalAgentImportDialog.js";
import { RemoteSyncDialogs, shouldShowRemoteSyncActions } from "@/settings/RemoteSyncActions.js";
import { useMcpStore } from "@/store/mcpStore.js";
import { usePluginManagementStore } from "@/store/pluginManagementStore.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useBaseWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { useConfigWorkspaceServices as useWorkspaceServices } from "@/workspace-config-catalog/index.js";
import { useTabStore } from "@/store/TabStoreProvider.js";
import type { ConfigWorkspaceTarget } from "@/workspace-config-catalog/index.js";
import { getPluginWorkspaceKey } from "@/settings/PluginScopeMenu.js";
import { ExternalLink, Import, Plus, UploadCloud } from "lucide-react";
import { SettingsSegmentedTabs } from "@/settings/SettingsSegmentedTabs.js";
import { formatRemoteSkillSyncTarget } from "@/settings/RemoteSkillSyncDialog.js";
import { selectPluginsForScope } from "@/settings/pluginCapabilityProjection.js";

const DEFAULT_MCP_SOURCE: ServerScope = "cfagentmcp";
const MCP_OAUTH_AUTHORIZATION_STATUS_REFRESH_MS = 1_000;
const MCP_OAUTH_AUTHORIZATION_STATUS_REFRESH_DURATION_MS = 5 * 60_000;
const MCP_OAUTH_AUTHORIZATION_FOLLOWUP_REFRESH_ATTEMPTS = 10;

export function createMcpOAuthAuthorizationStatusRefreshDeadline(
  now: () => number = Date.now,
): number {
  return now() + MCP_OAUTH_AUTHORIZATION_STATUS_REFRESH_DURATION_MS;
}

export function isMcpOAuthAuthorizationStatusRefreshExpired(
  deadline: number,
  now: () => number = Date.now,
): boolean {
  return now() >= deadline;
}

export type McpServerStatusListRefreshOutcome =
  | "refreshed"
  | "stale-workspace"
  | "status-mode-unsupported";

export async function refreshMcpServerStatusList({
  beginServerStatusListRefresh,
  markServerStatusListRefreshFailed,
  mergeServerStatusSnapshots,
  getCurrentWorkspaceKey,
  mode,
  mcpServers,
  requestedWorkspaceKey,
  workspaceIdentity,
  workspacePath,
  mcpSyncService,
}: {
  beginServerStatusListRefresh: (mode?: CfMcpListMode) => number;
  markServerStatusListRefreshFailed?: (
    error: string,
    requestEpoch: number,
    mode?: CfMcpListMode,
  ) => void;
  mergeServerStatusSnapshots: (
    statuses: Record<string, CfMcpServerStatusSnapshot>,
    requestEpoch: number,
    mode?: CfMcpListMode,
  ) => void;
  getCurrentWorkspaceKey: () => string;
  mode?: CfMcpListMode;
  mcpServers?: CfAgentMcpServer[];
  requestedWorkspaceKey: string;
  workspaceIdentity?: string;
  workspacePath: string;
  mcpSyncService: Pick<IMcpSyncService, "listWorkspaceMcpServerStatuses">;
}): Promise<McpServerStatusListRefreshOutcome> {
  if (!requestedWorkspaceKey || getCurrentWorkspaceKey() !== requestedWorkspaceKey) {
    return "stale-workspace";
  }
  const refreshMode = mode ?? "connect";
  const requestEpoch = beginServerStatusListRefresh(refreshMode);
  try {
    const result = await mcpSyncService.listWorkspaceMcpServerStatuses({
      workspacePath,
      ...(workspaceIdentity ? { workspaceIdentity } : {}),
      ...(mcpServers !== undefined ? { mcpServers } : {}),
      ...(mode ? { mode } : {}),
    });
    if (getCurrentWorkspaceKey() !== requestedWorkspaceKey) {
      return "stale-workspace";
    }
    mergeServerStatusSnapshots(result.statuses, requestEpoch, refreshMode);
    return "refreshed";
  } catch (error) {
    if (getCurrentWorkspaceKey() !== requestedWorkspaceKey) {
      return "stale-workspace";
    }
    if (refreshMode === "status" && isCfAgentMcpStatusModeUnsupportedError(error)) {
      return "status-mode-unsupported";
    }
    markServerStatusListRefreshFailed?.(
      error instanceof Error ? error.message : String(error),
      requestEpoch,
      refreshMode,
    );
    throw error;
  }
}

export interface McpOAuthAuthorizationPendingRefresh {
  mcpServers: CfAgentMcpServer[];
  pendingKey: string;
  workspaceKey: string;
}

export function transitionMcpAutoStatusListRefreshKey(
  previousKey: string,
  nextKey: string,
): { lastRefreshKey: string; shouldRefresh: boolean } {
  if (!nextKey) {
    return { lastRefreshKey: "", shouldRefresh: false };
  }
  return {
    lastRefreshKey: nextKey,
    shouldRefresh: previousKey !== nextKey,
  };
}

export interface McpOAuthAuthorizationFollowupRefresh {
  mcpServers: CfAgentMcpServer[];
  refreshKey: string;
  workspaceKey: string;
}

export function transitionMcpOAuthAuthorizationPendingRefresh({
  activeWorkspaceKey,
  existingFollowup = null,
  mcpServers,
  now = Date.now,
  pendingKey,
  previous,
}: {
  activeWorkspaceKey: string;
  existingFollowup?: McpOAuthAuthorizationFollowupRefresh | null;
  mcpServers: CfAgentMcpServer[];
  now?: () => number;
  pendingKey: string;
  previous: McpOAuthAuthorizationPendingRefresh | null;
}): {
  followup: McpOAuthAuthorizationFollowupRefresh | null;
  pending: McpOAuthAuthorizationPendingRefresh | null;
} {
  if (!activeWorkspaceKey) {
    return { followup: null, pending: null };
  }
  if (pendingKey) {
    return {
      followup: null,
      pending: {
        mcpServers: [...mcpServers],
        pendingKey,
        workspaceKey: activeWorkspaceKey,
      },
    };
  }
  if (existingFollowup?.workspaceKey === activeWorkspaceKey) {
    return { followup: existingFollowup, pending: null };
  }
  if (!previous || previous.workspaceKey !== activeWorkspaceKey) {
    return { followup: null, pending: null };
  }
  return {
    followup: {
      mcpServers: [...previous.mcpServers],
      refreshKey: `${activeWorkspaceKey}:${previous.pendingKey}:${now()}`,
      workspaceKey: activeWorkspaceKey,
    },
    pending: null,
  };
}

interface McpStatusListRefreshQueue {
  request: (runLatest: () => Promise<void>) => Promise<void>;
}

export type McpStatusListRefreshTrigger = "auto" | "manual";

export interface McpStatusListRefreshInput {
  activeWorkspaceKey: string;
  activeWorkspacePath?: string;
  configReadyWorkspaceKey: string;
  isConfigLoaded: boolean;
  serverStatusListKey: string;
  storeWorkspaceKey: string;
}

export function resolveMcpStatusListRefreshSkipReason({
  input,
  requestedWorkspaceKey,
  trigger,
}: {
  input: McpStatusListRefreshInput;
  requestedWorkspaceKey: string;
  trigger: McpStatusListRefreshTrigger;
}): string | undefined {
  if (!requestedWorkspaceKey) return "no-active-workspace";
  if (input.activeWorkspaceKey !== requestedWorkspaceKey) {
    return "workspace-changed";
  }
  if (input.storeWorkspaceKey !== requestedWorkspaceKey) {
    return "mcp-store-not-aligned";
  }
  if (input.configReadyWorkspaceKey !== requestedWorkspaceKey) {
    return "config-not-ready";
  }
  if (!input.isConfigLoaded) return "config-not-loaded";
  if (!input.activeWorkspacePath) return "no-workspace-path";
  if (!input.serverStatusListKey && trigger !== "manual") {
    return "empty-status-list-key";
  }
  return undefined;
}

export function createMcpStatusListRefreshQueue(): McpStatusListRefreshQueue {
  let inFlight: Promise<void> | null = null;
  let latestRun: (() => Promise<void>) | null = null;
  let rerunAfterCurrent = false;

  return {
    async request(runLatest) {
      latestRun = runLatest;
      if (inFlight) {
        rerunAfterCurrent = true;
        await inFlight;
        return;
      }

      inFlight = (async () => {
        try {
          do {
            rerunAfterCurrent = false;
            const run = latestRun ?? runLatest;
            latestRun = null;
            await run();
          } while (rerunAfterCurrent);
        } finally {
          inFlight = null;
        }
      })();

      await inFlight;
    },
  };
}

export function buildMcpOAuthAuthorizationStatusRefreshServers(
  servers: CfMcpServer[],
  statusSnapshots: Record<string, CfMcpServerStatusSnapshot> = {},
): CfAgentMcpServer[] {
  const pendingSnapshotNames = new Set(
    Object.entries(statusSnapshots)
      .filter(([, snapshot]) => Boolean(snapshot.authorization?.authorizationUrl))
      .map(([serverName]) => serverName),
  );
  const result: CfAgentMcpServer[] = [];
  const seenNames = new Set<string>();

  for (const server of servers) {
    if (server.source !== "cfagentmcp" || !server.enabled) {
      continue;
    }
    const hasPendingAuthorization =
      Boolean(server.authorization?.authorizationUrl) || pendingSnapshotNames.has(server.name);
    if (!hasPendingAuthorization || seenNames.has(server.name)) {
      continue;
    }
    const cfAgentServer = convertToCfAgentMcpServer(server.name, server.config);
    if (!cfAgentServer) {
      continue;
    }
    seenNames.add(server.name);
    result.push(cfAgentServer);
  }

  return result;
}

export function buildMcpOAuthAuthorizationStatusRefreshOptions(mcpServers: CfAgentMcpServer[]): {
  mode: "status";
  mcpServers: CfAgentMcpServer[];
} {
  return {
    mode: "status",
    mcpServers,
  };
}

export function buildMcpServerStatusListKey(servers: CfMcpServer[]): string {
  return servers
    .filter((server) => server.source === "cfagentmcp")
    .map((server) => {
      const enabledKey = server.enabled ? "enabled" : "disabled";
      return `${server.id}:${enabledKey}:${JSON.stringify(server.config)}`;
    })
    .join("|");
}

export function buildPluginMcpServerStatusListKey(plugins: CfPluginInfo[]): string {
  return plugins
    .map((plugin) => {
      const declaredNames = plugin.declaredMcpServerNames ?? [];
      const runtimeNames = plugin.mcpServerNames;
      const hostNames = plugin.hostMcpServerNames ?? [];
      if (
        (!plugin.enabled && hostNames.length === 0) ||
        (declaredNames.length === 0 && runtimeNames.length === 0 && hostNames.length === 0)
      ) {
        return "";
      }
      const pluginKey = `${plugin.id}:${plugin.enabled ? "enabled" : "disabled"}:${[
        ...declaredNames,
      ]
        .sort()
        .join(",")}:${[...runtimeNames].sort().join(",")}`;
      return hostNames.length > 0
        ? `${pluginKey}:host=${[...hostNames].sort().join(",")}`
        : pluginKey;
    })
    .filter(Boolean)
    .join("|");
}

export function shouldShowPluginMcpServersInMcpSettings(isRemoteSyncContext: boolean): boolean {
  return !isRemoteSyncContext;
}

export function buildPendingMcpOAuthAuthorizationRefreshKey(
  servers: CfMcpServer[],
  statusSnapshots: Record<string, CfMcpServerStatusSnapshot> = {},
): string {
  const localPendingKeys = servers
    .filter(
      (server) =>
        server.source === "cfagentmcp" &&
        server.enabled &&
        Boolean(server.authorization?.authorizationUrl),
    )
    .map((server) => `${server.id}:${server.authorization?.startedAt ?? ""}`);
  const runtimePendingKeys = Object.entries(statusSnapshots)
    .filter(([, snapshot]) => Boolean(snapshot.authorization?.authorizationUrl))
    .map(([serverName, snapshot]) => `${serverName}:${snapshot.authorization?.startedAt ?? ""}`);
  return Array.from(new Set([...localPendingKeys, ...runtimePendingKeys])).join("|");
}

function PluginMcpServerList({
  items,
  pluginListingById,
  onOpenAuthorization,
}: {
  items: PluginMcpServerItem[];
  pluginListingById: ReadonlyMap<string, CfAvailablePluginSummary["listing"]>;
  onOpenAuthorization?: (item: PluginMcpServerItem) => void;
}) {
  const { intl } = useCfIntl();
  const openAuthorizationLabel = intl.formatMessage({
    id: "settings.mcp.oauth.openAuthorization",
  });

  function resolveStatusDescription(item: PluginMcpServerItem): string {
    if (item.authorization?.authorizationUrl) {
      return intl.formatMessage({
        id: "settings.mcp.plugin.authorizationRequiredDescription",
      });
    }
    if (item.status === "error") {
      return intl.formatMessage({
        id: resolveMcpFailureMessageId(item.failureKind),
      });
    }
    if (item.active) {
      if (item.status === "connecting") {
        return intl.formatMessage({
          id: "settings.mcp.plugin.connectingDescription",
        });
      }
      if (item.status === "connected") {
        return intl.formatMessage({
          id: "settings.mcp.plugin.connectedDescription",
        });
      }
      if (item.status === "disconnected") {
        return intl.formatMessage({
          id: "settings.mcp.plugin.disconnectedDescription",
        });
      }
      return item.hostProvided
        ? intl.formatMessage(
            { id: "settings.mcp.host.activeDescription" },
            { pluginName: item.pluginName },
          )
        : intl.formatMessage({ id: "settings.mcp.plugin.activeDescription" });
    }
    if (!item.pluginEnabled) {
      return intl.formatMessage({
        id: "settings.mcp.plugin.disabledDescription",
      });
    }
    return intl.formatMessage({
      id: "settings.mcp.plugin.unavailableDescription",
    });
  }

  return (
    <SettingsResourceList
      items={items}
      getKey={(item) => item.id}
      renderItem={(item) => {
        const statusDescription = resolveStatusDescription(item);
        return (
          <div
            className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 transition-colors hover:bg-hover"
            data-mcp-status={item.status ?? ""}
            data-mcp-tool-count={item.toolCount}
            data-testid={testId(TID_PLUGIN_MCP_SERVER_ROW, item.runtimeServerName)}
          >
            <div className="relative size-9 shrink-0" data-mcp-status-dot-placement="icon-corner">
              <PluginStoreAvatar
                item={{
                  name: item.pluginName,
                  listing: pluginListingById.get(item.pluginId),
                }}
                className="size-9 bg-background"
              />
              <span className="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full bg-background">
                <McpStatusDot
                  status={item.status}
                  attention={Boolean(item.authorization?.authorizationUrl)}
                  disabled={!item.pluginEnabled}
                  reason={statusDescription}
                />
              </span>
            </div>
            <div className="min-w-0">
              <div className="truncate text-ui-base font-medium text-foreground">{item.name}</div>
              {item.status === "error" ? (
                <McpFailurePresentation error={item.error} failureKind={item.failureKind} />
              ) : (
                <div className="mt-0.5 truncate text-ui-sm text-foreground-subtle">
                  {statusDescription}
                </div>
              )}
            </div>
            {item.authorization?.authorizationUrl ? (
              <div className="flex min-w-0 max-w-full shrink-0 items-center gap-2">
                <Button
                  variant="link"
                  size="sm"
                  className="text-sky-500 hover:text-sky-600 dark:text-sky-400 dark:hover:text-sky-300"
                  aria-label={openAuthorizationLabel}
                  data-testid={testId(TID_MCP_OPEN_AUTHORIZATION_BUTTON, item.runtimeServerName)}
                  title={openAuthorizationLabel}
                  onClick={() => onOpenAuthorization?.(item)}
                >
                  <ExternalLink className="size-4" aria-hidden="true" />
                  <span className="hidden sm:inline">{openAuthorizationLabel}</span>
                </Button>
              </div>
            ) : null}
          </div>
        );
      }}
    />
  );
}

interface McpSettingsSectionProps {
  workspacePath?: string | null;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  remoteTarget?: RemoteTarget;
  localWorkspacePath?: string;
  isWebRemoteControl?: boolean;
  scopeFilter: "user" | "workspace";
  parentScopeKey: string;
  workspaceTabs: ConfigWorkspaceTarget[];
  searchQuery: string;
  onVisibleCountChange?: (count: number) => void;
  onEditorOpenChange?: (open: boolean) => void;
  onFormScopeKeyChange?: (scopeKey: string | null) => void;
  onOpenPluginStore?: () => void;
  showMarketplaceBreadcrumb?: boolean;
  unscopedServices?: IServiceAccessor;
  cacheAuthorityKey?: string;
}

export function McpSettingsSection({
  workspacePath,
  workspaceIdentity,
  remoteSessionId,
  remoteTarget,
  localWorkspacePath,
  isWebRemoteControl = false,
  scopeFilter,
  parentScopeKey,
  workspaceTabs,
  searchQuery,
  onVisibleCountChange,
  onEditorOpenChange,
  onFormScopeKeyChange,
  onOpenPluginStore,
  showMarketplaceBreadcrumb = false,
  unscopedServices,
  cacheAuthorityKey,
}: McpSettingsSectionProps) {
  const { intl, locale } = useCfIntl();
  const confirmDialog = useConfirmDialog();
  const services = useWorkspaceServices(
    workspacePath,
    remoteSessionId,
    workspaceIdentity,
    remoteTarget,
    { unscopedServices, forceUnscoped: Boolean(cacheAuthorityKey) },
  );
  const platform = usePlatform();
  const baseServices = useBaseWorkspaceServices();

  const storedServers = useMcpStore((s) => s.servers);
  const storedStatusSnapshots = useMcpStore((s) => s.statusSnapshots);
  const plugins = usePluginManagementStore((state) => state.plugins);
  const availablePlugins = usePluginManagementStore((state) => state.availablePlugins);
  const installedPlugins = usePluginManagementStore((state) => state.installedPlugins);
  const pluginStoreWorkspacePath = usePluginManagementStore((state) => state.workspacePath);
  const pluginStoreWorkspaceIdentity = usePluginManagementStore((state) => state.workspaceIdentity);
  const pluginStoreAuthorityKey = usePluginManagementStore((state) => state.authorityKey);
  const pluginConfigScope = usePluginManagementStore((state) => state.configScope);
  const initializePlugins = usePluginManagementStore((state) => state.initialize);
  const currentProjectPath = useMcpStore((s) => s.currentProjectPath);
  const currentWorkspaceIdentity = useMcpStore((s) => s.currentWorkspaceIdentity);
  const currentAuthorityKey = useMcpStore((s) => s.currentAuthorityKey);
  const storeActiveWorkspacePath = useTabStore((s) => s.activeWorkspacePath);
  const storeActiveWorkspaceIdentity = useTabStore((s) => s.activeWorkspaceIdentity ?? undefined);
  const activeWorkspacePath = workspacePath ?? storeActiveWorkspacePath;
  const activeWorkspaceIdentity = workspaceIdentity ?? storeActiveWorkspaceIdentity;
  const activeWorkspaceKey = `${cacheAuthorityKey?.trim() || "workspace"}\0${activeWorkspaceIdentity?.trim() || activeWorkspacePath || ""}`;
  const currentMcpStoreWorkspaceKey = `${currentAuthorityKey?.trim() || "workspace"}\0${currentWorkspaceIdentity?.trim() || currentProjectPath}`;
  const mcpStoreMatchesActiveWorkspace =
    Boolean(activeWorkspaceKey) && currentMcpStoreWorkspaceKey === activeWorkspaceKey;
  const servers = mcpStoreMatchesActiveWorkspace ? storedServers : [];
  const statusSnapshots = mcpStoreMatchesActiveWorkspace ? storedStatusSnapshots : {};
  const isConfigLoaded = useMcpStore((s) => s.isConfigLoaded);
  const ensureLoadedForWorkspace = useMcpStore((s) => s.ensureLoadedForWorkspace);
  const loadMcpFromUserDirectory = useMcpStore((s) => s.loadMcpFromUserDirectory);
  const toggleServer = useMcpStore((s) => s.toggleServer);
  const addScopedMcpServer = useMcpStore((s) => s.addScopedMcpServer);
  const updateScopedMcpServer = useMcpStore((s) => s.updateScopedMcpServer);
  const deleteScopedMcpServer = useMcpStore((s) => s.deleteScopedMcpServer);
  const updateServerStatus = useMcpStore((s) => s.updateServerStatus);
  const beginServerStatusListRefresh = useMcpStore((s) => s.beginServerStatusListRefresh);
  const markServerStatusListRefreshFailed = useMcpStore((s) => s.markServerStatusListRefreshFailed);
  const mergeServerStatusSnapshots = useMcpStore((s) => s.mergeServerStatusSnapshots);

  const [showForm, setShowForm] = useState(false);
  const [formScopeKey, setFormScopeKey] = useState(parentScopeKey);
  const [editingServer, setEditingServer] = useState<CfMcpServer | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [remoteMcpSyncOpen, setRemoteMcpSyncOpen] = useState(false);
  const query = searchQuery;
  const [editorMode, setEditorMode] = useState<McpEditorMode>("form");
  const [mcpConfigReadyWorkspaceKey, setMcpConfigReadyWorkspaceKey] = useState("");
  const [mcpOAuthAuthorizationFollowupRefresh, setMcpOAuthAuthorizationFollowupRefresh] =
    useState<McpOAuthAuthorizationFollowupRefresh | null>(null);
  const [mcpStatusOnlyUnsupported, setMcpStatusOnlyUnsupported] = useState(false);
  const mcpStatusOnlyUnsupportedRef = useRef(false);
  const isFormView = showForm || editingServer !== null;
  useEffect(() => {
    onEditorOpenChange?.(isFormView);
  }, [isFormView, onEditorOpenChange]);
  useEffect(
    () => () => {
      onEditorOpenChange?.(false);
    },
    [onEditorOpenChange],
  );
  const serverStatusListKey = useMemo(
    () =>
      [buildMcpServerStatusListKey(servers), buildPluginMcpServerStatusListKey(plugins)]
        .filter(Boolean)
        .join("|"),
    [plugins, servers],
  );
  const statusListRefreshQueueRef = useRef<McpStatusListRefreshQueue | null>(null);
  if (!statusListRefreshQueueRef.current) {
    statusListRefreshQueueRef.current = createMcpStatusListRefreshQueue();
  }
  const latestStatusListRefreshInputRef = useRef<{
    activeWorkspaceIdentity?: string;
    activeWorkspaceKey: string;
    activeWorkspacePath?: string;
    configReadyWorkspaceKey: string;
    storeWorkspaceKey: string;
    isConfigLoaded: boolean;
    serverStatusListKey: string;
  }>({
    activeWorkspaceIdentity,
    activeWorkspaceKey,
    activeWorkspacePath: activeWorkspacePath ?? undefined,
    configReadyWorkspaceKey: mcpConfigReadyWorkspaceKey,
    isConfigLoaded,
    serverStatusListKey,
    storeWorkspaceKey: currentMcpStoreWorkspaceKey,
  });
  latestStatusListRefreshInputRef.current = {
    activeWorkspaceIdentity,
    activeWorkspaceKey,
    activeWorkspacePath: activeWorkspacePath ?? undefined,
    configReadyWorkspaceKey: mcpConfigReadyWorkspaceKey,
    isConfigLoaded,
    serverStatusListKey,
    storeWorkspaceKey: currentMcpStoreWorkspaceKey,
  };
  const autoStatusListRefreshKey = useMemo(() => {
    if (
      !isConfigLoaded ||
      !activeWorkspacePath ||
      !activeWorkspaceKey ||
      mcpConfigReadyWorkspaceKey !== activeWorkspaceKey ||
      !serverStatusListKey
    ) {
      return "";
    }
    return [activeWorkspaceIdentity ?? "", activeWorkspacePath, serverStatusListKey].join("\n");
  }, [
    activeWorkspaceIdentity,
    activeWorkspaceKey,
    activeWorkspacePath,
    isConfigLoaded,
    mcpConfigReadyWorkspaceKey,
    serverStatusListKey,
  ]);
  const pendingMcpOAuthAuthorizationRefreshKey = useMemo(
    () => buildPendingMcpOAuthAuthorizationRefreshKey(servers, statusSnapshots),
    [servers, statusSnapshots],
  );
  const pendingMcpOAuthAuthorizationRefreshServers = useMemo(
    () => buildMcpOAuthAuthorizationStatusRefreshServers(servers, statusSnapshots),
    [servers, statusSnapshots],
  );
  const pendingMcpOAuthAuthorizationRefreshDeadline = useMemo(
    () =>
      activeWorkspaceKey && pendingMcpOAuthAuthorizationRefreshKey
        ? createMcpOAuthAuthorizationStatusRefreshDeadline()
        : 0,
    [activeWorkspaceKey, pendingMcpOAuthAuthorizationRefreshKey],
  );
  const lastPendingMcpOAuthAuthorizationRefreshRef =
    useRef<McpOAuthAuthorizationPendingRefresh | null>(null);
  const lastAutoStatusListRefreshKeyRef = useRef("");
  const requestMcpServerStatusList = useCallback(
    async (options?: {
      mcpServers?: CfAgentMcpServer[];
      mode?: CfMcpListMode;
      trigger?: McpStatusListRefreshTrigger;
    }) => {
      const trigger = options?.trigger ?? "auto";
      const requestedWorkspaceKey = activeWorkspaceKey;
      const requestedInput = latestStatusListRefreshInputRef.current;
      const getCurrentRefreshWorkspaceKey = () => {
        const latest = latestStatusListRefreshInputRef.current;
        return latest.activeWorkspaceKey === latest.storeWorkspaceKey &&
          latest.configReadyWorkspaceKey === latest.activeWorkspaceKey
          ? latest.activeWorkspaceKey
          : "";
      };
      const isRequestCurrent = () => getCurrentRefreshWorkspaceKey() === requestedWorkspaceKey;
      const skipReason = resolveMcpStatusListRefreshSkipReason({
        input: requestedInput,
        requestedWorkspaceKey,
        trigger,
      });
      if (skipReason) {
        if (trigger === "manual") {
          logger.warn("[mcp] manual status refresh skipped", {
            reason: skipReason,
            workspacePath: requestedInput.activeWorkspacePath,
          });
        }
        return;
      }
      if (options?.mode === "status" && mcpStatusOnlyUnsupportedRef.current) {
        return;
      }
      const requestedWorkspacePath = requestedInput.activeWorkspacePath;
      if (!requestedWorkspacePath) return;
      const requestedMcpServers =
        options?.mcpServers ?? useMcpStore.getState().getEnabledMcpServersForCf("cf");
      await statusListRefreshQueueRef.current?.request(async () => {
        if (!isRequestCurrent()) {
          return;
        }
        if (options?.mode === "status" && mcpStatusOnlyUnsupportedRef.current) {
          return;
        }

        const outcome = await refreshMcpServerStatusList({
          beginServerStatusListRefresh,
          getCurrentWorkspaceKey: getCurrentRefreshWorkspaceKey,
          markServerStatusListRefreshFailed,
          mergeServerStatusSnapshots,
          mcpServers: requestedMcpServers,
          mode: options?.mode,
          requestedWorkspaceKey,
          workspaceIdentity: requestedInput.activeWorkspaceIdentity,
          workspacePath: requestedWorkspacePath,
          mcpSyncService: services.mcpSyncService,
        }).catch((error) => {
          logger.warn("[mcp] list server statuses failed", {
            error: error instanceof Error ? error.message : String(error),
            workspacePath: requestedWorkspacePath,
          });
          if (trigger === "manual") {
            const message = error instanceof Error ? error.message : String(error);
            toast(intl.formatMessage({ id: "settings.mcp.refreshFailed" }, { error: message }), {
              durationMs: 8_000,
            });
          }
          return "failed" as const;
        });
        if (outcome === "stale-workspace" || !isRequestCurrent()) {
          return;
        }
        if (outcome === "status-mode-unsupported") {
          mcpStatusOnlyUnsupportedRef.current = true;
          lastPendingMcpOAuthAuthorizationRefreshRef.current = null;
          setMcpOAuthAuthorizationFollowupRefresh(null);
          setMcpStatusOnlyUnsupported(true);
          logger.warn("[mcp] status-only refresh unsupported; stop OAuth status polling", {
            workspacePath: requestedWorkspacePath,
          });
          toast(intl.formatMessage({ id: "settings.mcp.statusOnlyUnsupported" }), {
            durationMs: 8_000,
          });
        } else if (outcome === "refreshed" && options?.mode !== "status") {
          mcpStatusOnlyUnsupportedRef.current = false;
          setMcpStatusOnlyUnsupported(false);
        }
      });
    },
    [
      activeWorkspaceKey,
      beginServerStatusListRefresh,
      intl,
      markServerStatusListRefreshFailed,
      mergeServerStatusSnapshots,
      services.mcpSyncService,
    ],
  );

  const [refreshingStatusList, setRefreshingStatusList] = useState(false);
  const handleManualRefresh = useCallback(async () => {
    if (refreshingStatusList) return;
    setRefreshingStatusList(true);
    try {
      await loadMcpFromUserDirectory(
        services.mcpSyncService,
        activeWorkspaceIdentity,
        cacheAuthorityKey,
      );
      if (activeWorkspacePath && !mcpConfigReadyWorkspaceKey) {
        const loaded = await ensureLoadedForWorkspace(
          activeWorkspacePath,
          services.mcpSyncService,
          activeWorkspaceIdentity,
          cacheAuthorityKey,
        );
        const state = useMcpStore.getState();
        const loadedWorkspaceKey = `${state.currentAuthorityKey?.trim() || "workspace"}\0${state.currentWorkspaceIdentity?.trim() || state.currentProjectPath}`;
        if (loaded && loadedWorkspaceKey === activeWorkspaceKey) {
          setMcpConfigReadyWorkspaceKey(activeWorkspaceKey);
          latestStatusListRefreshInputRef.current = {
            ...latestStatusListRefreshInputRef.current,
            configReadyWorkspaceKey: activeWorkspaceKey,
          };
        }
      }
      await requestMcpServerStatusList({ trigger: "manual" });
    } finally {
      setRefreshingStatusList(false);
    }
  }, [
    activeWorkspaceIdentity,
    activeWorkspaceKey,
    activeWorkspacePath,
    cacheAuthorityKey,
    ensureLoadedForWorkspace,
    loadMcpFromUserDirectory,
    mcpConfigReadyWorkspaceKey,
    refreshingStatusList,
    requestMcpServerStatusList,
    services.mcpSyncService,
  ]);

  useEffect(() => {
    lastPendingMcpOAuthAuthorizationRefreshRef.current = null;
    setMcpOAuthAuthorizationFollowupRefresh(null);
    mcpStatusOnlyUnsupportedRef.current = false;
    setMcpStatusOnlyUnsupported(false);
  }, [activeWorkspaceKey, services.mcpSyncService]);

  useEffect(() => {
    let cancelled = false;
    setMcpConfigReadyWorkspaceKey("");
    if (!activeWorkspacePath || !activeWorkspaceKey) {
      return;
    }

    void ensureLoadedForWorkspace(
      activeWorkspacePath,
      services.mcpSyncService,
      activeWorkspaceIdentity,
      cacheAuthorityKey,
    )
      .then((loaded) => {
        if (cancelled || !loaded) {
          return;
        }
        const state = useMcpStore.getState();
        const loadedWorkspaceKey = `${state.currentAuthorityKey?.trim() || "workspace"}\0${state.currentWorkspaceIdentity?.trim() || state.currentProjectPath}`;
        if (loadedWorkspaceKey === activeWorkspaceKey) {
          setMcpConfigReadyWorkspaceKey(activeWorkspaceKey);
        }
      })
      .catch((error) => {
        logger.warn("[mcp] load workspace config before status refresh failed", {
          error: error instanceof Error ? error.message : String(error),
          workspacePath: activeWorkspacePath,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeWorkspaceIdentity,
    activeWorkspaceKey,
    activeWorkspacePath,
    cacheAuthorityKey,
    ensureLoadedForWorkspace,
    services.mcpSyncService,
  ]);

  useEffect(() => {
    if (!activeWorkspacePath) {
      return;
    }
    void initializePlugins({
      pluginService: services.pluginManagementService,
      workspaceIdentity: activeWorkspaceIdentity,
      workspacePath: activeWorkspacePath,
      authorityKey: cacheAuthorityKey,
      configScope: scopeFilter,
    });
  }, [
    activeWorkspaceIdentity,
    activeWorkspacePath,
    cacheAuthorityKey,
    initializePlugins,
    scopeFilter,
    services.pluginManagementService,
  ]);

  useEffect(() => {
    const transition = transitionMcpAutoStatusListRefreshKey(
      lastAutoStatusListRefreshKeyRef.current,
      autoStatusListRefreshKey,
    );
    lastAutoStatusListRefreshKeyRef.current = transition.lastRefreshKey;
    if (!transition.shouldRefresh) {
      return;
    }
    void requestMcpServerStatusList();
  }, [autoStatusListRefreshKey, requestMcpServerStatusList]);

  useEffect(() => {
    if (!activeWorkspaceKey || mcpConfigReadyWorkspaceKey !== activeWorkspaceKey) {
      lastPendingMcpOAuthAuthorizationRefreshRef.current = null;
      setMcpOAuthAuthorizationFollowupRefresh(null);
      return;
    }
    const transition = transitionMcpOAuthAuthorizationPendingRefresh({
      activeWorkspaceKey,
      existingFollowup: mcpOAuthAuthorizationFollowupRefresh,
      mcpServers: pendingMcpOAuthAuthorizationRefreshServers,
      pendingKey: pendingMcpOAuthAuthorizationRefreshKey,
      previous: lastPendingMcpOAuthAuthorizationRefreshRef.current,
    });
    lastPendingMcpOAuthAuthorizationRefreshRef.current = transition.pending;
    setMcpOAuthAuthorizationFollowupRefresh(transition.followup);
  }, [
    activeWorkspaceKey,
    mcpConfigReadyWorkspaceKey,
    mcpOAuthAuthorizationFollowupRefresh,
    pendingMcpOAuthAuthorizationRefreshKey,
    pendingMcpOAuthAuthorizationRefreshServers,
  ]);

  useEffect(() => {
    if (
      !pendingMcpOAuthAuthorizationRefreshKey ||
      !activeWorkspaceKey ||
      mcpConfigReadyWorkspaceKey !== activeWorkspaceKey ||
      mcpStatusOnlyUnsupported
    ) {
      return;
    }

    let cancelled = false;
    let attempts = 0;
    let timeoutId: number | undefined;
    const deadline = pendingMcpOAuthAuthorizationRefreshDeadline;

    const scheduleNextRefresh = () => {
      if (cancelled || isMcpOAuthAuthorizationStatusRefreshExpired(deadline)) {
        return;
      }
      timeoutId = window.setTimeout(() => {
        if (cancelled || isMcpOAuthAuthorizationStatusRefreshExpired(deadline)) {
          return;
        }
        attempts += 1;
        logger.debug("[mcp] refresh status while OAuth authorization is pending", {
          attempt: attempts,
          deadline,
          pendingKey: pendingMcpOAuthAuthorizationRefreshKey,
          workspacePath: activeWorkspacePath,
        });
        void requestMcpServerStatusList(
          buildMcpOAuthAuthorizationStatusRefreshOptions(
            pendingMcpOAuthAuthorizationRefreshServers,
          ),
        ).finally(scheduleNextRefresh);
      }, MCP_OAUTH_AUTHORIZATION_STATUS_REFRESH_MS);
    };

    scheduleNextRefresh();

    return () => {
      cancelled = true;
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [
    activeWorkspacePath,
    activeWorkspaceKey,
    mcpConfigReadyWorkspaceKey,
    mcpStatusOnlyUnsupported,
    pendingMcpOAuthAuthorizationRefreshDeadline,
    pendingMcpOAuthAuthorizationRefreshKey,
    pendingMcpOAuthAuthorizationRefreshServers,
    requestMcpServerStatusList,
  ]);

  useEffect(() => {
    if (
      !mcpOAuthAuthorizationFollowupRefresh ||
      mcpOAuthAuthorizationFollowupRefresh.workspaceKey !== activeWorkspaceKey ||
      mcpConfigReadyWorkspaceKey !== activeWorkspaceKey ||
      mcpStatusOnlyUnsupported
    ) {
      return;
    }

    let cancelled = false;
    let attempts = 0;
    let timeoutId: number | undefined;

    const scheduleNextRefresh = () => {
      if (cancelled) {
        return;
      }
      if (attempts >= MCP_OAUTH_AUTHORIZATION_FOLLOWUP_REFRESH_ATTEMPTS) {
        setMcpOAuthAuthorizationFollowupRefresh((current) =>
          current?.refreshKey === mcpOAuthAuthorizationFollowupRefresh.refreshKey ? null : current,
        );
        return;
      }
      timeoutId = window.setTimeout(() => {
        attempts += 1;
        logger.debug("[mcp] refresh status after OAuth authorization state changed", {
          attempt: attempts,
          followupKey: mcpOAuthAuthorizationFollowupRefresh.refreshKey,
          workspacePath: activeWorkspacePath,
        });
        void requestMcpServerStatusList(
          buildMcpOAuthAuthorizationStatusRefreshOptions(
            mcpOAuthAuthorizationFollowupRefresh.mcpServers,
          ),
        ).finally(scheduleNextRefresh);
      }, MCP_OAUTH_AUTHORIZATION_STATUS_REFRESH_MS);
    };

    void requestMcpServerStatusList(
      buildMcpOAuthAuthorizationStatusRefreshOptions(
        mcpOAuthAuthorizationFollowupRefresh.mcpServers,
      ),
    ).finally(scheduleNextRefresh);

    return () => {
      cancelled = true;
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [
    activeWorkspacePath,
    activeWorkspaceKey,
    mcpConfigReadyWorkspaceKey,
    mcpOAuthAuthorizationFollowupRefresh,
    mcpStatusOnlyUnsupported,
    requestMcpServerStatusList,
  ]);

  useEffect(() => {
    if (
      !pendingMcpOAuthAuthorizationRefreshKey ||
      !activeWorkspaceKey ||
      mcpConfigReadyWorkspaceKey !== activeWorkspaceKey ||
      mcpStatusOnlyUnsupported
    ) {
      return;
    }

    const refreshAfterReturnFromBrowser = () => {
      logger.debug("[mcp] refresh status after returning from OAuth browser", {
        pendingKey: pendingMcpOAuthAuthorizationRefreshKey,
        workspacePath: activeWorkspacePath,
      });
      void requestMcpServerStatusList(
        buildMcpOAuthAuthorizationStatusRefreshOptions(pendingMcpOAuthAuthorizationRefreshServers),
      );
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshAfterReturnFromBrowser();
      }
    };

    window.addEventListener("focus", refreshAfterReturnFromBrowser);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", refreshAfterReturnFromBrowser);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    activeWorkspacePath,
    activeWorkspaceKey,
    mcpConfigReadyWorkspaceKey,
    mcpStatusOnlyUnsupported,
    pendingMcpOAuthAuthorizationRefreshKey,
    pendingMcpOAuthAuthorizationRefreshServers,
    requestMcpServerStatusList,
  ]);

  const scopedServers = useMemo(
    () =>
      servers.filter(
        (server) =>
          server.scope === scopeFilter || (scopeFilter === "user" && server.scope === "common"),
      ),
    [scopeFilter, servers],
  );
  const filteredServers = useMemo(
    () => filterLocalMcpServers(scopedServers, query),
    [query, scopedServers],
  );
  const connectedRemoteSyncTarget =
    shouldShowRemoteSyncActions({
      remoteSessionId,
      remoteTarget,
      clientMode: isWebRemoteControl ? "web-remote-replayable" : "desktop-continuous",
      hasLocalSourceService: Boolean(baseServices.mcpSyncService),
    }) && activeWorkspacePath
      ? remoteTarget
      : null;
  const isRemoteSyncContext = Boolean(connectedRemoteSyncTarget);
  const pluginMcpServers = useMemo(() => {
    if (!shouldShowPluginMcpServersInMcpSettings(isRemoteSyncContext)) {
      return [];
    }
    const pluginStoreWorkspaceKey = `${pluginStoreAuthorityKey?.trim() || "workspace"}\0${
      pluginStoreWorkspaceIdentity?.trim() || pluginStoreWorkspacePath || ""
    }`;
    const pluginStoreMatchesTarget =
      pluginStoreWorkspaceKey === activeWorkspaceKey && pluginConfigScope === scopeFilter;
    if (!pluginStoreMatchesTarget) {
      return [];
    }
    const scopedPlugins = selectPluginsForScope(plugins, installedPlugins, scopeFilter).filter(
      (plugin) => plugin.enabled,
    );
    return buildPluginMcpServerItems(scopedPlugins, query, statusSnapshots);
  }, [
    installedPlugins,
    activeWorkspaceKey,
    isRemoteSyncContext,
    pluginConfigScope,
    pluginStoreAuthorityKey,
    pluginStoreWorkspaceIdentity,
    pluginStoreWorkspacePath,
    plugins,
    query,
    scopeFilter,
    statusSnapshots,
  ]);
  const pluginListingById = useMemo(
    () => new Map(availablePlugins.map((plugin) => [plugin.id, plugin.listing])),
    [availablePlugins],
  );
  const filteredMcpCount = filteredServers.length + pluginMcpServers.length;
  const pluginMcpGroups = useMemo(
    () => groupPluginMcpServersByPlugin(pluginMcpServers),
    [pluginMcpServers],
  );
  const mcpProjectionReady =
    !activeWorkspacePath ||
    (mcpStoreMatchesActiveWorkspace && mcpConfigReadyWorkspaceKey === activeWorkspaceKey);
  const hasEmptySearchResult = Boolean(query.trim()) && filteredMcpCount === 0;
  const installedServers = useMemo(
    () =>
      filteredServers
        .map((server, index) => ({ index, server }))
        .toSorted((left, right) => {
          const leftAttention = Boolean(
            left.server.authorization?.authorizationUrl || left.server.status === "error",
          );
          const rightAttention = Boolean(
            right.server.authorization?.authorizationUrl || right.server.status === "error",
          );
          return Number(rightAttention) - Number(leftAttention) || left.index - right.index;
        })
        .map(({ server }) => server),
    [filteredServers],
  );
  const hideInstalledGroup = Boolean(query.trim()) && installedServers.length === 0;
  useEffect(() => {
    onVisibleCountChange?.(filteredMcpCount);
  }, [filteredMcpCount, onVisibleCountChange]);
  const remoteMcpSyncTargetLabel = connectedRemoteSyncTarget
    ? formatRemoteSkillSyncTarget(connectedRemoteSyncTarget, activeWorkspacePath ?? "")
    : "";

  async function handleToggle(id: string, enabled: boolean) {
    await toggleServer(id, enabled);

    if (!enabled) {
      updateServerStatus(id, "unknown", undefined, {
        invalidateStatusListRequests: false,
      });
      return;
    }

    if (!activeWorkspacePath) {
      updateServerStatus(id, "unknown", undefined, {
        invalidateStatusListRequests: false,
      });
      return;
    }
    updateServerStatus(id, "connecting", undefined, {
      invalidateStatusListRequests: false,
    });
    void requestMcpServerStatusList();
  }

  async function handleSave(form: FormState, prev?: CfMcpServer) {
    if (!activeWorkspacePath) {
      return;
    }
    const loaded = await ensureLoadedForWorkspace(
      activeWorkspacePath,
      services.mcpSyncService,
      activeWorkspaceIdentity,
      cacheAuthorityKey,
    );
    if (!loaded) {
      return;
    }
    const config = {
      ...formToConfig(form),
      ...(prev?.enabled === false ? { enable: false } : {}),
    };
    const projectPath = formScopeKey === "user" ? undefined : activeWorkspacePath;

    if (prev) {
      await updateScopedMcpServer(DEFAULT_MCP_SOURCE, prev.name, config, projectPath);
    } else {
      await addScopedMcpServer(DEFAULT_MCP_SOURCE, form.name, config, projectPath);
    }

    setShowForm(false);
    setEditingServer(null);
    onFormScopeKeyChange?.(null);
  }

  async function handleDelete(server: CfMcpServer) {
    const confirmed = await confirmDialog({
      confirmVariant: "destructive",
      title: intl.formatMessage({ id: "settings.mcp.deleteConfirmTitle" }, { name: server.name }),
      description: intl.formatMessage({
        id: "settings.mcp.deleteConfirmDescription",
      }),
      confirmLabel: intl.formatMessage({
        id: "settings.mcp.deleteConfirmAction",
      }),
      cancelLabel: intl.formatMessage({ id: "common.cancel" }),
    });

    if (!confirmed) {
      return;
    }

    await deleteScopedMcpServer(server.source, server.name, server.projectPath);
    setEditingServer(null);
    setShowForm(false);
    setEditorMode("form");
    onFormScopeKeyChange?.(null);
  }

  function handleEdit(server: CfMcpServer) {
    const ownerWorkspace = workspaceTabs.find((tab) => tab.workspacePath === server.projectPath);
    const ownedScopeKey =
      server.scope === "workspace"
        ? ownerWorkspace
          ? getPluginWorkspaceKey(ownerWorkspace)
          : parentScopeKey
        : "user";
    setFormScopeKey(ownedScopeKey);
    onFormScopeKeyChange?.(ownedScopeKey);
    setEditingServer(server);
    setShowForm(false);
    setEditorMode("form");
  }

  function handleCreate() {
    setFormScopeKey(parentScopeKey);
    onFormScopeKeyChange?.(parentScopeKey);
    setEditingServer(null);
    setEditorMode("form");
    setShowForm(true);
  }

  function handleOpenAuthorization(server: CfMcpServer) {
    const authorizationUrl = server.authorization?.authorizationUrl;
    if (!authorizationUrl) {
      return;
    }
    platform.openExternal(authorizationUrl);
  }

  function handleOpenPluginAuthorization(item: PluginMcpServerItem) {
    const authorizationUrl = item.authorization?.authorizationUrl;
    if (!authorizationUrl) {
      return;
    }
    platform.openExternal(authorizationUrl);
  }

  if (isFormView) {
    const closeFormView = () => {
      setShowForm(false);
      setEditingServer(null);
      setEditorMode("form");
      onFormScopeKeyChange?.(null);
    };
    const pluginsBreadcrumbLabel = intl.formatMessage({ id: "settings.plugins.title" });
    const formBreadcrumbLabel =
      editingServer?.name ?? intl.formatMessage({ id: "settings.mcp.form.createTitle" });
    return (
      <div className="space-y-6">
        <SettingsBreadcrumbReporter
          items={
            showMarketplaceBreadcrumb
              ? [
                  { label: pluginsBreadcrumbLabel, onSelect: closeFormView },
                  { label: formBreadcrumbLabel },
                ]
              : [{ label: formBreadcrumbLabel }]
          }
          onSectionSelect={
            showMarketplaceBreadcrumb && onOpenPluginStore ? onOpenPluginStore : closeFormView
          }
        />
        <div className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <h3 className="text-ui-xl font-semibold text-foreground">
                {editingServer
                  ? intl.formatMessage({ id: "settings.mcp.form.editTitle" })
                  : intl.formatMessage({ id: "settings.mcp.form.createTitle" })}
              </h3>
              <p className="text-ui-base text-foreground-subtle">
                {editingServer
                  ? intl.formatMessage({
                      id: "settings.mcp.form.editDescription",
                    })
                  : intl.formatMessage({
                      id: "settings.mcp.form.createDescription",
                    })}
              </p>
            </div>
            <div className="shrink-0 self-end">
              <SettingsSegmentedTabs
                value={editorMode}
                items={[
                  {
                    value: "form",
                    label: intl.formatMessage({
                      id: "settings.mcp.form.mode.form",
                    }),
                  },
                  { value: "json", label: "JSON" },
                ]}
                onValueChange={setEditorMode}
              />
            </div>
          </div>

          <McpServerForm
            initial={editingServer ?? undefined}
            editingId={editingServer?.id}
            editorMode={editorMode}
            source={editingServer?.source ?? DEFAULT_MCP_SOURCE}
            scopeKey={formScopeKey}
            workspaceTabs={workspaceTabs}
            onScopeKeyChange={(nextScopeKey) => {
              setFormScopeKey(nextScopeKey);
              onFormScopeKeyChange?.(nextScopeKey);
            }}
            onEditorModeChange={setEditorMode}
            onSave={handleSave}
            onDelete={editingServer ? handleDelete : undefined}
            onCancel={closeFormView}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {connectedRemoteSyncTarget ? (
        <div className="flex justify-end">
          <ControlHintTooltip title={intl.formatMessage({ id: "settings.mcp.remoteSync.open" })}>
            <Button
              type="button"
              variant="outline"
              size="icon-lg"
              aria-label={intl.formatMessage({
                id: "settings.mcp.remoteSync.open",
              })}
              onClick={() => setRemoteMcpSyncOpen(true)}
            >
              <UploadCloud className="size-3.5" aria-hidden="true" />
            </Button>
          </ControlHintTooltip>
        </div>
      ) : null}

      {connectedRemoteSyncTarget ? (
        <div className="rounded-lg border border-border bg-card px-3 py-2 text-ui-base text-foreground-subtle">
          {intl.formatMessage(
            { id: "settings.mcp.remoteContext" },
            { target: remoteMcpSyncTargetLabel },
          )}
        </div>
      ) : null}

      {!mcpProjectionReady ? (
        <PluginLoadingState label={intl.formatMessage({ id: "common.loading" })} />
      ) : hasEmptySearchResult ? (
        <PluginSearchEmptyState
          label={intl.formatMessage({
            id: "settings.plugin.mcp.searchEmpty",
          })}
        />
      ) : null}
      <div
        className={!mcpProjectionReady || hasEmptySearchResult ? "hidden" : "space-y-6"}
        data-mcp-list-layout="grouped"
      >
        <section
          className={hideInstalledGroup ? "hidden" : "space-y-4"}
          data-mcp-plugin-group="installed"
        >
          <div data-mcp-plugin-installed-actions="true">
            <SettingsResourceGroupHeader
              actions={
                <SettingsResourceHeaderActions
                  onRefresh={() => void handleManualRefresh()}
                  refreshing={refreshingStatusList}
                  onImport={() => setImportDialogOpen(true)}
                  onNew={handleCreate}
                  importActionId="settings.mcp.import.open"
                  newActionId="settings.mcp.create.open"
                />
              }
              count={installedServers.length}
              title={intl.formatMessage({
                id: "settings.plugin.mcp.installed",
              })}
            />
          </div>
          {installedServers.length > 0 ? (
            <McpServerList
              hideMetadata
              servers={installedServers}
              onCreate={handleCreate}
              onEdit={handleEdit}
              onToggle={handleToggle}
              onOpenAuthorization={handleOpenAuthorization}
              emptyTitle={intl.formatMessage({ id: "settings.mcp.emptyTitle" })}
              emptyDescription={intl.formatMessage({
                id: "settings.mcp.emptyDescription",
              })}
            />
          ) : scopedServers.length === 0 && !query.trim() ? (
            <PluginInstallEmptyState
              title={intl.formatMessage({
                id: "settings.plugin.mcp.emptyInstalledTitle",
              })}
              description={intl.formatMessage({
                id: "settings.plugin.mcp.emptyInstalledDescription",
              })}
              actions={
                <>
                  <Button
                    type="button"
                    variant="default"
                    size="lg"
                    onClick={() => {
                      handleCreate();
                    }}
                  >
                    <Plus data-icon="inline-start" aria-hidden="true" />
                    {intl.formatMessage({
                      id: "settings.plugin.mcp.newServer",
                    })}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    onClick={() => setImportDialogOpen(true)}
                  >
                    <Import data-icon="inline-start" aria-hidden="true" />
                    {intl.formatMessage({ id: "settings.mcp.import.action" })}
                  </Button>
                </>
              }
            />
          ) : null}
        </section>
        {pluginMcpGroups.map((group) => (
          <section
            key={group.pluginId}
            className="space-y-4"
            data-mcp-plugin-group={group.pluginId}
          >
            <SettingsResourceGroupHeader
              count={group.items.length}
              title={resolvePluginDisplayName(
                {
                  name: group.pluginName,
                  listing: pluginListingById.get(group.pluginId),
                },
                locale,
              )}
            />
            <PluginMcpServerList
              items={group.items}
              pluginListingById={pluginListingById}
              onOpenAuthorization={handleOpenPluginAuthorization}
            />
          </section>
        ))}
      </div>
      <McpServersImportDialog
        open={importDialogOpen && mcpStoreMatchesActiveWorkspace}
        workspacePath={currentProjectPath}
        workspaceIdentity={activeWorkspaceIdentity}
        settingsSyncService={services.settingsSyncService}
        onOpenChange={setImportDialogOpen}
        onImported={async () => {
          await loadMcpFromUserDirectory(
            services.mcpSyncService,
            activeWorkspaceIdentity,
            cacheAuthorityKey,
          );
        }}
      />
      <RemoteSyncDialogs
        canSyncSkills={false}
        canSyncMcp={Boolean(connectedRemoteSyncTarget && activeWorkspacePath)}
        skillOpen={false}
        mcpOpen={remoteMcpSyncOpen}
        onSkillOpenChange={() => {}}
        onMcpOpenChange={setRemoteMcpSyncOpen}
        localMcpSyncService={baseServices.mcpSyncService}
        remoteMcpSyncService={services.mcpSyncService}
        remoteTarget={connectedRemoteSyncTarget}
        skillWorkspacePath=""
        mcpWorkspacePath={activeWorkspacePath ?? ""}
        mcpLocalWorkspacePath={localWorkspacePath}
        onSkillsSynced={() => {}}
        onMcpSynced={async () => {
          const loaded = await loadMcpFromUserDirectory(
            services.mcpSyncService,
            activeWorkspaceIdentity,
            cacheAuthorityKey,
          );
          if (loaded) {
            await requestMcpServerStatusList();
          }
        }}
      />
    </div>
  );
}
