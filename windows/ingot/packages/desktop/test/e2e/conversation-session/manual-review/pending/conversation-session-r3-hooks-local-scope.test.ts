import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import {
  TID_SETTINGS_PAGE,
  TID_SETTINGS_SECTION_NAV,
  TID_TASK_SETTINGS_BUTTON,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import {
  clearAppData,
  clickTestIdByDom,
  DEFAULT_WORKSPACE,
  waitForTestIdByDom,
} from "../../../helpers/desktop-app.js";
import {
  clickLastEnabledSSHDialogButton,
  completeSSHProjectConnection,
  fillSSHPasswordSettings,
  openSSHRemoteDialog,
  prepareSSHConnectionPage,
  readSSHRuntimeConfig,
  runSSHCommand,
} from "../../../helpers/ssh-remote-p0.js";
import { prepareV4ConversationE2E, startNewV4Draft } from "../../../helpers/v4-conversation.js";

const CASE_MARKER = "E2E_R3_HOOKS_LOCAL_SCOPE";
const artifactDir = resolve(
  process.env.CF_E2E_ARTIFACT_DIR ?? ".e2e-artifacts/r3-hooks-local-scope",
);
const LOCAL_MARKER = "E2E_R3_HOOKS_LOCAL_SCOPE_LOCAL";
const REMOTE_MARKER = "E2E_R3_HOOKS_LOCAL_SCOPE_REMOTE";
const SCOPE_TRIGGER = '[data-plugin-scope-trigger="true"]';
const HOOK_FORM = '[data-testid="hooks-form"]';

async function openHooksSection(): Promise<void> {
  const onSettings = await browser.execute(
    (pageId) => Boolean(document.querySelector(`[data-testid="${pageId}"]`)),
    TID_SETTINGS_PAGE,
  );
  if (!onSettings) {
    await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON, {
      timeout: 15_000,
      timeoutMsg: `${CASE_MARKER}: No entry point set.`,
    });
    await waitForTestIdByDom(TID_SETTINGS_PAGE, {
      timeout: 15_000,
      timeoutMsg: `${CASE_MARKER}: Settings page did not render`,
    });
  }
  await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "hooks"), {
    timeout: 15_000,
    timeoutMsg: `${CASE_MARKER}: Settings页没有 hooks 分区`,
  });
  await $('[data-testid="hooks-settings-section"]').waitForDisplayed({ timeout: 15_000 });
  await $(SCOPE_TRIGGER).waitForClickable({ timeout: 15_000 });
}

async function readScopeOptions(): Promise<string[]> {
  await $(SCOPE_TRIGGER).click();
  let options: string[] = [];
  await browser.waitUntil(
    async () => {
      options = await browser.execute(() =>
        Array.from(document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')).map((item) =>
          item.innerText.trim(),
        ),
      );
      return options.length > 0;
    },
    { timeout: 10_000, timeoutMsg: `${CASE_MARKER}: scope 菜单没有选项` },
  );
  await browser.keys(["Escape"]);
  await browser.waitUntil(
    () => browser.execute(() => document.querySelectorAll('[role="menuitemradio"]').length === 0),
    { timeout: 10_000, timeoutMsg: `${CASE_MARKER}: scope 菜单没有Close` },
  );
  return options;
}

async function selectScopeKey(key: string): Promise<void> {
  await $(SCOPE_TRIGGER).click();
  await browser.waitUntil(
    () => browser.execute(() => document.querySelectorAll('[role="menuitemradio"]').length > 0),
    { timeout: 10_000, timeoutMsg: `${CASE_MARKER}: scope 菜单打不开` },
  );
  const clicked = await browser.execute((expectedKey) => {
    const option = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
    ).find((item) => item.dataset.pluginScopeKey === expectedKey);
    option?.click();
    return Boolean(option);
  }, key);
  expect(clicked).toBe(true);
  await browser.waitUntil(
    async () => (await $(SCOPE_TRIGGER).getAttribute("data-plugin-scope-key")) === key,
    { timeout: 15_000, timeoutMsg: `${CASE_MARKER}: scope 没有切到 ${key}` },
  );
}

async function createHook(marker: string): Promise<string[]> {
  await browser.waitUntil(
    () =>
      browser.execute(() => {
        const button = document.querySelector<HTMLButtonElement>(
          '[data-settings-create-action="settings.hooks.add"]',
        );
        if (!button || button.disabled) return false;
        button.click();
        return true;
      }),
    { timeout: 15_000, timeoutMsg: `${CASE_MARKER}: 没有“New Hook”入口` },
  );
  const form = $(HOOK_FORM);
  await form.waitForDisplayed({ timeout: 15_000 });
  await form.$("#matcher").setValue(`${marker}_MATCHER_NEVER`);
  await form.$("#command").setValue("/usr/bin/printf");
  await form.$("#args").setValue(marker);
  await browser.waitUntil(
    () =>
      browser.execute((selector) => {
        const formNode = document.querySelector<HTMLElement>(selector);
        const button = Array.from(
          formNode?.querySelectorAll<HTMLButtonElement>("button") ?? [],
        ).find((item) => /^(Save|Save)$/iu.test(item.innerText.trim()) && !item.disabled);
        button?.click();
        return Boolean(button);
      }, HOOK_FORM),
    { timeout: 15_000, timeoutMsg: `${CASE_MARKER}: Hook表单没有Available的Save按钮` },
  );
  await browser.waitUntil(async () => !(await form.isExisting()), {
    timeout: 30_000,
    timeoutMsg: `${CASE_MARKER}: Save后Hook表单没有Close`,
  });
  await browser.pause(1_500);
  return browser.execute(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[role="alert"], [data-sonner-toast]'))
      .map((node) => (node.innerText ?? "").replace(/\s+/gu, " ").trim())
      .filter(Boolean),
  );
}

async function readLocalFile(path: string, waitMs: number): Promise<string | null> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      await access(path);
      return await readFile(path, "utf8");
    } catch {
      if (Date.now() >= deadline) return null;
      await browser.pause(500);
    }
  }
}

describe(`${CASE_MARKER}: 远端Project激活时Hook按选Medium的 scope 落盘`, () => {
  const facts: Record<string, unknown> = {};

  after(async () => {
    await mkdir(artifactDir, { recursive: true });
    await writeFile(resolve(artifactDir, "hooks-local-scope.json"), JSON.stringify(facts, null, 2));
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("R3A-DEV-06-hooks-local-scope When active workspace is remote, saving hooks with local project scope only writes locally; remote project scope only writes remotely", async function () {
    this.timeout(20 * 60_000);
    const config = readSSHRuntimeConfig(CASE_MARKER);
    const [workspaceA] = config.workspacePaths;
    const localConfigPath = join(DEFAULT_WORKSPACE, ".cf", "config.json");
    await prepareSSHConnectionPage(CASE_MARKER);
    await prepareV4ConversationE2E({ skipProvider: true });
    await runSSHCommand(config, `rm -f "${workspaceA}/.cf/config.json"`);

    await startNewV4Draft();
    await openSSHRemoteDialog(CASE_MARKER);
    await fillSSHPasswordSettings(config);
    await clickLastEnabledSSHDialogButton(CASE_MARKER);
    const remote = await completeSSHProjectConnection(config, CASE_MARKER);
    expect(remote.workspaceIdentity).toBeTruthy();

    await openHooksSection();
    const options = await readScopeOptions();
    facts.scopeOptions = options;
    expect(options).toEqual(
      expect.arrayContaining([
        expect.stringContaining(basename(DEFAULT_WORKSPACE)),
        expect.stringContaining(basename(workspaceA)),
      ]),
    );

    await selectScopeKey(DEFAULT_WORKSPACE);
    const localAlerts = await createHook(LOCAL_MARKER);
    facts.localAlerts = localAlerts;
    expect(localAlerts.join(" ")).not.toMatch(/EACCES|permission denied|mkdir/iu);
    const localConfig = await readLocalFile(localConfigPath, 15_000);
    facts.localConfigHasLocalMarker = localConfig?.includes(LOCAL_MARKER) ?? false;
    expect(localConfig).toContain(LOCAL_MARKER);
    const remoteAfterLocal = await runSSHCommand(
      config,
      `grep -rl "${LOCAL_MARKER}" "$HOME/.cf" "${workspaceA}" 2>/dev/null; echo END`,
    );
    facts.remoteAfterLocal = remoteAfterLocal.stdout.trim();
    expect(remoteAfterLocal.stdout.trim()).toBe("END");

    await selectScopeKey(remote.workspaceIdentity!);
    const remoteAlerts = await createHook(REMOTE_MARKER);
    facts.remoteAlerts = remoteAlerts;
    expect(remoteAlerts.join(" ")).not.toMatch(/EACCES|permission denied/iu);
    let remoteConfig = "";
    await browser.waitUntil(
      async () => {
        remoteConfig = (
          await runSSHCommand(config, `cat "${workspaceA}/.cf/config.json" 2>/dev/null`)
        ).stdout;
        return remoteConfig.includes(REMOTE_MARKER);
      },
      {
        interval: 1000,
        timeout: 30_000,
        timeoutMsg: `${CASE_MARKER}: 远端Project scope Hook没有Write远端`,
      },
    );
    facts.remoteConfigHasRemoteMarker = true;
    const localAfterRemote = await readLocalFile(localConfigPath, 0);
    expect(localAfterRemote).toContain(LOCAL_MARKER);
    expect(localAfterRemote).not.toContain(REMOTE_MARKER);
    expect(remoteConfig).not.toContain(LOCAL_MARKER);
    await browser.saveScreenshot(resolve(artifactDir, "hooks-scopes.png")).catch(() => undefined);
  });
});
