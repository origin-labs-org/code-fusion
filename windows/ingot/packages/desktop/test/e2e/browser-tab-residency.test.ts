import { TID_BROWSER_WEBVIEW } from "@origin-ai/cf-shared/test-ids";
import { clearAppData } from "./helpers/desktop-app.js";
import { prepareConversationE2E } from "./helpers/conversation-session.js";
import { reloadElectronSessionPreservingBrowserProfile } from "./helpers/e2e-electron-reload.js";

const INITIAL_TAB_COUNT = 32;
const OVER_LIMIT_TAB_NUMBER = 33;

interface BrowserTabDomSnapshot {
  liveGuestIds: number[];
  suspendedTabIds: string[];
  tabIds: string[];
}

interface BrowserBridgeStepResult {
  ok: boolean;
  reason: string;
}

interface BrowserTestBridge {
  browserViewAttachGuest?: (payload: {
    key: string;
    webContentsId: number;
    active?: boolean;
    workspaceKey?: string;
    sessionId?: string;
  }) => Promise<{ ok: boolean; reason?: string }>;
  browserViewDetachGuest?: (payload: { key: string; webContentsId: number }) => Promise<boolean>;
}

describe("Browser tab logical limit E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("BTL04/BTL12: 第 33 个 tab 关闭最老 tab，完整重启后不恢复任何 tab", async function () {
    this.timeout(300000);
    await prepareConversationE2E({ skipProvider: true });

    let browserTabCount = await readBrowserTabCount();
    if (browserTabCount === 0) {
      await openFirstBrowserTab();
      browserTabCount = 1;
    }
    if (browserTabCount !== 1) {
      throw new Error(`Browser residency 用例Start时应只有One个 tab，实际为 ${browserTabCount}`);
    }

    for (let sequence = 2; sequence <= INITIAL_TAB_COUNT; sequence += 1) {
      await openAdditionalBrowserTab(sequence);
    }

    const initialTabIds = await readBrowserTabIds();
    const targetTabId = initialTabIds[0];
    const reusableGuestId = await createReusableBrowserGuest();
    const workspaceKey = await readActiveWorkspaceKey();
    if (!targetTabId || !reusableGuestId || !workspaceKey) {
      throw new Error("缺少 Browser residency 注册上下文");
    }

    for (const tabId of initialTabIds) {
      await registerDetachedBrowserTab(tabId, reusableGuestId, workspaceKey);
    }

    const initial = await waitForBrowserSnapshot(
      (snapshot) =>
        snapshot.tabIds.length === INITIAL_TAB_COUNT && snapshot.liveGuestIds.length === 0,
      "前 32 个 Browser logical tab 没有收敛",
    );
    expect(initial.tabIds[0]).toBe(targetTabId);

    await openAdditionalBrowserTab(OVER_LIMIT_TAB_NUMBER);
    const overLimitTabId = (await readBrowserTabIds()).at(-1);
    if (!overLimitTabId) throw new Error("Missing identity for the 33rd Browser tab");
    await registerDetachedBrowserTab(overLimitTabId, reusableGuestId, workspaceKey);

    const afterEviction = await waitForBrowserSnapshot(
      (snapshot) =>
        snapshot.tabIds.length === INITIAL_TAB_COUNT &&
        !snapshot.tabIds.includes(targetTabId) &&
        snapshot.liveGuestIds.length === 0,
      "Oldest logical tab still shown in tab bar after opening the 33rd Browser tab",
    );
    expect(afterEviction.tabIds).toHaveLength(INITIAL_TAB_COUNT);
    expect(afterEviction.tabIds).not.toContain(targetTabId);
    expect(afterEviction.liveGuestIds).toEqual([]);
    expect(await readGuestExists(reusableGuestId)).toBe(true);
    const mainGuestCount = await browser.electron.execute(
      (electron) =>
        electron.webContents
          .getAllWebContents()
          .filter((contents) => !contents.isDestroyed() && contents.getType() === "webview").length,
    );
    expect(mainGuestCount).toBe(1);

    const userDataDir = await readBrowserUserDataDir();
    const restartedUserDataDir = await reloadElectronSessionPreservingBrowserProfile(browser);
    expect(restartedUserDataDir).toBe(userDataDir);
    await prepareConversationE2E({ skipProvider: true });
    const restarted = await waitForBrowserSnapshot(
      (snapshot) =>
        snapshot.tabIds.length === 0 &&
        snapshot.liveGuestIds.length === 0 &&
        snapshot.suspendedTabIds.length === 0,
      "BTL12: Browser tab was still restored after full restart",
    );
    expect(restarted).toEqual({ liveGuestIds: [], suspendedTabIds: [], tabIds: [] });
    const restartedMainGuestCount = await browser.electron.execute(
      (electron) =>
        electron.webContents
          .getAllWebContents()
          .filter((contents) => !contents.isDestroyed() && contents.getType() === "webview").length,
    );
    expect(restartedMainGuestCount).toBe(0);
  });
});

async function openFirstBrowserTab(): Promise<void> {
  const openedFromLauncher = await clickOpenTabBrowserItem();
  if (openedFromLauncher) {
    await waitForTabCount(1);
    return;
  }

  await ensureSidePaneEntryVisible();
  if (await clickOpenTabBrowserItem()) {
    await waitForTabCount(1);
    return;
  }
  await openAdditionalBrowserTab(1);
}

async function ensureSidePaneEntryVisible(): Promise<void> {
  await browser.waitUntil(
    async () => {
      const visible = await browser.execute(() =>
        Boolean(
          document.querySelector(
            '[data-side-pane-open-tab-item="browser"], [data-side-pane-add-trigger]',
          ),
        ),
      );
      if (visible) return true;
      await browser.execute(() => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "b",
            code: "KeyB",
            altKey: true,
            metaKey: true,
            bubbles: true,
            cancelable: true,
          }),
        );
      });
      return false;
    },
    {
      interval: 500,
      timeout: 15000,
      timeoutMsg: "切换右侧面板后没有出现 Open Tab 或 add trigger",
    },
  );
}

function clickOpenTabBrowserItem(): Promise<boolean> {
  return browser.execute(() => {
    const button = document.querySelector<HTMLButtonElement>(
      '[data-side-pane-open-tab-item="browser"]',
    );
    if (!button) return false;
    button.click();
    return true;
  });
}

function readBrowserTabCount(): Promise<number> {
  return browser.execute(
    () => document.querySelectorAll<HTMLElement>('[data-side-pane-tab-id^="browser:"]').length,
  );
}

function readBrowserTabIds(): Promise<string[]> {
  return browser.execute(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-side-pane-tab-id^="browser:"]'))
      .map((tab) => tab.dataset.sidePaneTabId ?? "")
      .filter(Boolean),
  );
}

async function openAdditionalBrowserTab(expectedCount: number): Promise<void> {
  await requestAdditionalBrowserTab(expectedCount);
  await waitForTabCount(expectedCount);
  await activateLatestBrowserTab();
}

async function activateLatestBrowserTab(): Promise<void> {
  await browser.waitUntil(
    () =>
      browser.execute(() => {
        const tabs = Array.from(
          document.querySelectorAll<HTMLElement>('[data-side-pane-tab-id^="browser:"]'),
        );
        const latest = tabs.at(-1);
        if (!latest) return false;
        if (latest.hasAttribute("data-active")) return true;
        latest.click();
        return false;
      }),
    {
      timeout: 10000,
      timeoutMsg: "最新 Browser tab 没有切换为 active",
    },
  );
}

function createReusableBrowserGuest(): Promise<number> {
  return browser.executeAsync((done) => {
    const guest = document.createElement("webview") as HTMLElement & {
      getWebContentsId?: () => number;
      src: string;
    };
    guest.src = "about:blank";
    guest.style.cssText =
      "position:fixed;left:-2px;top:-2px;width:1px;height:1px;opacity:0;pointer-events:none";
    const timeout = window.setTimeout(() => done(0), 10000);
    guest.addEventListener(
      "dom-ready",
      () => {
        window.clearTimeout(timeout);
        done(guest.getWebContentsId?.() ?? 0);
      },
      { once: true },
    );
    document.body.append(guest);
  }) as Promise<number>;
}

async function registerDetachedBrowserTab(
  tabId: string,
  webContentsId: number,
  workspaceKey: string,
): Promise<void> {
  const result = (await browser.executeAsync(
    async (targetTabId, guestId, targetWorkspaceKey, done) => {
      try {
        const bridge = (window as Window & { cf?: BrowserTestBridge }).cf;
        const attached = await bridge?.browserViewAttachGuest?.({
          key: targetTabId,
          webContentsId: guestId,
          active: false,
          workspaceKey: targetWorkspaceKey,
          sessionId: "unscoped",
        });
        if (!attached?.ok) {
          done({ ok: false, reason: attached?.reason ?? "attach-unavailable" });
          return;
        }
        const detached = await bridge?.browserViewDetachGuest?.({
          key: targetTabId,
          webContentsId: guestId,
        });
        done({ ok: detached === true, reason: detached ? "ok" : "detach-rejected" });
      } catch (error) {
        done({ ok: false, reason: error instanceof Error ? error.message : String(error) });
      }
    },
    tabId,
    webContentsId,
    workspaceKey,
  )) as BrowserBridgeStepResult;
  if (!result.ok) {
    throw new Error(`注册 non-live Browser tab Failed: ${tabId}, ${result.reason}`);
  }
}

function readActiveWorkspaceKey(): Promise<string | null> {
  return browser.execute(() => {
    const bridge = (
      window as Window & {
        __cfTabStoreE2E?: {
          getState?: () => {
            activeWorkspaceIdentity?: string | null;
            activeWorkspacePath?: string | null;
          };
        };
      }
    ).__cfTabStoreE2E;
    const state = bridge?.getState?.();
    return state?.activeWorkspaceIdentity?.trim() || state?.activeWorkspacePath || null;
  });
}

async function requestAdditionalBrowserTab(sequence: number): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.execute(() => {
        const trigger = document.querySelector<HTMLElement>("[data-side-pane-add-trigger]");
        if (!trigger) return false;
        trigger.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            cancelable: true,
            button: 0,
            pointerId: 1,
            pointerType: "mouse",
          }),
        );
        trigger.click();
        return true;
      }),
    {
      timeout: 10000,
      timeoutMsg: `创建第 ${sequence} 个 Browser tab 时没有找到 add trigger`,
    },
  );
  await browser.waitUntil(
    async () =>
      browser.execute(() => {
        const item = document.querySelector<HTMLElement>(
          '[data-state="active"] [data-side-pane-open-tab-item="browser"]',
        );
        if (!item) return false;
        item.click();
        return true;
      }),
    {
      timeout: 10000,
      timeoutMsg: `创建第 ${sequence} 个 Browser tab 时菜单项没有出现`,
    },
  );
}

async function waitForTabCount(expectedCount: number, timeout = 10000): Promise<void> {
  let latestCount = 0;
  await browser.waitUntil(
    async () => {
      latestCount = await browser.execute(
        () => document.querySelectorAll<HTMLElement>('[data-side-pane-tab-id^="browser:"]').length,
      );
      return latestCount === expectedCount;
    },
    {
      timeout,
      timeoutMsg: `Browser 逻辑 tab Quantity没有达到 ${expectedCount}，最后观察到 ${latestCount}`,
    },
  );
}

async function waitForBrowserSnapshot(
  predicate: (snapshot: BrowserTabDomSnapshot) => boolean,
  timeoutMsg: string,
): Promise<BrowserTabDomSnapshot> {
  let latest: BrowserTabDomSnapshot = {
    liveGuestIds: [],
    suspendedTabIds: [],
    tabIds: [],
  };
  await browser.waitUntil(
    async () => {
      latest = await readBrowserSnapshot();
      return predicate(latest);
    },
    {
      timeout: 30000,
      timeoutMsg: `${timeoutMsg}: ${JSON.stringify(latest)}`,
    },
  );
  return latest;
}

function readBrowserSnapshot(): Promise<BrowserTabDomSnapshot> {
  return browser.execute((webviewTestId) => {
    const tabs = Array.from(
      document.querySelectorAll<HTMLElement>('[data-side-pane-tab-id^="browser:"]'),
    );
    return {
      tabIds: tabs.map((tab) => tab.dataset.sidePaneTabId ?? "").filter(Boolean),
      suspendedTabIds: tabs
        .filter((tab) => tab.dataset.browserTabResidency === "suspended")
        .map((tab) => tab.dataset.sidePaneTabId ?? "")
        .filter(Boolean),
      liveGuestIds: Array.from(
        document.querySelectorAll<HTMLElement>(`[data-testid="${webviewTestId}"]`),
      )
        .map((element) => {
          try {
            return (
              (element as HTMLElement & { getWebContentsId?: () => number }).getWebContentsId?.() ??
              0
            );
          } catch {
            return 0;
          }
        })
        .filter((id) => id > 0),
    };
  }, TID_BROWSER_WEBVIEW);
}

async function readBrowserUserDataDir(): Promise<string> {
  return (await browser.electron.execute((electron) => electron.app.getPath("userData"))) as string;
}

function readGuestExists(webContentsId: number): Promise<boolean> {
  return browser.electron.execute((electron, id) => {
    const guest = electron.webContents.fromId(id);
    return Boolean(guest && !guest.isDestroyed());
  }, webContentsId) as unknown as Promise<boolean>;
}
