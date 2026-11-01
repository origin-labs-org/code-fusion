import type { CustomCommandRoot } from "../commands/index.js";
import type { HookEventName, HookMatcherConfig } from "../hooks/index.js";
import type { McpServerConfig } from "../interfaces/mcp.port.js";
import type { SkillRoot } from "../skills/index.js";
import type { ExecutionContext, TraceContext } from "../tracing/tracer.js";

export const CF_OFFICIAL_PLUGIN_MARKETPLACE = "cf-plugins-official";
export const CLAUDE_OFFICIAL_PLUGIN_MARKETPLACE = "claude-plugins-official";
export const CF_INLINE_PLUGIN_MARKETPLACE = "inline";
export const CF_PLUGIN_HOST_COMMAND = "__cf-plugin-host";

export const CF_DWF_CHILD_COMMAND = "__cf-dwf-child";

export function isOfficialMarketplaceId(id: string): boolean {
  return id === CF_OFFICIAL_PLUGIN_MARKETPLACE || id === CLAUDE_OFFICIAL_PLUGIN_MARKETPLACE;
}

export type PluginSource = "official" | "inline" | "cache";
export type PluginDiagnosticSeverity = "warning" | "error";

export type PluginDiagnosticCode =
  | "plugin_root_not_found"
  | "plugin_manifest_not_found"
  | "plugin_manifest_invalid"
  | "plugin_component_path_invalid"
  | "plugin_unsupported_component"
  | "plugin_skill_root_empty"
  | "plugin_mcp_read_failed"
  | "plugin_mcp_invalid"
  | "plugin_mcp_server_disabled"
  | "plugin_hook_read_failed"
  | "plugin_hook_invalid"
  | "plugin_hook_unsupported_event"
  | "plugin_dependency_invalid"
  | "plugin_dependency_missing"
  | "plugin_dependency_cycle"
  | "plugin_dependency_cross_marketplace"
  | "plugin_marketplace_invalid"
  | "plugin_marketplace_declaration_reserved"
  | "plugin_git_unavailable"
  | "plugin_archive_fetch_failed"
  | "plugin_marketplace_source_unsupported"
  | "plugin_validation_deferred"
  | "plugin_variable_missing"
  | "plugin_duplicate_id"
  | "plugin_not_found"
  | "plugin_ambiguous_name";

export interface PluginUserConfigOption {
  default?: string | number | boolean;
  description?: string;
  title?: string;
  required?: boolean;
  sensitive?: boolean;
  type?: "string" | "number" | "boolean" | "directory" | "file";
}

export type PluginOptionValue = string | number | boolean;
export type PluginOptionValues = Record<string, PluginOptionValue>;

export type PluginMarketplaceSourceConfig =
  | { source: "url"; headers?: Record<string, string>; url: string }
  | { path?: string; ref?: string; repo: string; source: "github"; sparsePaths?: string[] }
  | { path?: string; ref?: string; source: "git"; sparsePaths?: string[]; url: string }
  | { package: string; source: "npm" }
  | { source: "file"; path: string }
  | { source: "directory"; path: string };

export interface PluginMarketplaceConfig {
  source: PluginMarketplaceSourceConfig;
}

export interface PluginHookDetail {
  args?: string[];
  async?: boolean;
  command: string;
  event: HookEventName;
  matcher?: string;
  runnable: boolean;
  shell?: true | string;
  sourcePath: string;
  statusMessage?: string;
  timeout?: number;
  timeoutMs?: number;
  type: "command" | "process";
}

export type PluginComponentKind = "agent" | "command" | "skill" | "hook" | "mcp";

export interface PluginComponentItem {
  name: string;
  
  description?: string;
}

export interface PluginComponentGroup {
  kind: PluginComponentKind;
  items: PluginComponentItem[];
}

export interface PluginStoreListing {
  
  displayName?: string;
  displayNameI18n?: Record<string, string>;
  
  descriptionI18n?: Record<string, string>;
  
  icon?: string;
  category?: string;
  
  publisherType?: "official" | "community";
  author?: string;
  authorUrl?: string;
  homepage?: string;
  privacyPolicy?: string;
  termsOfService?: string;
  
  heroImage?: string;
  
  examplePrompts?: string[];
  examplePromptsI18n?: Record<string, string[]>;
  
  requiresPaidPlan?: boolean;
}

export interface PluginManifest {
  agents?: unknown;
  author?: unknown;
  channels?: unknown;
  commands?: unknown;
  dependencies?: unknown;
  description?: string;
  homepage?: string;
  hooks?: unknown;
  keywords?: unknown;
  license?: string;
  lspServers?: unknown;
  mcpServers?: unknown;
  name: string;
  outputStyles?: unknown;
  repository?: string;
  settings?: unknown;
  skills?: unknown;
  
  ui?: unknown;
  userConfig?: Record<string, PluginUserConfigOption>;
  version?: string;
}

export type PluginUiSurfaceAvailability = "session";

export type PluginUiSurfaceTitle = string | Record<string, string>;
export interface PluginUiSurfaceDefinition {
  id: string;
  title: PluginUiSurfaceTitle;
  icon?: string;
  
  server: string;
  
  declaredServer: string;
  
  resourceUri: string;
  availability: PluginUiSurfaceAvailability;
}

export interface PluginConfig {
  dirs: string[];
  enabled: boolean;
  enabledPlugins: Record<string, boolean>;
  extraKnownMarketplaces: Record<string, PluginMarketplaceConfig>;
  options: Record<string, PluginOptionValues>;
  suppressedBuiltins: string[];
}

export interface PluginMetadata {
  
  author?: string;
  authorUrl?: string;
  commandRootCount: number;
  
  components: PluginComponentGroup[];
  configuredOptions?: PluginOptionValues;
  dataPath: string;
  declaredMcpServerNames: string[];
  description?: string;
  enabled: boolean;
  
  homepage?: string;
  id: string;
  manifestPath: string;
  marketplace: string;
  mcpServerNames: string[];
  name: string;
  hookDetails: PluginHookDetail[];
  rootPath: string;
  skillCount: number;
  skillRootCount: number;
  source: PluginSource;
  
  uiSurfaces?: PluginUiSurfaceDefinition[];
  userConfig?: Record<string, PluginUserConfigOption>;
  version?: string;
}

export interface PluginDiagnostic {
  code: PluginDiagnosticCode;
  message: string;
  path?: string;
  pluginId?: string;
  severity: PluginDiagnosticSeverity;
}

// ============================================================
// ============================================================

export interface PluginReferenceCatalogEntry {
  
  pluginId: string;
  
  name: string;
  marketplace: string;
  
  enabled: boolean;
  
  conflictingPluginIds: string[];
  
  skillQualifiedNames: string[];
  
  mcpServerNames: string[];
  
  subagentNames: string[];
  
  rootPath: string;
  
  uiSurfaces?: PluginUiSurfaceDefinition[];
}

export interface PluginReferenceCatalog {
  plugins: PluginReferenceCatalogEntry[];
}

export interface PluginLoadOutcome {
  commandRoots: CustomCommandRoot[];
  diagnostics: PluginDiagnostic[];
  hooks: Partial<Record<HookEventName, HookMatcherConfig[]>>;
  mcpServers: Record<string, McpServerConfig>;
  
  pluginListingsById?: Record<string, PluginStoreListing>;
  plugins: PluginMetadata[];
  skillRoots: SkillRoot[];
}

export interface PluginDiscoverRequest {
  config: PluginConfig;
  env?: Record<string, string | undefined>;
  officialPluginsEnabledByDefault?: ReadonlySet<string>;
  officialPluginRoots?: string[];
  storageRoot: string;
  trace?: TraceContext;
  workingDirectory: string;
}

export interface PluginOperationOptions {
  context?: ExecutionContext;
  signal?: AbortSignal;
}

export interface PluginPort {
  discoverPlugins(
    request: PluginDiscoverRequest,
    options?: PluginOperationOptions,
  ): Promise<PluginLoadOutcome>;
}
