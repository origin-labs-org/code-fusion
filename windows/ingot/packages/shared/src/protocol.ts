import type { RemoteAssetInstallMode } from "./remoteAssetInstallMode.js";
import type { RemoteResourcePackageSelection } from "./remoteResourcePackages.js";
import type { ProviderFamilyDomain } from "./model-provider-family.js";
import type { ProviderFamilyConnectionSelectionSettings } from "./provider-family-connection-selection.js";
import type { CfProvider } from "./cf-task-types-core.js";
import type { WorkspacePurpose } from "./workspacePurpose.js";
import type { DynamicWorkflowMode } from "./dynamic-workflow-feature.js";
import type { EmbeddedBrowserViewportPreference } from "./browser-use/command-metadata.js";
import type { AppToolSearchMode } from "./app-runtime-preferences.js";

// ── Domain types ──

export interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  
  isSymbolicLink?: boolean;
}

export interface FileStat {
  path: string;
  type: "file" | "directory";
  
  size?: number;
  
  mtimeMs?: number;
}

export interface FileWatchEvent {
  
  dirPath: string;
  
  changedPath?: string;
}

export interface FileTextSlice {
  path: string;
  content: string;
  offset: number;
  bytesRead: number;
  totalBytes: number;
  truncated: boolean;
  isBinary: boolean;
}

export interface FileMediaPreview {
  path: string;
  mediaType: string;
  dataBase64: string;
  totalBytes: number;
}

export interface FileBinaryPreview {
  path: string;
  dataBase64: string;
  totalBytes: number;
}

export interface WorkspaceFileEntry {
  name: string;
  path: string;
  relativePath: string;
  type: "file" | "directory";
}

export interface SystemInfo {
  homedir: string;
  platform: string;
}

export type Locale = "zh-CN" | "en-US";

export type LocalePreference = "system" | Locale;

export type CfInteractionBehavior = "queue" | "guide";

export type ElectronReleaseChannel = "stable" | "preview";

export type IntegratedTerminalShellDialect = "cmd" | "git-bash";

export type IntegratedTerminalShellSelection =
  | { mode: "auto" }
  | {
      mode: "shell";
      dialect: IntegratedTerminalShellDialect;
      id: string;
      label: string;
      path: string;
    };

export interface IntegratedTerminalShellOption {
  dialect: IntegratedTerminalShellDialect;
  id: string;
  label: string;
  path: string;
  source: "system" | "path";
}

export const DEFAULT_LOCALE: Locale = "zh-CN";

// ── Workspace / Tab ──

export type TabId = string;

export interface TabState {
  id: TabId;
  
  workspacePath: string;
  
  label: string;
}

export interface SSHRemoteTargetSnapshot {
  kind: "ssh";
  host: string;
  port?: number;
  username: string;
  
  sshConfigAlias?: string;
  privateKeyPath?: string;
  assetInstallMode?: RemoteAssetInstallMode;
  resourcePackages?: RemoteResourcePackageSelection;
  
  passwordCredentialKey?: string;
  
  privateKeyPassphraseCredentialKey?: string;
}

export interface WSLRemoteTargetSnapshot {
  kind: "wsl";
  distro?: string;
  user?: string;
}

export interface DockerRemoteTargetSnapshot {
  kind: "docker";
  container: string;
}

export interface ServerRemoteTargetSnapshot {
  kind: "server";
  url: string;
  name?: string;
  workspacePath?: string;
  serverId?: string;
  
  tokenCredentialKey?: string;
}

export type RemoteTargetSnapshot =
  | SSHRemoteTargetSnapshot
  | WSLRemoteTargetSnapshot
  | DockerRemoteTargetSnapshot
  | ServerRemoteTargetSnapshot;

export interface RemoteWorkspaceSessionSnapshot {
  
  workspacePath: string;
  
  workspacePurpose?: WorkspacePurpose;
  
  localWorkspacePath?: string;
  
  workspaceIdentity?: string;
  
  target: RemoteTargetSnapshot;
  
  lastOpenedAt: number;
  
  lastConnectionStatus: "connected" | "failed";
  
  lastConnectionError?: string;
}

export interface LocalWorkspaceSessionEntry {
  kind: "local";
  workspacePath: string;
  
  workspacePurpose?: WorkspacePurpose;
}

export interface RemoteWorkspaceSessionEntry extends RemoteWorkspaceSessionSnapshot {
  kind: "remote";
}

export type PersistedWorkspaceSessionEntry =
  | LocalWorkspaceSessionEntry
  | RemoteWorkspaceSessionEntry;

// ── Process Monitor ──

export type ResourceUsageCategory = "base" | "builtin-plugin" | "community-plugin";

export type ResourceUsageBaseGroupKey = "main" | "gpu" | "renderer" | "host" | "cli" | "utility";

export interface ResourceUsageProcess {
  pid: number;
  
  name: string;
  category: ResourceUsageCategory;
  groupKey: string;
  groupLabel: string;
  cpuPercent: number;
  memoryBytes: number;
  
  sampled: boolean;
}

export type HostResourceUsageProcess = Omit<ResourceUsageProcess, "sampled">;

export interface ResourceUsageSnapshot {
  sampledAt: number;
  logicalCpuCount: number;
  system: {
    cpuPercent: number;
    memoryTotalBytes: number;
    memoryUsedBytes: number;
  };
  app: {
    cpuPercent: number;
    memoryBytes: number;
  };
  processes: ResourceUsageProcess[];
}

export interface AppSettings {
  
  startPlanRecommendationDismissed?: boolean;
  recentProjects: string[];
  locale: Locale;
  
  shortcutBindings?: Record<string, string[]>;
  
  localePreference?: LocalePreference;
  
  terminalInheritSystemProfile?: boolean;
  
  terminalFontFamily?: string;
  
  integratedTerminalShell?: IntegratedTerminalShellSelection;
  
  httpProxy?: string;
  
  httpProxyNoProxy?: string;
  
  httpProxyCaCertPath?: string;
  
  embeddedBrowserAllowInsecureCertificates?: boolean;
  
  embeddedBrowserViewportPreference?: EmbeddedBrowserViewportPreference;
  
  computerUseComposerEntryHidden?: boolean;
  
  taskAutoArchiveEnabled?: boolean;
  
  taskAutoArchiveResetVersion?: 1;
  
  taskAutoArchiveOlderThanDays?: number;
  
  closeToTrayOnWindows?: boolean;
  
  keepAwakeWhileRunning?: boolean;
  
  closeToTrayOnWindowsMigrationInitialized?: boolean;
  
  closeToTrayLinuxMigrationInitialized?: boolean;
  
  desktopZoomLevel?: number;
  
  desktopWindowSize?: {
    width: number;
    height: number;
    maximized: boolean;
  };
  
  desktopChromiumHardwareAccelerationEnabled?: boolean;
  
  messageStreamShowReasoning?: boolean;
  
  messageStreamShowReasoningMigrationInitialized?: boolean;
  
  messageStreamShowTodos?: boolean;
  
  toolGroupingExploreEnabled?: boolean;
  
  toolGroupingTerminalEnabled?: boolean;
  
  toolGroupingChangesEnabled?: boolean;
  
  cfInteractionBehavior?: CfInteractionBehavior;
  
  askUserQuestionAutoResolutionEnabled?: boolean;
  
  modelIoFullRetentionEnabled?: boolean;
  
  dynamicWorkflowMode?: DynamicWorkflowMode;
  
  enabledBuiltinAgentCliProviders?: CfProvider[];
  
  providerFamilyConnectionSelections?: ProviderFamilyConnectionSelectionSettings;
  
  providerFamilyDomain?: ProviderFamilyDomain;
  
  providerFamilyDomainUpdatedAt?: number;
  
  providerFamilyDomainMigrated?: boolean;
  
  nativeSearchEnhancementsEnabled?: boolean;
  
  toolSearchMode?: AppToolSearchMode;
  
  memoryEnabled?: boolean;
  onboardingOccupation?:
    | "office"
    | "developer"
    | "independent"
    | "infrastructure"
    | "product"
    | "design"
    | "student"
    | "creator"
    | "operations"
    | "marketing"
    | "finance"
    | "accounting"
    | "legal"
    | "other"
    | null;
  proactiveSuggestionsEnabled?: boolean;
  
  lastActiveWorkspace?: PersistedWorkspaceSessionEntry | null;
  
  lastWorkspaceSession?: PersistedWorkspaceSessionEntry[];
  
  remoteConversationWorkspaceBySourceServerId?: Record<
    string,
    {
      workspacePath: string;
      lastResolvedAt: number;
    }
  >;
  
  sourceServers?: import("./source-server/contracts.js").SourceServerRecord[];
  
  connectionProfiles?: import("./source-server/contracts.js").ConnectionProfile[];
  
  sourceServerWorkspaceHistory?: import("./source-server/contracts.js").SourceServerWorkspaceHistoryEntry[];
  
  remoteStartupAutoReconnectEnabled?: boolean;
  sourceServerDirectoryMigrationVersion?: 1;
  
  remoteBoundaryOnboardingVersion?: 2;
  
  remoteBoundaryIntroAcknowledgedVersion?: 1;
  
  lastActiveTabIndex?: number;
  
  lastActiveTaskByWorkspace?: Record<string, string>;
  
  dataBaseDir?: string;
  
  pendingPostUpdateReleaseNotes?: {
    version: string;
    title: string;
    markdown: string;
    releaseDate?: string;
    releaseNotesByLocale?: Partial<Record<Locale, { title: string; markdown: string }>>;
  };
  
  receivePreviewUpdates?: boolean;
  
  autoDownloadAndInstallUpdates?: boolean;
  
  skippedElectronUpdateVersions?: Partial<Record<ElectronReleaseChannel, string>>;
  
  settingsSyncFirstRunPromptHandled?: boolean;
  
  
  webRemoteControlRelayV2Device?: {
    deviceSid: string;
    userId: string;
    endpointOrigin: string;
  };
  webRemoteControlExternalRelayDevice?: {
    deviceSid: string;
  };
  
  webRemoteControlLastEnabledContext?: {
    workspacePath: string;
    workspaceIdentity?: string;
    initialTaskId?: string;
  };
  
  cfEndpointOrigin?: string;
}
