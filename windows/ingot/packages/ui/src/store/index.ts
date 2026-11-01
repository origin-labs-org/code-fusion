
import { create } from "zustand";
import type { IBroadcastService, BroadcastMessage } from "@origin-ai/cf-services";
import type { OAuthProviderId, UserInfo } from "@origin-ai/cf-shared";
import type { CodingPlanResetType } from "@origin-ai/cf-shared";
import type { CodePreviewSettings } from "@/lib/codePreviewSettings.js";
import type {
  CodingPlanQuotaResetUiEntries,
  CodingPlanQuotaResetUiEntry,
} from "@/lib/codingPlanQuotaResetUi.js";
import {
  applyCodingPlanQuotaResetAutoPlayedBroadcast,
  createCodingPlanQuotaResetStoreActions,
  parseCodingPlanQuotaResetAutoPlayedBroadcastMessage,
  type CodingPlanQuotaResetAutomaticObservations,
  type CodingPlanQuotaResetAutoPlayReservation,
  type CodingPlanQuotaResetAutoPlayReservationAttempt,
  type CodingPlanQuotaResetAutoPlayedSlot,
} from "@/store/codingPlanQuotaResetState.js";
import { DEFAULT_CODE_PREVIEW_SETTINGS } from "@/lib/codePreviewSettings.js";
import { readSafeLocalStorage, writeSafeLocalStorage } from "@/lib/browserEnvironment.js";
import {
  applyUiFontSizePx,
  loadUiFontSizePx,
  normalizeUiFontSizePx,
  UI_FONT_SIZE_STORAGE_KEY,
} from "@/lib/uiFontSize.js";
import {
  isTaskNotificationEnabled,
  isTaskNotificationSoundPreferenceEnabled,
  persistTaskNotificationEnabled,
  persistTaskNotificationSoundEnabled,
} from "@/lib/taskNotificationPreferences.js";
import type { Theme } from "../useTheme.js";
import { applyTheme, normalizeThemePreference, resolveTheme } from "../useTheme.js";

import {
  INTERFACE_MODE_STORAGE_KEY,
  normalizeInterfaceMode,
  type InterfaceMode,
} from "@/lib/interfaceMode.js";
import { logger } from "@/logger.js";

export type LoginEntryPurpose = "app-login";

export type { CodePreviewSettings } from "@/lib/codePreviewSettings.js";
export { DEFAULT_CODE_PREVIEW_SETTINGS } from "@/lib/codePreviewSettings.js";

export type LoginEntryAttemptStatus =
  | "requested"
  | "waiting"
  | "succeeded"
  | "cancelled"
  | "failed";

export interface LoginEntryAttempt {
  id: number;
  providerId?: OAuthProviderId;
  purpose?: LoginEntryPurpose;
  status: LoginEntryAttemptStatus;
}

const CODE_PREVIEW_SETTINGS_KEY = "cf-code-preview-settings";
const PERFORMANCE_MODE_STORAGE_KEY = "cf-performance-mode";
export const FILE_MANAGER_NAVIGATION_PREFERENCES_STORAGE_KEY =
  "cf-file-manager-navigation-preferences";

function loadFileManagerNavigationPreferences(): Record<string, boolean> {
  try {
    const raw = readSafeLocalStorage(FILE_MANAGER_NAVIGATION_PREFERENCES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, boolean] =>
          entry[0].trim().length > 0 && typeof entry[1] === "boolean",
      ),
    );
  } catch {
    return {};
  }
}

function loadCodePreviewSettings(): CodePreviewSettings {
  try {
    const raw = readSafeLocalStorage(CODE_PREVIEW_SETTINGS_KEY);
    if (!raw) {
      return DEFAULT_CODE_PREVIEW_SETTINGS;
    }

    const parsed = JSON.parse(raw) as Partial<CodePreviewSettings>;
    return {
      ...DEFAULT_CODE_PREVIEW_SETTINGS,
      ...parsed,
      fontSizePx:
        typeof parsed.fontSizePx === "number"
          ? Math.min(20, Math.max(12, Math.round(parsed.fontSizePx)))
          : DEFAULT_CODE_PREVIEW_SETTINGS.fontSizePx,
    };
  } catch {
    return DEFAULT_CODE_PREVIEW_SETTINGS;
  }
}

function loadPerformanceMode(): boolean {
  return readSafeLocalStorage(PERFORMANCE_MODE_STORAGE_KEY) === "true";
}

// ============================================================================
// ============================================================================

export interface CfState {
  
  interfaceMode: InterfaceMode;
  setInterfaceMode: (mode: InterfaceMode) => void;

  
  theme: Theme;
  setTheme: (theme: Theme) => void;

  
  locale: string;
  setLocale: (locale: string) => void;

  
  codePreviewSettings: CodePreviewSettings;
  setCodePreviewSettings: (patch: Partial<CodePreviewSettings>) => void;

  
  fileManagerNavigationOpenByWorkspace: Record<string, boolean>;
  setFileManagerNavigationOpen: (workspaceKey: string, open: boolean) => void;

  
  uiFontSizePx: number;
  setUiFontSizePx: (fontSizePx: number) => void;

  
  performanceMode: boolean;
  setPerformanceMode: (enabled: boolean) => void;

  
  notificationEnabled: boolean;
  setNotificationEnabled: (enabled: boolean) => void;

  
  notificationSoundEnabled: boolean;
  setNotificationSoundEnabled: (enabled: boolean) => void;

  
  user: UserInfo | null;
  
  authSessionSeq: number;
  setUser: (user: UserInfo | null) => void;

  
  isRestoringOAuthSession: boolean;
  setIsRestoringOAuthSession: (restoring: boolean) => void;

  
  oauthError: string | null;
  setOAuthError: (error: string | null) => void;
  oauthPollingActive: boolean;
  setOAuthPollingActive: (active: boolean) => void;
  oauthSuccessSeq: number;
  lastOAuthSuccessProvider: OAuthProviderId | null;
  markOAuthSuccess: (provider?: OAuthProviderId) => void;
  apiKeyLoginSuccessSeq: number;
  lastApiKeyLoginModel: string | null;
  markApiKeyLoginSuccess: (preferredModel?: string | null) => void;
  
  loginEntryRequest: {
    id: number;
    providerId?: OAuthProviderId;
    purpose?: LoginEntryPurpose;
  } | null;
  
  loginEntryAttempt: LoginEntryAttempt | null;
  requestLoginEntry: (providerId?: OAuthProviderId, purpose?: LoginEntryPurpose) => number;
  clearLoginEntryRequest: (requestId?: number) => void;
  markLoginEntryAttemptStatus: (
    requestId: number,
    status: Exclude<LoginEntryAttemptStatus, "requested">,
  ) => void;

  
  codingPlanQuotaResetUiBySource: Record<string, CodingPlanQuotaResetUiEntries>;
  
  codingPlanQuotaResetAutomaticObservationsBySource: Record<
    string,
    CodingPlanQuotaResetAutomaticObservations
  >;
  
  codingPlanQuotaResetAutoPlayedBySource: Record<string, CodingPlanQuotaResetAutoPlayedSlot>;
  
  setCodingPlanQuotaResetUiEntry: (
    sourceKey: string,
    resetType: CodingPlanResetType,
    entry: CodingPlanQuotaResetUiEntry | null,
    authSessionSeq: number,
  ) => void;
  
  reserveCodingPlanQuotaResetAutoPlay: (
    sourceKey: string,
    resetType: CodingPlanResetType,
    completedAt: number,
  ) => Promise<CodingPlanQuotaResetAutoPlayReservationAttempt>;
  
  commitCodingPlanQuotaResetAutoPlay: (
    reservation: CodingPlanQuotaResetAutoPlayReservation,
  ) => boolean;
  
  releaseCodingPlanQuotaResetAutoPlay: (
    reservation: CodingPlanQuotaResetAutoPlayReservation,
  ) => Promise<void>;

  
  newUserOnboardingOpen: boolean;
  setNewUserOnboardingOpen: (open: boolean) => void;
  onboardingDialogRequested: boolean | "migration";
  requestOnboardingDialog: (entry?: "migration") => void;
  clearOnboardingDialogRequest: () => void;
}

// ============================================================================
// ============================================================================

const BROADCAST_FIELDS = new Set([
  "theme",
  "locale",
  "uiFontSizePx",
  "interfaceMode",
  "notificationEnabled",
]);

type BroadcastField =
  | "theme"
  | "locale"
  | "uiFontSizePx"
  | "interfaceMode"
  | "notificationEnabled";

const STATE_CHANNEL_PREFIX = "state:";

// ============================================================================
// ============================================================================

export function createCfStore(
  broadcastService: IBroadcastService,
  options: {
    initialIsRestoringOAuthSession?: boolean;
  } = {},
) {
  
  let applyingBroadcast = false;
  let loginEntryRequestSeq = 0;
  let cleanupSystemThemeListener: (() => void) | null = null;
  let syncSystemThemeListener = (_theme: Theme) => {};

  const useStore = create<CfState>()((set, get) => ({
    interfaceMode: normalizeInterfaceMode(readSafeLocalStorage(INTERFACE_MODE_STORAGE_KEY)),
    setInterfaceMode: (mode) => {
      const interfaceMode = normalizeInterfaceMode(mode);
      if (get().interfaceMode !== interfaceMode) {
        logger.debug("[InterfaceMode] 切换界面模式", {
          interfaceMode,
          source: applyingBroadcast ? "broadcast" : "local",
        });
      }
      writeSafeLocalStorage(INTERFACE_MODE_STORAGE_KEY, interfaceMode);
      set({ interfaceMode });
    },
    theme: normalizeThemePreference((readSafeLocalStorage("cf-theme") as Theme) || "cf-dark"),
    setTheme: (theme: Theme) => {
      const normalizedTheme = normalizeThemePreference(theme);
      writeSafeLocalStorage("cf-theme", normalizedTheme);
      syncSystemThemeListener(normalizedTheme);
      applyTheme(normalizedTheme);

      set({ theme: normalizedTheme });
    },

    locale: readSafeLocalStorage("cf-locale") || "zh-CN",
    setLocale: (locale: string) => {
      writeSafeLocalStorage("cf-locale", locale);
      set({ locale });
    },

    codePreviewSettings: loadCodePreviewSettings(),
    setCodePreviewSettings: (patch: Partial<CodePreviewSettings>) =>
      set((state) => {
        const next = {
          ...state.codePreviewSettings,
          ...patch,
          fontSizePx:
            typeof patch.fontSizePx === "number"
              ? Math.min(20, Math.max(12, Math.round(patch.fontSizePx)))
              : state.codePreviewSettings.fontSizePx,
        };
        writeSafeLocalStorage(CODE_PREVIEW_SETTINGS_KEY, JSON.stringify(next));
        return { codePreviewSettings: next };
      }),

    fileManagerNavigationOpenByWorkspace: loadFileManagerNavigationPreferences(),
    setFileManagerNavigationOpen: (workspaceKey, open) => {
      const normalizedWorkspaceKey = workspaceKey.trim();
      if (!normalizedWorkspaceKey) return;
      set((state) => {
        const next = {
          ...state.fileManagerNavigationOpenByWorkspace,
          [normalizedWorkspaceKey]: open,
        };
        writeSafeLocalStorage(
          FILE_MANAGER_NAVIGATION_PREFERENCES_STORAGE_KEY,
          JSON.stringify(next),
        );
        return { fileManagerNavigationOpenByWorkspace: next };
      });
    },

    uiFontSizePx: loadUiFontSizePx(),
    setUiFontSizePx: (fontSizePx: number) => {
      const normalizedFontSizePx = normalizeUiFontSizePx(fontSizePx);
      writeSafeLocalStorage(UI_FONT_SIZE_STORAGE_KEY, String(normalizedFontSizePx));
      applyUiFontSizePx(normalizedFontSizePx);
      set({ uiFontSizePx: normalizedFontSizePx });
    },

    performanceMode: loadPerformanceMode(),
    setPerformanceMode: (enabled: boolean) => {
      writeSafeLocalStorage(PERFORMANCE_MODE_STORAGE_KEY, enabled ? "true" : "false");
      set({ performanceMode: enabled });
    },

    notificationEnabled: isTaskNotificationEnabled(),
    setNotificationEnabled: (enabled: boolean) => {
      persistTaskNotificationEnabled(enabled);
      set({ notificationEnabled: enabled });
    },

    notificationSoundEnabled: isTaskNotificationSoundPreferenceEnabled(),
    setNotificationSoundEnabled: (enabled: boolean) => {
      persistTaskNotificationSoundEnabled(enabled);
      set({ notificationSoundEnabled: enabled });
    },

    user: null,
    authSessionSeq: 0,
    setUser: (user: UserInfo | null) =>
      set((state) => ({
        user,
        authSessionSeq:
          state.user === null && user !== null ? state.authSessionSeq + 1 : state.authSessionSeq,
      })),

    isRestoringOAuthSession: options.initialIsRestoringOAuthSession ?? false,
    setIsRestoringOAuthSession: (restoring: boolean) => set({ isRestoringOAuthSession: restoring }),

    oauthError: null,
    setOAuthError: (error: string | null) => set({ oauthError: error }),
    oauthPollingActive: false,
    setOAuthPollingActive: (active: boolean) => set({ oauthPollingActive: active }),
    oauthSuccessSeq: 0,
    lastOAuthSuccessProvider: null,
    markOAuthSuccess: (provider?: OAuthProviderId) =>
      set((state) => ({
        oauthSuccessSeq: state.oauthSuccessSeq + 1,
        lastOAuthSuccessProvider: provider ?? state.lastOAuthSuccessProvider,
      })),
    apiKeyLoginSuccessSeq: 0,
    lastApiKeyLoginModel: null,
    markApiKeyLoginSuccess: (preferredModel?: string | null) =>
      set((state) => ({
        apiKeyLoginSuccessSeq: state.apiKeyLoginSuccessSeq + 1,
        lastApiKeyLoginModel: preferredModel?.trim() || null,
      })),
    loginEntryRequest: null,
    loginEntryAttempt: null,
    requestLoginEntry: (providerId?: OAuthProviderId, purpose?: LoginEntryPurpose) => {
      const id = ++loginEntryRequestSeq;
      const attempt: LoginEntryAttempt = {
        id,
        providerId,
        purpose,
        status: "requested",
      };
      set({
        loginEntryRequest: {
          id,
          providerId,
          purpose,
        },
        loginEntryAttempt: attempt,
      });
      return id;
    },
    clearLoginEntryRequest: (requestId?: number) =>
      set((state) => {
        if (requestId !== undefined && state.loginEntryRequest?.id !== requestId) {
          return {};
        }
        return { loginEntryRequest: null };
      }),
    markLoginEntryAttemptStatus: (requestId, status) =>
      set((state) => {
        if (state.loginEntryAttempt?.id !== requestId) {
          return {};
        }
        return {
          loginEntryAttempt: {
            ...state.loginEntryAttempt,
            status,
          },
        };
      }),

    codingPlanQuotaResetUiBySource: {},
    codingPlanQuotaResetAutomaticObservationsBySource: {},
    codingPlanQuotaResetAutoPlayedBySource: {},
    ...createCodingPlanQuotaResetStoreActions({
      broadcastService,
      readState: get,
      writeState: (updater) => set((state) => updater(state)),
    }),

    newUserOnboardingOpen: false,
    setNewUserOnboardingOpen: (open) => set({ newUserOnboardingOpen: open }),
    onboardingDialogRequested: false,
    requestOnboardingDialog: (entry) => set({ onboardingDialogRequested: entry ?? true }),
    clearOnboardingDialogRequest: () => set({ onboardingDialogRequested: false }),
  }));

  syncSystemThemeListener = (theme: Theme) => {
    cleanupSystemThemeListener?.();
    cleanupSystemThemeListener = null;

    if (theme !== "system" || typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemThemeChange = () => {
      if (useStore.getState().theme !== "system") {
        return;
      }

      applyTheme("system");
    };

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleSystemThemeChange);
      cleanupSystemThemeListener = () => {
        mediaQuery.removeEventListener("change", handleSystemThemeChange);
      };
      return;
    }

    mediaQuery.addListener(handleSystemThemeChange);
    cleanupSystemThemeListener = () => {
      mediaQuery.removeListener(handleSystemThemeChange);
    };
  };

  useStore.subscribe((state, prevState) => {
    if (applyingBroadcast) {
      return;
    }

    for (const field of BROADCAST_FIELDS as Set<BroadcastField>) {
      if (state[field] === prevState[field]) {
        continue;
      }

      broadcastService.send({
        channel: `${STATE_CHANNEL_PREFIX}${field}`,
        payload: state[field],
      });
    }
  });

  broadcastService.onMessage((msg: BroadcastMessage) => {
    const autoPlayed = parseCodingPlanQuotaResetAutoPlayedBroadcastMessage(msg);
    if (autoPlayed) {
      useStore.setState((state) => applyCodingPlanQuotaResetAutoPlayedBroadcast(state, autoPlayed));
      return;
    }

    if (!msg.channel.startsWith(STATE_CHANNEL_PREFIX)) return;

    const field = msg.channel.slice(STATE_CHANNEL_PREFIX.length) as BroadcastField;
    if (!BROADCAST_FIELDS.has(field)) return;

    applyingBroadcast = true;
    try {
      const state = useStore.getState();
      if (field === "theme" && typeof msg.payload === "string") {
        state.setTheme(msg.payload as Theme);
      } else if (field === "locale" && typeof msg.payload === "string") {
        state.setLocale(msg.payload);
      } else if (
        field === "interfaceMode" &&
        (msg.payload === "office" || msg.payload === "coding")
      ) {
        state.setInterfaceMode(normalizeInterfaceMode(msg.payload));
      } else if (field === "uiFontSizePx" && typeof msg.payload === "number") {
        state.setUiFontSizePx(msg.payload);
      } else if (field === "notificationEnabled" && typeof msg.payload === "boolean") {
        state.setNotificationEnabled(msg.payload);
      }
    } finally {
      applyingBroadcast = false;
    }
  });

  syncSystemThemeListener(useStore.getState().theme);
  applyTheme(useStore.getState().theme);
  applyUiFontSizePx(useStore.getState().uiFontSizePx);
  document.documentElement.classList.toggle(
    "dark",
    resolveTheme(useStore.getState().theme) === "dark",
  );

  return useStore;
}

export type CfStore = ReturnType<typeof createCfStore>;
