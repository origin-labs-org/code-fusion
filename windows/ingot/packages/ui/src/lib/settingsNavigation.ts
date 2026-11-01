
import { logger } from "@/logger.js";

export type SettingsSectionId =
  | "general"
  | "appearance"
  | "migration"
  | "browser"
  | "modelProvider"
  | "remoteDevices"
  | "memory"
  | "plugin"
  | "mcp"
  | "skill"
  | "plugins"
  | "archives"
  | "usage"
  | "subagents"
  | "commands"
  | "hooks"
  | "workspaceFileSearch"
  | "computerUse"
  | "automations"
  | "shortcuts"
  | "about";

export type SettingsUsageTabTarget = "app" | "codingPlan";
export type SettingsPluginTabTarget = "plugins" | "mcps" | "skills" | "commands";
export type SettingsPluginNavigationOrigin = "plugin-store";

const SETTINGS_SECTION_INTENT_KEY = "cf-settings-section-intent",
  SETTINGS_USAGE_TAB_INTENT_KEY = "cf-settings-usage-tab-intent",
  SETTINGS_PLUGIN_TAB_INTENT_KEY = "cf-settings-plugin-tab-intent",
  SETTINGS_PLUGIN_ORIGIN_INTENT_KEY = "cf-settings-plugin-origin-intent",
  SETTINGS_PLUGIN_SCOPE_KEY_INTENT_KEY = "cf-settings-plugin-scope-key-intent";
const SETTINGS_SOURCE_SERVER_ID_INTENT_KEY = "cf-settings-source-server-id-intent";
const SETTINGS_SOURCE_SERVER_DETAILS_INTENT_KEY = "cf-settings-source-server-details-intent";
const SETTINGS_MODEL_PROVIDER_ID_INTENT_KEY = "cf-settings-model-provider-id-intent";
const SETTINGS_SECTION_INTENT_EVENT = "cf:settings-section-intent",
  SETTINGS_LAST_SECTION_STORAGE_KEY = "cf-settings-last-section";
const HIDDEN_SETTINGS_SECTIONS = new Set<SettingsSectionId>([
  "automations",
  "plugins",
  "workspaceFileSearch",
]);

export interface SettingsSectionIntentEventDetail {
  section: SettingsSectionId;
  pluginTab?: SettingsPluginTabTarget;
  pluginOrigin?: SettingsPluginNavigationOrigin;
  pluginScopeKey?: string;
  usageTab?: SettingsUsageTabTarget;
  modelProviderId?: string;
  sourceServerId?: string;
  sourceServerDetails?: boolean;
}

export interface SettingsModelProviderTarget {
  providerId: string;
}

function isSettingsSectionId(value: string): value is SettingsSectionId {
  return (
    value === "general" ||
    value === "appearance" ||
    value === "migration" ||
    value === "browser" ||
    value === "modelProvider" ||
    value === "remoteDevices" ||
    value === "memory" ||
    value === "plugin" ||
    value === "mcp" ||
    value === "skill" ||
    value === "plugins" ||
    value === "archives" ||
    value === "usage" ||
    value === "subagents" ||
    value === "commands" ||
    value === "hooks" ||
    value === "workspaceFileSearch" ||
    value === "computerUse" ||
    value === "automations" ||
    value === "shortcuts" ||
    value === "about"
  );
}

export function isSettingsSectionEnabled(section: SettingsSectionId): boolean {
  return !HIDDEN_SETTINGS_SECTIONS.has(section);
}

export function resolveSettingsSection(
  section: SettingsSectionId,
  fallbackSection: SettingsSectionId = "general",
): SettingsSectionId {
  if (section === "plugins") return "plugin";
  return isSettingsSectionEnabled(section) ? section : fallbackSection;
}

function getLocalStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch (error) {
    logger.warn("[settingsNavigation] localStorage is unavailable", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export function readLastSettingsSectionPreference(
  fallbackSection: SettingsSectionId = "general",
): SettingsSectionId {
  const storage = getLocalStorage();
  if (!storage) {
    return fallbackSection;
  }

  try {
    const raw = storage.getItem(SETTINGS_LAST_SECTION_STORAGE_KEY);
    if (raw === "plugins") {
      storage.setItem(SETTINGS_LAST_SECTION_STORAGE_KEY, "plugin");
      setPendingPluginTab("plugins");
      return "plugin";
    }
    if (raw === "skills") {
      storage.setItem(SETTINGS_LAST_SECTION_STORAGE_KEY, "skill");
      return "skill";
    }
    if (raw === "codePreview") {
      storage.setItem(SETTINGS_LAST_SECTION_STORAGE_KEY, "appearance");
      return "appearance";
    }
    if (raw && isSettingsSectionId(raw)) {
      return resolveSettingsSection(raw, fallbackSection);
    }
    if (raw !== null) {
      storage.removeItem(SETTINGS_LAST_SECTION_STORAGE_KEY);
    }
  } catch (error) {
    logger.warn("[settingsNavigation] Failed to read last settings section", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return fallbackSection;
}

export function writeLastSettingsSectionPreference(section: SettingsSectionId): void {
  const resolvedSection = resolveSettingsSection(section);
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(SETTINGS_LAST_SECTION_STORAGE_KEY, resolvedSection);
  } catch (error) {
    logger.warn("[settingsNavigation] Failed to write last settings section", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function consumeInitialSettingsSection(
  fallbackSection: SettingsSectionId = "general",
): SettingsSectionId {
  const lastSection = readLastSettingsSectionPreference(fallbackSection);
  return resolveSettingsSection(consumePendingSettingsSection(lastSection), lastSection);
}

export function setPendingSettingsSection(section: SettingsSectionId): void {
  setPendingSettingsSectionIntent(section);
}

export function setPendingSettingsUsageIntent(): void {
  setPendingSettingsSectionIntent("usage");
}

export function setPendingSettingsUsageCodingPlanIntent(): void {
  setPendingSettingsSectionIntent("usage", { usageTab: "codingPlan" });
}

export function setPendingSettingsPluginIntent(
  tab: SettingsPluginTabTarget,
  options: {
    origin?: SettingsPluginNavigationOrigin;
    scopeKey?: string;
  } = {},
): void {
  const section =
    tab === "mcps"
      ? "mcp"
      : tab === "skills"
        ? "skill"
        : tab === "commands"
          ? "commands"
          : "plugin";
  setPendingSettingsSectionIntent(section, {
    pluginTab: tab === "plugins" ? tab : undefined,
    pluginOrigin: options.origin,
    pluginScopeKey: options.scopeKey,
  });
}

export function setPendingSettingsSectionIntent(
  section: SettingsSectionId,
  options: {
    pluginTab?: SettingsPluginTabTarget;
    pluginOrigin?: SettingsPluginNavigationOrigin;
    pluginScopeKey?: string;
    modelProviderId?: string;
    sourceServerId?: string;
    sourceServerDetails?: boolean;
    usageTab?: SettingsUsageTabTarget;
  } = {},
): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(SETTINGS_SECTION_INTENT_KEY, section);
    if (options.pluginTab) {
      window.sessionStorage.setItem(SETTINGS_PLUGIN_TAB_INTENT_KEY, options.pluginTab);
    } else {
      window.sessionStorage.removeItem(SETTINGS_PLUGIN_TAB_INTENT_KEY);
    }
    if (options.pluginOrigin) {
      window.sessionStorage.setItem(SETTINGS_PLUGIN_ORIGIN_INTENT_KEY, options.pluginOrigin);
    } else {
      window.sessionStorage.removeItem(SETTINGS_PLUGIN_ORIGIN_INTENT_KEY);
    }
    const normalizedPluginScopeKey = options.pluginScopeKey?.trim();
    if (normalizedPluginScopeKey) {
      window.sessionStorage.setItem(SETTINGS_PLUGIN_SCOPE_KEY_INTENT_KEY, normalizedPluginScopeKey);
    } else {
      window.sessionStorage.removeItem(SETTINGS_PLUGIN_SCOPE_KEY_INTENT_KEY);
    }
    if (options.usageTab) {
      window.sessionStorage.setItem(SETTINGS_USAGE_TAB_INTENT_KEY, options.usageTab);
    }
    if (section === "remoteDevices" && options.sourceServerId?.trim()) {
      window.sessionStorage.setItem(
        SETTINGS_SOURCE_SERVER_ID_INTENT_KEY,
        options.sourceServerId.trim(),
      );
    } else {
      window.sessionStorage.removeItem(SETTINGS_SOURCE_SERVER_ID_INTENT_KEY);
    }
    if (
      section === "remoteDevices" &&
      options.sourceServerId?.trim() &&
      options.sourceServerDetails
    ) {
      window.sessionStorage.setItem(SETTINGS_SOURCE_SERVER_DETAILS_INTENT_KEY, "true");
    } else {
      window.sessionStorage.removeItem(SETTINGS_SOURCE_SERVER_DETAILS_INTENT_KEY);
    }
    if (options.modelProviderId) {
      window.sessionStorage.setItem(SETTINGS_MODEL_PROVIDER_ID_INTENT_KEY, options.modelProviderId);
    } else {
      window.sessionStorage.removeItem(SETTINGS_MODEL_PROVIDER_ID_INTENT_KEY);
    }
  } catch {
  }

  window.dispatchEvent(
    new CustomEvent<SettingsSectionIntentEventDetail>(SETTINGS_SECTION_INTENT_EVENT, {
      detail: {
        section,
        pluginTab: options.pluginTab,
        pluginOrigin: options.pluginOrigin,
        pluginScopeKey: options.pluginScopeKey?.trim() || undefined,
        usageTab: options.usageTab,
        modelProviderId: options.modelProviderId,
        ...(section === "remoteDevices" && options.sourceServerId?.trim()
          ? {
              sourceServerId: options.sourceServerId.trim(),
              ...(options.sourceServerDetails ? { sourceServerDetails: true } : {}),
            }
          : {}),
      },
    }),
  );
}

function clearPendingSettingsSectionIntent(): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.removeItem(SETTINGS_SECTION_INTENT_KEY);
    window.sessionStorage.removeItem(SETTINGS_SOURCE_SERVER_ID_INTENT_KEY);
    window.sessionStorage.removeItem(SETTINGS_SOURCE_SERVER_DETAILS_INTENT_KEY);
    window.sessionStorage.removeItem(SETTINGS_USAGE_TAB_INTENT_KEY);
    window.sessionStorage.removeItem(SETTINGS_MODEL_PROVIDER_ID_INTENT_KEY);
    window.sessionStorage.removeItem(SETTINGS_PLUGIN_TAB_INTENT_KEY);
    window.sessionStorage.removeItem(SETTINGS_PLUGIN_ORIGIN_INTENT_KEY);
    window.sessionStorage.removeItem(SETTINGS_PLUGIN_SCOPE_KEY_INTENT_KEY);
  } catch {
  }
}

export function consumePendingSettingsSection(
  fallbackSection: SettingsSectionId = "general",
): SettingsSectionId {
  if (typeof window === "undefined") {
    return fallbackSection;
  }

  try {
    const raw = window.sessionStorage.getItem(SETTINGS_SECTION_INTENT_KEY);
    if (raw !== null) {
      window.sessionStorage.removeItem(SETTINGS_SECTION_INTENT_KEY);
    }

    if (raw === "skills") {
      return "skill";
    }
    if (raw && isSettingsSectionId(raw)) {
      return resolveSettingsSection(raw, fallbackSection);
    }
  } catch {
  }

  return fallbackSection;
}

function setPendingPluginTab(tab: SettingsPluginTabTarget): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(SETTINGS_PLUGIN_TAB_INTENT_KEY, tab);
  } catch {
  }
}

export function consumePendingSettingsPluginTab(): SettingsPluginTabTarget | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.sessionStorage.getItem(SETTINGS_PLUGIN_TAB_INTENT_KEY);
    window.sessionStorage.removeItem(SETTINGS_PLUGIN_TAB_INTENT_KEY);
    return raw === "plugins" || raw === "mcps" || raw === "skills" ? raw : undefined;
  } catch {
    return undefined;
  }
}

export function consumePendingSettingsPluginOrigin(): SettingsPluginNavigationOrigin | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.sessionStorage.getItem(SETTINGS_PLUGIN_ORIGIN_INTENT_KEY);
    return raw === "plugin-store" ? raw : undefined;
  } catch {
    return undefined;
  }
}

export function consumePendingSettingsPluginScopeKey(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.sessionStorage.getItem(SETTINGS_PLUGIN_SCOPE_KEY_INTENT_KEY);
    return raw?.trim() || undefined;
  } catch {
    return undefined;
  }
}

export function clearPendingSettingsPluginScopeKey(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(SETTINGS_PLUGIN_SCOPE_KEY_INTENT_KEY);
  } catch {
  }
}

export function clearPendingSettingsPluginOrigin(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(SETTINGS_PLUGIN_ORIGIN_INTENT_KEY);
  } catch {
  }
}

export function consumePendingSettingsUsageTab(): SettingsUsageTabTarget | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    const raw = window.sessionStorage.getItem(SETTINGS_USAGE_TAB_INTENT_KEY);
    if (raw !== null) {
      window.sessionStorage.removeItem(SETTINGS_USAGE_TAB_INTENT_KEY);
    }
    return raw === "app" || raw === "codingPlan" ? raw : undefined;
  } catch {
    return undefined;
  }
}

export function consumePendingSettingsModelProviderTarget():
  | SettingsModelProviderTarget
  | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    const providerId = window.sessionStorage.getItem(SETTINGS_MODEL_PROVIDER_ID_INTENT_KEY);
    window.sessionStorage.removeItem(SETTINGS_MODEL_PROVIDER_ID_INTENT_KEY);
    if (!providerId?.trim()) {
      return undefined;
    }
    return {
      providerId: providerId.trim(),
    };
  } catch {
    return undefined;
  }
}

export function shouldFallbackSettingsUsageTabToApp({
  activeTab,
  checkingCodingPlanTab,
  loadingModelProviders,
  showCodingPlanTab,
}: {
  activeTab: SettingsUsageTabTarget;
  checkingCodingPlanTab: boolean;
  loadingModelProviders: boolean;
  showCodingPlanTab: boolean;
}): boolean {
  return (
    activeTab === "codingPlan" &&
    !showCodingPlanTab &&
    !loadingModelProviders &&
    !checkingCodingPlanTab
  );
}

export function addPendingSettingsSectionListener(
  listener: (section: SettingsSectionId, detail?: SettingsSectionIntentEventDetail) => void,
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleIntent = (event: Event) => {
    const detail = (event as CustomEvent<SettingsSectionIntentEventDetail>).detail;
    if (detail?.section && isSettingsSectionId(detail.section)) {
      clearPendingSettingsSectionIntent();
      listener(detail.section, detail);
    }
  };

  window.addEventListener(SETTINGS_SECTION_INTENT_EVENT, handleIntent);
  return () => {
    window.removeEventListener(SETTINGS_SECTION_INTENT_EVENT, handleIntent);
  };
}

export function consumePendingSettingsSourceServerId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const id = window.sessionStorage.getItem(SETTINGS_SOURCE_SERVER_ID_INTENT_KEY);
    window.sessionStorage.removeItem(SETTINGS_SOURCE_SERVER_ID_INTENT_KEY);
    return id?.trim() || undefined;
  } catch {
    return undefined;
  }
}

export function consumePendingSettingsSourceServerDetails(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const details = window.sessionStorage.getItem(SETTINGS_SOURCE_SERVER_DETAILS_INTENT_KEY);
    window.sessionStorage.removeItem(SETTINGS_SOURCE_SERVER_DETAILS_INTENT_KEY);
    return details === "true";
  } catch {
    return false;
  }
}
