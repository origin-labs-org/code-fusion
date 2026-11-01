import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IPlatformService } from "@origin-ai/cf-shared";
import { NewTaskButtonGroup } from "@/NewTaskButtonGroup.js";
import { PlatformProvider } from "@/hooks/usePlatform.js";
import { ServiceProvider } from "@/hooks/useServices.js";
import { CfIntlProvider } from "@/i18n/IntlProvider.js";
import { formatCommandShortcutLabel } from "@/lib/keyboardShortcuts.js";
import { TabStoreProvider } from "@/store/TabStoreProvider.js";
import { createSettingsTestServices } from "./lib/settingsTestServices.js";

function renderNewTaskButtonGroup() {
  return renderToStaticMarkup(
    createElement(
      ServiceProvider,
      { services: createSettingsTestServices() },
      createElement(
        PlatformProvider,
        { platform: {} as unknown as IPlatformService },
        createElement(
          CfIntlProvider,
          { initialLocale: "zh-CN" },
          createElement(
            TabStoreProvider,
            null,
            createElement(NewTaskButtonGroup, {
              onCreateTask: () => {},
            }),
          ),
        ),
      ),
    ),
  );
}

describe("NewTaskButtonGroup shortcut", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("macOS 展示 ⌘ N", () => {
    vi.stubGlobal("navigator", {
      platform: "MacIntel",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)",
    });

    const html = renderNewTaskButtonGroup();

    expect(html).toContain("⌘ N");
  });

  it("Windows/Linux 展示 Ctrl+N", () => {
    vi.stubGlobal("navigator", {
      platform: "Win32",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    });

    const html = renderNewTaskButtonGroup();

    expect(html).toContain("Ctrl+N");
  });

  it("Formatting tool returns correct primary modifier key based on platform", () => {
    expect(
      formatCommandShortcutLabel("n", {
        platform: "MacIntel",
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)",
      }),
    ).toBe("⌘ N");
    expect(
      formatCommandShortcutLabel("n", {
        platform: "Linux x86_64",
        userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
      }),
    ).toBe("Ctrl+N");
  });
});
