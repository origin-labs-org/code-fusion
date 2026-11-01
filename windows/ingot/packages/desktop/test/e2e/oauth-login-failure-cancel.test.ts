import {
  TID_LOGIN_MENU_ITEM,
  TID_LOGIN_TRIGGER,
  TID_OAUTH_CANCEL,
  TID_OAUTH_ERROR,
  TID_OAUTH_LOGIN_BUTTON,
} from "@origin-ai/cf-shared/test-ids";
import { clearAppData, clickTestIdByDom, waitForTestIdByDom } from "./helpers/desktop-app.js";

import { dismissOccupationOnboarding } from "./helpers/occupation-onboarding.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const CASE_TIMEOUT_MS = 240_000;
const OAUTH_CALLBACK_CHANNEL = "cf:oauth-callback";
const TAMPERED_OAUTH_CALLBACK_URL = "cf://oauth/callback?state=e2e-tampered-state&code=e2e-code";

describe("OAuth 登录失败态的取消交互", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("AUTH-05: Callback failure enters failure state (Retry Login + Cancel), returns to channel list after cancel", async function () {
    this.timeout(CASE_TIMEOUT_MS);

    await browser.waitUntil(
      async () => !(await $('[data-testid="root-startup-loading"]').isExisting()),
      { timeout: 30000 },
    );
    await dismissOccupationOnboarding();
    await writeFile(
      join(process.env.CF_E2E_ARTIFACT_DIR!, "auth-entry.json"),
      JSON.stringify(
        await browser.execute(() => ({
          text: document.body.innerText,
          ids: Array.from(document.querySelectorAll("[data-testid]")).map((e) =>
            e.getAttribute("data-testid"),
          ),
        })),
        null,
        2,
      ),
    );
    await ensureLoginPanelOpen();
    await waitForTestIdByDom(TID_OAUTH_LOGIN_BUTTON, {
      timeout: 20_000,
      timeoutMsg: "Login panel did not display channel buttons",
    });

    await deliverTamperedOAuthCallback();

    await waitForTestIdByDom(TID_OAUTH_ERROR, {
      timeout: 20_000,
      timeoutMsg: "OAuth 回调失败后没有出现错误提示",
    });
    await waitForTestIdByDom(TID_OAUTH_CANCEL, {
      timeout: 20_000,
      timeoutMsg: "Cancel button was not displayed in login failure state",
    });
    expect(await hasChannelButton()).toBe(false);

    await clickTestIdByDom(TID_OAUTH_CANCEL, {
      timeout: 20_000,
      timeoutMsg: "Cancel button in login failure state is not clickable",
    });
    await waitForTestIdByDom(TID_OAUTH_LOGIN_BUTTON, {
      timeout: 20_000,
      timeoutMsg: "Did not return to channel list after canceling in failure state",
    });
    expect(await hasOAuthError()).toBe(false);

    await browser.execute(() => {
      const element = document.querySelector('[data-testid="oauth-login-button"]')!;
      let fiber = (element as any)[
        Object.keys(element).find((key) => key.startsWith("__reactFiber"))!
      ];
      const accessors = new Set<any>();
      let store: any;
      while (fiber) {
        const value = fiber.memoizedProps?.value;
        const services = value?.settingService ? value : fiber.memoizedProps?.services;
        if (services?.settingService) accessors.add(services);
        if (value?.getState && value.getState().setUser) store ??= value;
        fiber = fiber.return;
      }
      if (!accessors.size || !store) throw new Error("OAuth owner not found");
      const trace: any[] = [];
      const restorers: (() => void)[] = [];
      const newer = {
        kind: "team-coding-plan",
        productId: "e2e-team",
        organizationId: "e2e-org",
        projectId: "e2e-project",
      };
      let version = 0;
      let injected = false;
      const user = { id: "e2e-cas-user", username: "E2E CAS User", displayName: "E2E CAS User" };
      for (const accessor of accessors) {
        const settings = accessor.settingService;
        const oauth = accessor.oauthService;
        const provider = accessor.providerSettingsService;
        accessor.settingService = new Proxy(settings, {
          get(target, prop) {
            if (prop !== "update") return Reflect.get(target, prop);
            return async (patch: any, expected: any) => {
              if (patch.providerFamilyConnectionSelections) {
                trace.push({ phase: "selection-write" });
                if (!injected) {
                  injected = true;
                  const before = await settings.get();
                  await settings.update(
                    {
                      providerFamilyConnectionSelections: {
                        ...before.providerFamilyConnectionSelections,
                        bigmodel: newer,
                      },
                    },
                    {
                      providerFamilyDomain: before.providerFamilyDomain,
                      providerFamilyConnectionSelections: before.providerFamilyConnectionSelections,
                      providerFamilyDomainUpdatedAt: before.providerFamilyDomainUpdatedAt ?? 0,
                    },
                  );
                  version = (await settings.get()).providerFamilyDomainUpdatedAt;
                  trace.push({ phase: "concurrent-team", version });
                }
              }
              return settings.update(patch, expected);
            };
          },
        });
        accessor.oauthService = new Proxy(oauth, {
          get(target, prop) {
            if (prop === "handleCallback")
              return async () => ({ kind: "session", provider: "bigmodel", userInfo: user });
            return Reflect.get(target, prop);
          },
        });
        accessor.providerSettingsService = new Proxy(provider, {
          get(target, prop) {
            if (prop === "refresh")
              return async (reason: string) => {
                trace.push({ phase: "provider-refresh", reason });
                const view = await provider.refresh(reason);
                return {
                  ...view,
                  providers: view.providers.map((item: any) =>
                    item.providerId === "account:bigmodel-individual-coding-plan"
                      ? {
                          ...item,
                          accountState: {
                            ...item.accountState,
                            availability: "available",
                            entitled: true,
                          },
                        }
                      : item,
                  ),
                };
              };
            return Reflect.get(target, prop);
          },
        });
        restorers.push(() => {
          accessor.settingService = settings;
          accessor.oauthService = oauth;
          accessor.providerSettingsService = provider;
        });
      }
      const accessor = Array.from(accessors)[0];
      (window as any).__oauthCasProbe = {
        trace,
        read: async () => ({
          settings: await accessor.settingService.get(),
          user: store.getState().user,
          version,
        }),
        restore: () => restorers.forEach((restore) => restore()),
      };
    });
    try {
      await deliverTamperedOAuthCallback();
      await browser.waitUntil(
        async () =>
          browser.execute(async () => {
            const probe = (window as any).__oauthCasProbe;
            const state = await probe.read();
            return (
              state.user?.id === "e2e-cas-user" &&
              probe.trace.some((entry: any) => entry.phase === "provider-refresh")
            );
          }),
        { timeout: 20000 },
      );
      await $('[data-testid="oauth-login-button"]').waitForExist({ reverse: true, timeout: 20000 });
      const result = await browser.execute(async () => {
        const probe = (window as any).__oauthCasProbe;
        return { ...(await probe.read()), trace: probe.trace };
      });
      expect(result.settings.providerFamilyConnectionSelections.bigmodel.kind).toBe(
        "team-coding-plan",
      );
      expect(result.settings.providerFamilyDomainUpdatedAt).toBe(result.version);
      expect(result.trace.filter((entry: any) => entry.phase === "selection-write")).toHaveLength(
        1,
      );
      expect(result.trace.some((entry: any) => entry.reason === "oauth-login-entitlement")).toBe(
        false,
      );
      expect(await hasOAuthError()).toBe(false);
      await writeFile(
        join(process.env.CF_E2E_ARTIFACT_DIR!, "oauth-cas-success.json"),
        JSON.stringify(result, null, 2),
      );
    } finally {
      await browser.execute(() => (window as any).__oauthCasProbe.restore());
    }
  });
});

async function ensureLoginPanelOpen(): Promise<void> {
  await browser.waitUntil(async () => (await hasChannelButton()) || (await hasLoginTrigger()), {
    timeout: 60_000,
    timeoutMsg: "OAuth login panel or manual login entry did not appear after startup",
  });

  if (await hasChannelButton()) {
    return;
  }

  await clickVisibleTestIdByDom(TID_LOGIN_TRIGGER, {
    timeout: 20_000,
    timeoutMsg: "没有可见可点击的头像菜单入口",
  });
  await clickVisibleTestIdByDom(TID_LOGIN_MENU_ITEM, {
    timeout: 20_000,
    timeoutMsg: "头像菜单里没有登录菜单项",
  });
}

async function clickVisibleTestIdByDom(
  targetTestId: string,
  {
    timeout = 10_000,
    timeoutMsg = `Pages没有可见可点击的 test id: ${targetTestId}`,
  }: { timeout?: number; timeoutMsg?: string } = {},
): Promise<void> {
  let latestReason = "not-started";
  await browser.waitUntil(
    async () => {
      const result = (await browser.execute((testIdValue: string) => {
        function isVisible(element: HTMLElement) {
          const style = window.getComputedStyle(element);
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            Number(style.opacity) === 0
          ) {
            return false;
          }
          if (element.getClientRects().length === 0) {
            return false;
          }
          return !element.closest('[aria-hidden="true"], [hidden]');
        }

        const element = Array.from(document.querySelectorAll<HTMLElement>("[data-testid]")).find(
          (item) => item.dataset.testid === testIdValue && isVisible(item),
        );
        if (!element) {
          return { clicked: false, reason: "missing-visible" };
        }

        element.focus();
        const usePointerEvent = typeof window.PointerEvent === "function";
        for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
          const event = usePointerEvent
            ? new PointerEvent(type, {
                bubbles: true,
                cancelable: true,
                pointerId: 1,
                pointerType: "mouse",
                isPrimary: true,
              })
            : new MouseEvent(type, {
                bubbles: true,
                cancelable: true,
                view: window,
              });
          element.dispatchEvent(event);
        }
        return { clicked: true };
      }, targetTestId)) as { clicked: boolean; reason?: string };
      latestReason = result.reason ?? "clicked";
      return result.clicked;
    },
    {
      timeout,
      timeoutMsg: `${timeoutMsg}: ${latestReason}`,
    },
  );
}

async function deliverTamperedOAuthCallback(): Promise<void> {
  const delivered = await browser.electron.execute(
    (electron, channel, url) => {
      const target = electron.BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
      if (!target) {
        return false;
      }
      target.webContents.send(channel, url);
      return true;
    },
    OAUTH_CALLBACK_CHANNEL,
    TAMPERED_OAUTH_CALLBACK_URL,
  );
  expect(delivered).toBe(true);
}

async function hasChannelButton(): Promise<boolean> {
  return (await browser.execute((loginButtonId: string) => {
    return Boolean(document.querySelector(`[data-testid="${loginButtonId}"]`));
  }, TID_OAUTH_LOGIN_BUTTON)) as boolean;
}

async function hasOAuthError(): Promise<boolean> {
  return (await browser.execute((errorId: string) => {
    return Boolean(document.querySelector(`[data-testid="${errorId}"]`));
  }, TID_OAUTH_ERROR)) as boolean;
}

async function hasLoginTrigger(): Promise<boolean> {
  return (await browser.execute((loginTriggerId: string) => {
    return Boolean(document.querySelector(`[data-testid="${loginTriggerId}"]`));
  }, TID_LOGIN_TRIGGER)) as boolean;
}
