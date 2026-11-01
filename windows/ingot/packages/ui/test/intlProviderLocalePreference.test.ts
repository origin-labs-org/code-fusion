// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import {
  resolveLocalePreferenceFromSettings,
  shouldApplyLocaleBroadcastMessage,
  useCfIntl,
  CfIntlProvider,
} from "@/i18n/IntlProvider.js";
import type { Locale } from "@origin-ai/cf-shared";
import type { BroadcastMessage } from "@origin-ai/cf-services";

function LocaleProbe() {
  const { locale, localePreference } = useCfIntl();
  return createElement(
    "div",
    null,
    createElement("span", { "data-testid": "locale" }, locale),
    createElement("span", { "data-testid": "localePreference" }, localePreference),
  );
}

function LocaleControls() {
  const { setLocalePreference } = useCfIntl();
  return createElement(
    "div",
    null,
    createElement(
      "button",
      {
        type: "button",
        onClick: () => setLocalePreference("system"),
      },
      "system",
    ),
    createElement(
      "button",
      {
        type: "button",
        onClick: () => setLocalePreference("en-US"),
      },
      "en-US",
    ),
    createElement(LocaleProbe),
  );
}

function createSettingService(
  settings: { locale: Locale; localePreference: "system" | Locale },
  update = vi.fn().mockResolvedValue(undefined),
) {
  return {
    get: vi.fn().mockResolvedValue(settings),
    update,
  };
}

function renderIntlProvider({
  children,
  settings,
  resolveSystemLocale,
  broadcastService,
  update,
}: {
  children: ReactNode;
  settings: { locale: Locale; localePreference: "system" | Locale };
  resolveSystemLocale?: () => Locale | Promise<Locale>;
  broadcastService?: {
    send: (message: Pick<BroadcastMessage, "channel" | "payload">) => Promise<void>;
    onMessage: (listener: (message: BroadcastMessage) => void) => { dispose: () => void };
  };
  update?: ReturnType<typeof vi.fn>;
}) {
  const settingService = createSettingService(settings, update);
  render(
    createElement(
      CfIntlProvider,
      {
        settingService,
        resolveSystemLocale,
        broadcastService,
      },
      children,
    ),
  );
  return settingService;
}

function installMemoryLocalStorage() {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        values.delete(key);
      }),
      clear: vi.fn(() => {
        values.clear();
      }),
    },
  });
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function createBroadcastService() {
  let listener: ((message: BroadcastMessage) => void) | null = null;
  return {
    send: vi.fn().mockResolvedValue(undefined),
    onMessage: vi.fn((nextListener: (message: BroadcastMessage) => void) => {
      listener = nextListener;
      return { dispose: vi.fn() };
    }),
    emit(message: BroadcastMessage) {
      listener?.(message);
    },
  };
}

beforeEach(() => {
  installMemoryLocalStorage();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("IntlProvider locale preference sync", () => {
  it("Mobile remote control overrides mobile local preferences with desktop settingService locale", () => {
    expect(
      resolveLocalePreferenceFromSettings({
        storedPreference: "en-US",
        settingsLocale: "zh-CN",
        settingsLocalePreference: "zh-CN",
        preferSettingServiceLocale: true,
      }),
    ).toBe("zh-CN");
  });

  it("Non-remote entry points continue to respect local language preferences", () => {
    expect(
      resolveLocalePreferenceFromSettings({
        storedPreference: "en-US",
        settingsLocale: "zh-CN",
        settingsLocalePreference: "zh-CN",
        preferSettingServiceLocale: false,
      }),
    ).toBe("en-US");
  });

  it("Preserve settingService system preference on first launch when no local preference exists", () => {
    expect(
      resolveLocalePreferenceFromSettings({
        storedPreference: null,
        settingsLocale: "zh-CN",
        settingsLocalePreference: "system",
        preferSettingServiceLocale: false,
      }),
    ).toBe("system");
  });

  it("Remote entry points use desktop resolved language when encountering desktop system preference", () => {
    expect(
      resolveLocalePreferenceFromSettings({
        storedPreference: "en-US",
        settingsLocale: "zh-CN",
        settingsLocalePreference: "system",
        preferSettingServiceLocale: true,
      }),
    ).toBe("zh-CN");
  });

  it("Only accept valid language broadcasts of state:locale", () => {
    expect(
      shouldApplyLocaleBroadcastMessage({
        channel: "state:locale",
        payload: "zh-CN",
      }),
    ).toBe(true);
    expect(
      shouldApplyLocaleBroadcastMessage({
        channel: "state:theme",
        payload: "zh-CN",
      }),
    ).toBe(false);
    expect(
      shouldApplyLocaleBroadcastMessage({
        channel: "state:locale",
        payload: "fr-FR",
      }),
    ).toBe(false);
    expect(
      shouldApplyLocaleBroadcastMessage({
        channel: "state:locale",
        payload: {
          preference: "system",
          resolvedLocale: "zh-CN",
        },
      }),
    ).toBe(true);
  });

  it("Ignore local echo of locale just emitted by this window to avoid overwriting system preference", () => {
    expect(
      shouldApplyLocaleBroadcastMessage(
        {
          channel: "state:locale",
          payload: {
            preference: "system",
            resolvedLocale: "zh-CN",
          },
        },
        {
          ignoredLocalPayload: {
            preference: "system",
            resolvedLocale: "zh-CN",
          },
        },
      ),
    ).toBe(false);
    expect(
      shouldApplyLocaleBroadcastMessage(
        {
          channel: "state:locale",
          payload: {
            preference: "system",
            resolvedLocale: "zh-CN",
          },
          sourceWindowId: 1,
        },
        {
          ignoredLocalPayload: {
            preference: "system",
            resolvedLocale: "zh-CN",
          },
        },
      ),
    ).toBe(true);
  });

  it("桌面 system 偏好优先使用宿主系统语言而不是 renderer navigator.language", async () => {
    Object.defineProperty(navigator, "language", {
      configurable: true,
      value: "en-US",
    });

    const settingService = renderIntlProvider({
      settings: {
        locale: "en-US",
        localePreference: "system",
      },
      resolveSystemLocale: () => Promise.resolve("zh-CN"),
      children: createElement(LocaleProbe),
    });

    await waitFor(() => {
      expect(screen.getByTestId("locale").textContent).toBe("zh-CN");
    });
    expect(screen.getByTestId("localePreference").textContent).toBe("system");
    expect(settingService.update).toHaveBeenCalledWith({
      locale: "zh-CN",
      localePreference: "system",
    });
  });

  it("Late return of legacy system resolution does not overwrite subsequent explicit language selection", async () => {
    const deferredSystemLocale = createDeferred<Locale>();
    const broadcastService = createBroadcastService();
    const settingService = renderIntlProvider({
      settings: {
        locale: "en-US",
        localePreference: "en-US",
      },
      resolveSystemLocale: () => deferredSystemLocale.promise,
      broadcastService,
      children: createElement(LocaleControls),
    });

    await waitFor(() => {
      expect(screen.getByTestId("localePreference").textContent).toBe("en-US");
    });

    fireEvent.click(screen.getByRole("button", { name: "system" }));
    fireEvent.click(screen.getByRole("button", { name: "en-US" }));
    await act(async () => {
      deferredSystemLocale.resolve("zh-CN");
      await deferredSystemLocale.promise;
    });

    await waitFor(() => {
      expect(screen.getByTestId("locale").textContent).toBe("en-US");
      expect(screen.getByTestId("localePreference").textContent).toBe("en-US");
    });
    expect(localStorage.getItem("cf-locale-preference")).toBe("en-US");
    expect(settingService.update).toHaveBeenCalledWith({
      locale: "en-US",
      localePreference: "en-US",
    });
    expect(settingService.update).not.toHaveBeenCalledWith({
      locale: "zh-CN",
      localePreference: "system",
    });
    expect(broadcastService.send).toHaveBeenCalledWith({
      channel: "state:locale",
      payload: {
        preference: "en-US",
        resolvedLocale: "en-US",
      },
    });
    expect(broadcastService.send).not.toHaveBeenCalledWith({
      channel: "state:locale",
      payload: {
        preference: "system",
        resolvedLocale: "zh-CN",
      },
    });
  });

  it("跨窗口 system 广播保留偏好并使用解析语言渲染", async () => {
    const broadcastService = createBroadcastService();
    renderIntlProvider({
      settings: {
        locale: "en-US",
        localePreference: "en-US",
      },
      broadcastService,
      children: createElement(LocaleProbe),
    });

    await waitFor(() => {
      expect(screen.getByTestId("localePreference").textContent).toBe("en-US");
    });

    act(() => {
      broadcastService.emit({
        channel: "state:locale",
        payload: {
          preference: "system",
          resolvedLocale: "zh-CN",
        },
        sourceWindowId: 1,
      });
    });

    expect(screen.getByTestId("locale").textContent).toBe("zh-CN");
    expect(screen.getByTestId("localePreference").textContent).toBe("system");
    expect(localStorage.getItem("cf-locale-preference")).toBe("system");
  });

  it("Delayed settingService persistence does not block cross-window broadcasts", async () => {
    const deferredUpdate = createDeferred<void>();
    const update = vi.fn().mockReturnValue(deferredUpdate.promise);
    const broadcastService = createBroadcastService();
    renderIntlProvider({
      settings: {
        locale: "zh-CN",
        localePreference: "zh-CN",
      },
      update,
      broadcastService,
      children: createElement(LocaleControls),
    });

    await waitFor(() => {
      expect(screen.getByTestId("localePreference").textContent).toBe("zh-CN");
    });

    fireEvent.click(screen.getByRole("button", { name: "en-US" }));

    await waitFor(() => {
      expect(screen.getByTestId("locale").textContent).toBe("en-US");
      expect(broadcastService.send).toHaveBeenCalledWith({
        channel: "state:locale",
        payload: {
          preference: "en-US",
          resolvedLocale: "en-US",
        },
      });
    });
    expect(update).toHaveBeenCalledWith({
      locale: "en-US",
      localePreference: "en-US",
    });
  });

  it("Late return of initial system resolution does not overwrite explicit selection just made by user", async () => {
    const deferredSystemLocale = createDeferred<Locale>();
    const resolveSystemLocale = vi.fn().mockReturnValue(deferredSystemLocale.promise);
    const update = vi.fn().mockResolvedValue(undefined);
    renderIntlProvider({
      settings: {
        locale: "en-US",
        localePreference: "system",
      },
      resolveSystemLocale,
      update,
      children: createElement(LocaleControls),
    });

    await waitFor(() => {
      expect(resolveSystemLocale).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole("button", { name: "en-US" }));
    await act(async () => {
      deferredSystemLocale.resolve("zh-CN");
      await deferredSystemLocale.promise;
    });

    await waitFor(() => {
      expect(screen.getByTestId("locale").textContent).toBe("en-US");
      expect(screen.getByTestId("localePreference").textContent).toBe("en-US");
    });
    expect(update).toHaveBeenCalledWith({
      locale: "en-US",
      localePreference: "en-US",
    });
    expect(update).not.toHaveBeenCalledWith({
      locale: "zh-CN",
      localePreference: "system",
    });
  });

  it("Re-selection still attempts persistence after initial settingService update permanently pends", async () => {
    const pendingUpdate = createDeferred<void>();
    const update = vi
      .fn()
      .mockReturnValueOnce(pendingUpdate.promise)
      .mockResolvedValue(undefined);
    renderIntlProvider({
      settings: {
        locale: "zh-CN",
        localePreference: "zh-CN",
      },
      resolveSystemLocale: () => "zh-CN",
      update,
      children: createElement(LocaleControls),
    });

    await waitFor(() => {
      expect(screen.getByTestId("localePreference").textContent).toBe("zh-CN");
    });

    fireEvent.click(screen.getByRole("button", { name: "en-US" }));
    await waitFor(() => {
      expect(update).toHaveBeenCalledWith({
        locale: "en-US",
        localePreference: "en-US",
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "system" }));
    await waitFor(() => {
      expect(update).toHaveBeenCalledWith({
        locale: "zh-CN",
        localePreference: "system",
      });
    });
    expect(update).toHaveBeenCalledTimes(2);
  });
});
