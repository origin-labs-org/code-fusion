
/**
 * MCP (Model Context Protocol) UI State Store
 */
import { create } from "zustand";
import type {
  CfAgentMcpServer,
  CliMcpSource,
  McpConfig,
  McpScope,
  McpServerConfig,
  McpServerStatus,
  McpSource,
  NativeMcpServerRecord,
  CfMcpListMode,
  CfMcpServerStatusSnapshot,
  CfMcpServer,
} from "@origin-ai/cf-shared";
import { convertToCfAgentMcpServer } from "@origin-ai/cf-shared";
import { logger } from "@/logger.js";
import {
  fetchNativeMcpServers,
  migrateLegacyCommonMcpFromDesktop,
  persistCliMcpToUserDirectory,
  type McpDirectoryService,
  type McpPlatformService,
  type MigrateLegacyResult,
} from "@/store/mcpStoreDesktop.js";
import {
  importLegacyCommonServersToCfAgent,
  migrateStoredCommonMcpToCfAgent,
} from "@/store/mcpStoreMigration.js";
import {
  buildServerList,
  DEFAULT_MCP_CONFIG,
  getServerPriority,
  loadPersistedConfig,
  makeServerId,
  MCP_DELETED_PRELOAD_KEY,
  safeReadJson,
  safeWriteJson,
} from "@/store/mcpStoreHelpers.js";
import { isRemoteWorkspaceDisconnectedError } from "@/lib/remoteWorkspaceServiceError.js";
import { mergeMcpServerStatusSnapshots } from "@/store/mcpStoreStatusList.js";

let mcpPlatformService: McpPlatformService | null = null;
let mcpDirectoryService: McpDirectoryService | null = null;

export function setMcpStorePlatform(platform: McpPlatformService | null): void {
  mcpPlatformService = platform;
}

export function setMcpStoreDirectoryService(service: McpDirectoryService | null): void {
  mcpDirectoryService = service;
}

interface UpdateServerStatusOptions {
  invalidateStatusListRequests?: boolean;
}

interface McpStoreState {
  config: McpConfig;
  nativeServers: NativeMcpServerRecord[];
  servers: CfMcpServer[];
  statusSnapshots: Record<string, CfMcpServerStatusSnapshot>;
  currentProjectPath: string;
  currentWorkspaceIdentity?: string;
  currentAuthorityKey?: string;
  enabledStates: Record<string, boolean>;
  deletedPreloadMcpServers: Set<string>;
  isConfigLoaded: boolean;
  currentSessionId: string | null;
  loadConfig: () => void;
  loadMcpFromUserDirectory: (
    directoryService?: McpDirectoryService | null,
    workspaceIdentity?: string,
    authorityKey?: string,
  ) => Promise<boolean>;
  ensureLoadedForWorkspace: (
    workspacePath?: string,
    directoryService?: McpDirectoryService | null,
    workspaceIdentity?: string,
    authorityKey?: string,
  ) => Promise<boolean>;
  saveConfig: () => void;
  addMcpServer: (name: string, config: McpServerConfig) => void;
  updateMcpServer: (name: string, config: McpServerConfig) => void;
  deleteMcpServer: (name: string) => void;
  addScopedMcpServer: (source: McpSource, name: string, config: McpServerConfig, projectPath?: string) => Promise<void>;
  updateScopedMcpServer: (source: McpSource, name: string, config: McpServerConfig, projectPath?: string) => Promise<void>;
  deleteScopedMcpServer: (source: McpSource, name: string, projectPath?: string) => void;
  addCfAgentMcpServer: (name: string, config: McpServerConfig, projectPath?: string) => void;
  updateCfAgentMcpServer: (name: string, config: McpServerConfig, projectPath?: string) => void;
  deleteCfAgentMcpServer: (name: string, projectPath?: string) => void;
  addClaudeCliMcpServer: (name: string, config: McpServerConfig, projectPath?: string) => void;
  updateClaudeCliMcpServer: (name: string, config: McpServerConfig, projectPath?: string) => void;
  deleteClaudeCliMcpServer: (name: string, projectPath?: string) => void;
  addGeminiCliMcpServer: (name: string, config: McpServerConfig, projectPath?: string) => void;
  updateGeminiCliMcpServer: (name: string, config: McpServerConfig, projectPath?: string) => void;
  deleteGeminiCliMcpServer: (name: string, projectPath?: string) => void;
  addCodexCliMcpServer: (name: string, config: McpServerConfig, projectPath?: string) => void;
  updateCodexCliMcpServer: (name: string, config: McpServerConfig, projectPath?: string) => void;
  deleteCodexCliMcpServer: (name: string, projectPath?: string) => void;
  addOpenCodeMcpServer: (name: string, config: McpServerConfig, projectPath?: string) => void;
  updateOpenCodeMcpServer: (name: string, config: McpServerConfig, projectPath?: string) => void;
  deleteOpenCodeMcpServer: (name: string, projectPath?: string) => void;
  toggleServer: (id: string, enabled: boolean) => Promise<void>;
  updateServerStatus: (
    id: string,
    status: McpServerStatus,
    error?: string,
    options?: UpdateServerStatusOptions,
  ) => void;
  beginServerStatusListRefresh: (mode?: CfMcpListMode) => number;
  markServerStatusListRefreshFailed: (
    error: string,
    requestEpoch: number,
    mode?: CfMcpListMode,
  ) => void;
  mergeServerStatusSnapshots: (
    statuses: Record<string, CfMcpServerStatusSnapshot>,
    requestEpoch: number,
    mode?: "connect" | "status",
  ) => void;
  getServer: (id: string) => CfMcpServer | undefined;
  setCurrentProjectPath: (
    path: string,
    workspaceIdentity?: string,
    directoryService?: McpDirectoryService | null,
    authorityKey?: string,
  ) => void;
  getEnabledMcpServersForCf: (provider: string) => CfAgentMcpServer[];
  checkAllServerStatus: (tester: (config: McpServerConfig) => Promise<{ success: boolean; error?: string }>) => Promise<void>;
  mergePreloadedMcpServers: (preloaded: Record<string, McpServerConfig>) => void;
  deletePreloadedMcpServer: (source: McpSource, name: string) => void;
  setCurrentSessionId: (sessionId: string | null) => void;
  migrateLegacyCommonMcp: () => Promise<MigrateLegacyResult>;
}

export const useMcpStore = create<McpStoreState>((set, get) => {
  let loadMcpPromise: Promise<boolean> | null = null;
  let loadMcpWorkspaceKey: string | null = null;
  const statusListEpochs: Record<CfMcpListMode, number> = {
    connect: 0,
    status: 0,
  };

  function invalidateStatusListRequests(): void {
    statusListEpochs.connect += 1;
    statusListEpochs.status += 1;
  }

  function resolveMcpDirectoryService(
    directoryService?: McpDirectoryService | null,
    workspaceIdentity?: string | null,
  ): McpDirectoryService | null {
    const effectiveWorkspaceIdentity = workspaceIdentity ?? get().currentWorkspaceIdentity;
    if (!effectiveWorkspaceIdentity?.trim()) {
      return null;
    }
    return directoryService ?? mcpDirectoryService;
  }

  function commitState(partial: { config?: McpConfig; nativeServers?: NativeMcpServerRecord[] }): Partial<McpStoreState> {
    const state = get();
    const nextConfig = partial.config ?? state.config;
    const nextNativeServers = partial.nativeServers ?? state.nativeServers;
    return {
      config: nextConfig,
      nativeServers: nextNativeServers,
      servers: buildServerList(nextConfig, nextNativeServers, state.enabledStates, state.deletedPreloadMcpServers, state.servers),
    };
  }

  function updateNativeServer(source: CliMcpSource, name: string, config: McpServerConfig, projectPath?: string) {
    const nativeServers = get().nativeServers.slice();
    const targetIndex = nativeServers.findIndex((server) => server.source === source && server.name === name && server.projectPath === projectPath);
    if (targetIndex >= 0) {
      const existing = nativeServers[targetIndex];
      if (!existing) {
        return;
      }
      nativeServers[targetIndex] = {
        ...existing,
        config,
      };
    } else {
      const scope: McpScope = projectPath ? "workspace" : "user";
      nativeServers.push({
        source,
        scope,
        name,
        config,
        enabled: true,
        projectPath,
      });
    }
    set(commitState({ nativeServers }));
  }

  async function persistScopedChange(
    source: McpSource,
    payload: { action: "upsert" | "delete"; source: CliMcpSource; name: string; config?: McpServerConfig; projectPath?: string },
  ): Promise<void> {
    if (source === "mcp") {
      return;
    }

    await persistCliMcpToUserDirectory(
      mcpPlatformService,
      payload,
      resolveMcpDirectoryService(),
    ).catch((error) => {
      logger.warn(`[mcpStore] persist ${source} MCP failed`, String(error));
    });
  }

  return {
    config: { ...DEFAULT_MCP_CONFIG },
    nativeServers: [],
    servers: [],
    statusSnapshots: {},
    currentProjectPath: "",
    currentWorkspaceIdentity: undefined,
    currentAuthorityKey: undefined,
    enabledStates: {},
    deletedPreloadMcpServers: new Set(),
    isConfigLoaded: false,
    currentSessionId: null,

    loadConfig: () => {
      const config = loadPersistedConfig();
      const enabledStates: Record<string, boolean> = {};
      const deletedPreload = new Set<string>(safeReadJson<string[]>(MCP_DELETED_PRELOAD_KEY, []));
      const servers = buildServerList(config, [], enabledStates, deletedPreload, []);
      set({ config, nativeServers: [], enabledStates, deletedPreloadMcpServers: deletedPreload, servers, statusSnapshots: {}, isConfigLoaded: true });
    },

    loadMcpFromUserDirectory: async (directoryService, workspaceIdentity, authorityKey) => {
      if (typeof window === "undefined") {
        return false;
      }

      const requestWorkspacePath = get().currentProjectPath || undefined;
      const requestWorkspaceIdentity = workspaceIdentity ?? get().currentWorkspaceIdentity;
      const requestAuthorityKey = authorityKey ?? get().currentAuthorityKey;
      const requestWorkspaceKey = `${requestAuthorityKey?.trim() || "workspace"}\0${requestWorkspaceIdentity?.trim() || requestWorkspacePath || ""}`;
      if (loadMcpPromise && loadMcpWorkspaceKey === requestWorkspaceKey) {
        return await loadMcpPromise;
      }
      if (loadMcpPromise) {
        await loadMcpPromise;
      }

      const latestWorkspacePath = get().currentProjectPath || undefined;
      const latestWorkspaceIdentity = get().currentWorkspaceIdentity;
      const latestAuthorityKey = get().currentAuthorityKey;
      const latestWorkspaceKey = `${latestAuthorityKey?.trim() || "workspace"}\0${latestWorkspaceIdentity?.trim() || latestWorkspacePath || ""}`;
      if (latestWorkspaceKey !== requestWorkspaceKey) {
        return false;
      }
      const activeDirectoryService = resolveMcpDirectoryService(
        directoryService,
        latestWorkspaceIdentity,
      );
      if (loadMcpPromise && loadMcpWorkspaceKey === latestWorkspaceKey) {
        return await loadMcpPromise;
      }

      loadMcpWorkspaceKey = latestWorkspaceKey;
      loadMcpPromise = (async () => {
        try {
          logger.info(
            `[mcpStore] loadMcpFromUserDirectory workspace=${latestWorkspacePath ?? "<none>"} identity=${latestWorkspaceIdentity ?? "<none>"}`,
          );
          let servers = await fetchNativeMcpServers(
            mcpPlatformService,
            { workspacePath: latestWorkspacePath },
            activeDirectoryService,
          );
          if (!activeDirectoryService) {
            servers = await migrateStoredCommonMcpToCfAgent(
              mcpPlatformService,
              servers,
              latestWorkspacePath,
            );
          }
          const currentState = get();
          const currentWorkspaceKey = `${currentState.currentAuthorityKey?.trim() || "workspace"}\0${currentState.currentWorkspaceIdentity?.trim() || currentState.currentProjectPath}`;
          if (currentWorkspaceKey !== latestWorkspaceKey) {
            return false;
          }
          set(commitState({ nativeServers: servers }));
          return true;
        } catch (e) {
          if (!isRemoteWorkspaceDisconnectedError(e)) {
            logger.warn("[mcpStore] loadMcpFromUserDirectory failed", String(e));
          }
          return false;
        } finally {
          loadMcpPromise = null;
          loadMcpWorkspaceKey = null;
        }
      })();

      return await loadMcpPromise;
    },

    ensureLoadedForWorkspace: async (workspacePath, directoryService, workspaceIdentity, authorityKey) => {
      if (!get().isConfigLoaded) {
        get().loadConfig();
      }

      const normalizedWorkspacePath = workspacePath ?? "";
      const normalizedWorkspaceIdentity = workspaceIdentity?.trim() || undefined;
      const normalizedAuthorityKey = authorityKey?.trim() || undefined;
      if (
        normalizedWorkspacePath !== get().currentProjectPath ||
        normalizedWorkspaceIdentity !== get().currentWorkspaceIdentity ||
        normalizedAuthorityKey !== get().currentAuthorityKey
      ) {
        get().setCurrentProjectPath(
          normalizedWorkspacePath,
          normalizedWorkspaceIdentity,
          directoryService,
          normalizedAuthorityKey,
        );
      }

      return await get().loadMcpFromUserDirectory(
        directoryService,
        normalizedWorkspaceIdentity,
        normalizedAuthorityKey,
      );
    },

    saveConfig: () => {
      const { deletedPreloadMcpServers } = get();
      safeWriteJson(MCP_DELETED_PRELOAD_KEY, Array.from(deletedPreloadMcpServers));
    },

    addMcpServer: (name, config) => get().addCfAgentMcpServer(name, config),
    updateMcpServer: (name, config) => get().updateCfAgentMcpServer(name, config),
    deleteMcpServer: (name) => get().deleteCfAgentMcpServer(name),
    addScopedMcpServer: async (source, name, config, projectPath) => {
      invalidateStatusListRequests();
      const targetSource: CliMcpSource = source === "mcp" ? "cfagentmcp" : source;
      await persistScopedChange(targetSource, { action: "upsert", source: targetSource, name, config, projectPath });
      updateNativeServer(targetSource, name, config, projectPath);
    },
    updateScopedMcpServer: async (source, name, config, projectPath) => {
      invalidateStatusListRequests();
      const targetSource: CliMcpSource = source === "mcp" ? "cfagentmcp" : source;
      await persistScopedChange(targetSource, { action: "upsert", source: targetSource, name, config, projectPath });
      updateNativeServer(targetSource, name, config, projectPath);
    },
    deleteScopedMcpServer: (source, name, projectPath) => {
      invalidateStatusListRequests();
      const targetSource: CliMcpSource = source === "mcp" ? "cfagentmcp" : source;
      persistScopedChange(targetSource, { action: "delete", source: targetSource, name, projectPath });
      set(commitState({
        nativeServers: get().nativeServers.filter((server) => !(server.source === targetSource && server.name === name && server.projectPath === projectPath)),
      }));
    },
    addClaudeCliMcpServer: (name, config, projectPath) => get().addScopedMcpServer("claudeclimcp", name, config, projectPath),
    updateClaudeCliMcpServer: (name, config, projectPath) => get().updateScopedMcpServer("claudeclimcp", name, config, projectPath),
    deleteClaudeCliMcpServer: (name, projectPath) => get().deleteScopedMcpServer("claudeclimcp", name, projectPath),
    addGeminiCliMcpServer: (name, config, projectPath) => get().addScopedMcpServer("geminiclimcp", name, config, projectPath),
    updateGeminiCliMcpServer: (name, config, projectPath) => get().updateScopedMcpServer("geminiclimcp", name, config, projectPath),
    deleteGeminiCliMcpServer: (name, projectPath) => get().deleteScopedMcpServer("geminiclimcp", name, projectPath),
    addCodexCliMcpServer: (name, config, projectPath) => get().addScopedMcpServer("codexclimcp", name, config, projectPath),
    updateCodexCliMcpServer: (name, config, projectPath) => get().updateScopedMcpServer("codexclimcp", name, config, projectPath),
    deleteCodexCliMcpServer: (name, projectPath) => get().deleteScopedMcpServer("codexclimcp", name, projectPath),
    addOpenCodeMcpServer: (name, config, projectPath) => get().addScopedMcpServer("opencodemcp", name, config, projectPath),
    updateOpenCodeMcpServer: (name, config, projectPath) => get().updateScopedMcpServer("opencodemcp", name, config, projectPath),
    deleteOpenCodeMcpServer: (name, projectPath) => get().deleteScopedMcpServer("opencodemcp", name, projectPath),
    addCfAgentMcpServer: (name, config, projectPath) => get().addScopedMcpServer("cfagentmcp", name, config, projectPath),
    updateCfAgentMcpServer: (name, config, projectPath) => get().updateScopedMcpServer("cfagentmcp", name, config, projectPath),
    deleteCfAgentMcpServer: (name, projectPath) => get().deleteScopedMcpServer("cfagentmcp", name, projectPath),

    toggleServer: async (id, enabled) => {
      invalidateStatusListRequests();
      const targetServer = get().servers.find((server) => server.id === id);
      if (targetServer && targetServer.source !== "mcp") {
        await persistCliMcpToUserDirectory(mcpPlatformService, {
          action: "set-enabled",
          source: targetServer.source,
          name: targetServer.name,
          enabled,
          projectPath: targetServer.projectPath,
          location: targetServer.location,
        }, resolveMcpDirectoryService()).catch((error) => {
          logger.warn("[mcpStore] persist MCP enabled override failed", String(error));
        });
      }

      set((state) => {
        const nextEnabledStates = { ...state.enabledStates, [id]: enabled };
        return {
          enabledStates: nextEnabledStates,
          servers: state.servers.map((s) => (s.id === id ? { ...s, enabled } : s)),
        };
      });
    },

    updateServerStatus: (id, status, error, options) => {
      if (options?.invalidateStatusListRequests !== false) {
        invalidateStatusListRequests();
      }
      set((state) => ({
        servers: state.servers.map((s) =>
          s.id === id
            ? {
                ...s,
                status,
                authorization: undefined,
                error,
                failureKind: status === "error" ? "connection_failed" : undefined,
                serverRequestId: undefined,
                toolCount: status === "connected" ? s.toolCount : undefined,
                changed: status === "error" ? s.changed : false,
                lastConnected: status === "connected" ? new Date() : s.lastConnected,
              }
            : s,
        ),
      }));
    },

    beginServerStatusListRefresh: (mode = "connect") => {
      statusListEpochs[mode] += 1;
      const requestEpoch = statusListEpochs[mode];
      if (mode === "status") {
        return requestEpoch;
      }
      set((state) => ({
        servers: state.servers.map((server) => {
          const enabled = state.enabledStates[server.id] ?? server.enabled;
          if (
            server.source !== "cfagentmcp" ||
            !enabled ||
            (!server.changed && server.status !== "unknown")
          ) {
            return server;
          }
          return {
            ...server,
            status: "connecting",
            authorization: undefined,
            error: undefined,
            failureKind: undefined,
            serverRequestId: undefined,
            toolCount: undefined,
          };
        }),
      }));
      return requestEpoch;
    },

    markServerStatusListRefreshFailed: (error, requestEpoch, mode = "connect") => {
      if (requestEpoch !== statusListEpochs[mode] || mode === "status") {
        return;
      }
      set((state) => ({
        statusSnapshots: {},
        servers: state.servers.map((server) => {
          const enabled = state.enabledStates[server.id] ?? server.enabled;
          if (
            server.source !== "cfagentmcp" ||
            !enabled ||
            server.status !== "connecting"
          ) {
            return server;
          }
          return {
            ...server,
            status: "error",
            authorization: undefined,
            error,
            failureKind: "status_unavailable",
            serverRequestId: undefined,
            toolCount: undefined,
          };
        }),
      }));
    },

    mergeServerStatusSnapshots: (statuses, requestEpoch, mode = "connect") => {
      if (requestEpoch !== statusListEpochs[mode]) {
        return;
      }
      set((state) => {
        const nextStatusSnapshots =
          mode === "status"
            ? { ...state.statusSnapshots, ...statuses }
            : statuses;
        return {
          statusSnapshots: nextStatusSnapshots,
          servers: mergeMcpServerStatusSnapshots(
            state.servers,
            nextStatusSnapshots,
            {
              markMissingConnectingAsError: mode !== "status",
            },
          ),
        };
      });
    },

    getServer: (id) => get().servers.find((s) => s.id === id),

    setCurrentProjectPath: (path, workspaceIdentity, directoryService, authorityKey) => {
      invalidateStatusListRequests();
      const {
        config,
        currentProjectPath,
        currentWorkspaceIdentity,
        currentAuthorityKey,
        deletedPreloadMcpServers,
        enabledStates,
        isConfigLoaded,
        nativeServers,
        servers,
      } = get();
      const normalizedWorkspaceIdentity = workspaceIdentity?.trim() || undefined;
      const normalizedAuthorityKey = authorityKey?.trim() || undefined;
      const workspaceChanged =
        path !== currentProjectPath ||
        normalizedWorkspaceIdentity !== currentWorkspaceIdentity ||
        normalizedAuthorityKey !== currentAuthorityKey;
      const nextNativeServers = workspaceChanged ? [] : nativeServers;
      set({
        currentProjectPath: path,
        currentWorkspaceIdentity: normalizedWorkspaceIdentity,
        currentAuthorityKey: normalizedAuthorityKey,
        nativeServers: nextNativeServers,
        statusSnapshots: {},
        servers: buildServerList(
          config,
          nextNativeServers,
          enabledStates,
          deletedPreloadMcpServers,
          workspaceChanged ? [] : servers,
        ),
      });
      if (isConfigLoaded && workspaceChanged) {
        void get().loadMcpFromUserDirectory(directoryService, normalizedWorkspaceIdentity, normalizedAuthorityKey);
      }
    },

    getEnabledMcpServersForCf: (_provider) => {
      const { servers, enabledStates, currentProjectPath } = get();
      const candidates = new Map<string, CfMcpServer>();

      for (const server of servers) {
        const isEnabled = enabledStates[server.id] ?? server.enabled;
        if (!isEnabled) continue;
        if (server.source !== "cfagentmcp") continue;
        if (server.scope === "workspace" && server.projectPath !== currentProjectPath) continue;

        const existing = candidates.get(server.name);
        if (!existing || getServerPriority(server) > getServerPriority(existing)) {
          candidates.set(server.name, server);
        }
      }

      const result: CfAgentMcpServer[] = [];
      for (const server of candidates.values()) {
        const cfAgentServer = convertToCfAgentMcpServer(server.name, server.config);
        if (cfAgentServer) result.push(cfAgentServer);
      }
      return result;
    },

    checkAllServerStatus: async (tester) => {
      for (const server of get().servers) {
        const isEnabled = get().enabledStates[server.id] ?? server.enabled;
        if (!isEnabled || (!server.changed && server.status !== "unknown")) continue;

        get().updateServerStatus(server.id, "connecting");
        try {
          const result = await tester(server.config);
          get().updateServerStatus(server.id, result.success ? "connected" : "error", result.success ? undefined : (result.error ?? "Connection failed"));
        } catch (e) {
          get().updateServerStatus(server.id, "error", String(e));
        }
      }
    },

    mergePreloadedMcpServers: (preloaded) => {
      const { deletedPreloadMcpServers, nativeServers } = get();
      const targetSource: CliMcpSource = "cfagentmcp";
      const nextNativeServers = nativeServers.slice();
      let changed = false;

      for (const [name, cfg] of Object.entries(preloaded)) {
        const serverId = makeServerId(targetSource, name);
        const exists = nextNativeServers.some((server) => server.source === targetSource && server.name === name && !server.projectPath);
        if (deletedPreloadMcpServers.has(serverId) || exists) continue;
        nextNativeServers.push({
          source: targetSource,
          scope: "user",
          name,
          config: cfg,
          enabled: true,
        });
        persistScopedChange(targetSource, { action: "upsert", source: targetSource, name, config: cfg });
        changed = true;
      }

      if (!changed) return;
      set(commitState({ nativeServers: nextNativeServers }));
    },

    deletePreloadedMcpServer: (source, name) => {
      const targetSource: CliMcpSource = source === "mcp" ? "cfagentmcp" : source;
      const key = makeServerId(targetSource, name);
      persistScopedChange(targetSource, { action: "delete", source: targetSource, name });
      set((state) => {
        const nextDeleted = new Set(state.deletedPreloadMcpServers);
        nextDeleted.add(key);
        safeWriteJson(MCP_DELETED_PRELOAD_KEY, Array.from(nextDeleted));
        const nextNativeServers = state.nativeServers.filter((server) => !(server.source === targetSource && server.name === name && !server.projectPath));
        return {
          deletedPreloadMcpServers: nextDeleted,
          nativeServers: nextNativeServers,
          servers: buildServerList(state.config, nextNativeServers, state.enabledStates, nextDeleted, state.servers),
        };
      });
    },

    setCurrentSessionId: (sessionId) => set({ currentSessionId: sessionId }),

    migrateLegacyCommonMcp: async () => {
      const result = await migrateLegacyCommonMcpFromDesktop(mcpPlatformService);
      const latestWorkspacePath = get().currentProjectPath || undefined;
      const currentNativeServers = get().nativeServers.length > 0
        ? get().nativeServers
        : await fetchNativeMcpServers(mcpPlatformService, { workspacePath: latestWorkspacePath });
      const migration = await importLegacyCommonServersToCfAgent(mcpPlatformService, result.servers ?? {}, currentNativeServers, result.sourcePath);
      if (migration.changed) {
        const servers = await fetchNativeMcpServers(mcpPlatformService, { workspacePath: latestWorkspacePath });
        set(commitState({ nativeServers: servers }));
      }
      return migration;
    },
  };
});
