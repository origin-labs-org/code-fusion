import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import type { Locale, LocalePreference } from "@origin-ai/cf-shared";
import { DEFAULT_LOCALE } from "@origin-ai/cf-shared";
import type { BroadcastMessage, IBroadcastService, ISettingService } from "@origin-ai/cf-services";
import { readNavigatorLanguage, readSafeLocalStorage, writeSafeLocalStorage } from "@/lib/browserEnvironment.js";
import enUS from "./locales/en-US.js";

const MESSAGES: Record<Locale, Record<string, string>> = {
  "zh-CN": enUS,
  "en-US": enUS,
};

export interface IntlInstance {
  formatMessage(descriptor: { id: string }, values?: Record<string, string | number>): string;
}

const LOCALE_PREFERENCE_KEY = "cf-locale-preference";
const STATE_LOCALE_CHANNEL = "state:locale";

interface LocaleBroadcastPayload {
  preference: LocalePreference;
  resolvedLocale: Locale;
}

function isLocale(value: unknown): value is Locale {
  return value === "zh-CN" || value === "en-US";
}

function isLocalePreference(value: unknown): value is LocalePreference {
  return value === "system" || isLocale(value);
}

function resolveLocaleBroadcastPayload(payload: unknown): LocaleBroadcastPayload | null {
  if (isLocale(payload)) {
    return {
      preference: payload,
      resolvedLocale: payload,
    };
  }

  if (!payload || typeof payload !== "object") {
    return null;
  }

  const candidate = payload as Partial<LocaleBroadcastPayload>;
  if (
    isLocalePreference(candidate.preference) &&
    isLocale(candidate.resolvedLocale)
  ) {
    return {
      preference: candidate.preference,
      resolvedLocale: candidate.resolvedLocale,
    };
  }

  return null;
}

export function resolveLocalePreferenceFromSettings({
  storedPreference,
  settingsLocale,
  settingsLocalePreference,
  preferSettingServiceLocale,
}: {
  storedPreference: LocalePreference | null;
  settingsLocale: Locale | undefined;
  settingsLocalePreference: LocalePreference | undefined;
  preferSettingServiceLocale: boolean;
}): LocalePreference | null {
  if (preferSettingServiceLocale && settingsLocale) {
    if (settingsLocalePreference === "system") {
      return settingsLocale;
    }
    return settingsLocale;
  }

  return storedPreference ?? settingsLocalePreference ?? settingsLocale ?? null;
}

export function shouldApplyLocaleBroadcastMessage(
  message: Pick<BroadcastMessage, "channel" | "payload" | "sourceWindowId">,
  options: {
    ignoredLocalPayload?: LocaleBroadcastPayload | null;
  } = {},
): message is Pick<BroadcastMessage, "channel"> & { payload: Locale | LocaleBroadcastPayload } {
  const payload = resolveLocaleBroadcastPayload(message.payload);
  if (message.channel !== STATE_LOCALE_CHANNEL || !payload) {
    return false;
  }
  if (
    message.sourceWindowId === undefined &&
    options.ignoredLocalPayload?.preference === payload.preference &&
    options.ignoredLocalPayload.resolvedLocale === payload.resolvedLocale
  ) {
    return false;
  }
  return true;
}

function createIntl(locale: Locale): IntlInstance {
  const messages = MESSAGES[locale] ?? MESSAGES[DEFAULT_LOCALE]!;
  return {
    formatMessage({ id }, values) {
      let msg = messages[id] ?? id;
      if (values) {
        for (const [key, val] of Object.entries(values)) {
          msg = msg.replaceAll(`{${key}}`, String(val));
        }
      }
      return msg;
    },
  };
}

interface IntlContextValue {
  intl: IntlInstance;
  locale: Locale;
  localePreference: LocalePreference;
  setLocale: (locale: Locale) => void;
  setLocalePreference: (localePreference: LocalePreference) => void;
}

const IntlContext = createContext<IntlContextValue | null>(null);

export function CfIntlProvider({
  children,
  settingService,
  broadcastService,
  initialLocale,
  preferSettingServiceLocale = false,
  resolveSystemLocale: resolveHostSystemLocale,
}: {
  children: ReactNode;
  settingService?: ISettingService;
  broadcastService?: Pick<IBroadcastService, "send" | "onMessage">;
  initialLocale?: Locale;
  preferSettingServiceLocale?: boolean;
  resolveSystemLocale?: () => Locale | Promise<Locale>;
}) {
  const applyingBroadcastRef = useRef(false);
  const ignoredLocalLocaleBroadcastPayloadRef = useRef<LocaleBroadcastPayload | null>(null);
  const localePreferenceOperationSeqRef = useRef(0);
  const resolveNavigatorSystemLocale = useCallback((): Locale => {
    const language = readNavigatorLanguage();
    if (!language) {
      return DEFAULT_LOCALE;
    }

    return language.toLowerCase().startsWith("zh")
      ? "zh-CN"
      : "en-US";
  }, []);
  const resolveSystemLocale = useCallback(async (): Promise<Locale> => {
    const resolvedLocale = await resolveHostSystemLocale?.();
    if (isLocale(resolvedLocale)) {
      return resolvedLocale;
    }
    return resolveNavigatorSystemLocale();
  }, [resolveHostSystemLocale, resolveNavigatorSystemLocale]);

  const readStoredPreference = useCallback((): LocalePreference | null => {
    const raw = readSafeLocalStorage(LOCALE_PREFERENCE_KEY);
    if (isLocalePreference(raw)) {
      return raw;
    }
    return null;
  }, []);

  const persistLocalePreference = useCallback((preference: LocalePreference) => {
    writeSafeLocalStorage(LOCALE_PREFERENCE_KEY, preference);
  }, []);

  const [localePreference, setLocalePreferenceState] = useState<LocalePreference>(
    () => initialLocale ?? readStoredPreference() ?? "system",
  );
  const [systemLocale, setSystemLocale] = useState<Locale>(() => resolveNavigatorSystemLocale());
  const enqueueLocalePreferenceUpdate = useCallback(
    (operationSeq: number, resolvedLocale: Locale, preference: LocalePreference) => {
      if (localePreferenceOperationSeqRef.current !== operationSeq) {
        return;
      }

      void settingService?.update({
        locale: resolvedLocale,
        localePreference: preference,
      }).catch(() => {
      });
    },
    [settingService],
  );

  useEffect(() => {
    if (!settingService) return;
    let disposed = false;
    const initialOperationSeq = localePreferenceOperationSeqRef.current;
    settingService.get().then(async (settings) => {
      if (disposed || localePreferenceOperationSeqRef.current !== initialOperationSeq) {
        return;
      }
      const nextPreference = resolveLocalePreferenceFromSettings({
        storedPreference: readStoredPreference(),
        settingsLocale: settings.locale,
        settingsLocalePreference: settings.localePreference,
        preferSettingServiceLocale,
      });
      if (disposed) {
        return;
      }
      if (nextPreference) {
        setLocalePreferenceState(nextPreference);
        if (preferSettingServiceLocale) {
          persistLocalePreference(nextPreference);
        }
        if (nextPreference === "system") {
          const resolvedLocale = await resolveSystemLocale();
          if (
            disposed ||
            localePreferenceOperationSeqRef.current !== initialOperationSeq
          ) {
            return;
          }
          setSystemLocale(resolvedLocale);
          if (settings.locale !== resolvedLocale) {
            enqueueLocalePreferenceUpdate(initialOperationSeq, resolvedLocale, "system");
          }
        }
      }
    });
    return () => {
      disposed = true;
    };
  }, [
    persistLocalePreference,
    preferSettingServiceLocale,
    readStoredPreference,
    enqueueLocalePreferenceUpdate,
    resolveSystemLocale,
    settingService,
  ]);

  const locale = useMemo<Locale>(() => {
    return localePreference === "system" ? systemLocale : localePreference;
  }, [localePreference, systemLocale]);

  const setLocalePreference = useCallback(
    (newPreference: LocalePreference) => {
      const operationSeq = localePreferenceOperationSeqRef.current + 1;
      localePreferenceOperationSeqRef.current = operationSeq;
      setLocalePreferenceState(newPreference);
      persistLocalePreference(newPreference);
      void (async () => {
        const resolvedLocale =
          newPreference === "system" ? await resolveSystemLocale() : newPreference;
        if (localePreferenceOperationSeqRef.current !== operationSeq) {
          return;
        }
        if (newPreference === "system") {
          setSystemLocale(resolvedLocale);
        }
        const broadcastPayload: LocaleBroadcastPayload = {
          preference: newPreference,
          resolvedLocale,
        };
        if (!applyingBroadcastRef.current && broadcastService) {
          ignoredLocalLocaleBroadcastPayloadRef.current = broadcastPayload;
          void broadcastService.send({
            channel: STATE_LOCALE_CHANNEL,
            payload: broadcastPayload,
          }).finally(() => {
            if (
              ignoredLocalLocaleBroadcastPayloadRef.current?.preference === broadcastPayload.preference &&
              ignoredLocalLocaleBroadcastPayloadRef.current.resolvedLocale === broadcastPayload.resolvedLocale
            ) {
              ignoredLocalLocaleBroadcastPayloadRef.current = null;
            }
          });
        }
        enqueueLocalePreferenceUpdate(operationSeq, resolvedLocale, newPreference);
      })();
    },
    [broadcastService, enqueueLocalePreferenceUpdate, persistLocalePreference, resolveSystemLocale],
  );

  useEffect(() => {
    if (!broadcastService) {
      return;
    }

    const subscription = broadcastService.onMessage((message) => {
      if (
        !shouldApplyLocaleBroadcastMessage(message, {
          ignoredLocalPayload: ignoredLocalLocaleBroadcastPayloadRef.current,
        })
      ) {
        return;
      }

      ignoredLocalLocaleBroadcastPayloadRef.current = null;
      const payload = resolveLocaleBroadcastPayload(message.payload);
      if (!payload) {
        return;
      }
      applyingBroadcastRef.current = true;
      try {
        localePreferenceOperationSeqRef.current += 1;
        setLocalePreferenceState(payload.preference);
        persistLocalePreference(payload.preference);
        setSystemLocale(payload.resolvedLocale);
      } finally {
        applyingBroadcastRef.current = false;
      }
    });

    return () => subscription.dispose();
  }, [broadcastService, persistLocalePreference]);

  const setLocale = useCallback(
    (newLocale: Locale) => {
      setLocalePreference(newLocale);
    },
    [setLocalePreference],
  );

  const intl = useMemo(() => createIntl(locale), [locale]);

  const value = useMemo<IntlContextValue>(
    () => ({ intl, locale, localePreference, setLocale, setLocalePreference }),
    [intl, locale, localePreference, setLocale, setLocalePreference],
  );

  return <IntlContext value={value}>{children}</IntlContext>;
}

export function useCfIntl(): IntlContextValue {
  const ctx = useContext(IntlContext);
  if (!ctx) {
    throw new Error("useCfIntl must be used within CfIntlProvider");
  }
  return ctx;
}
