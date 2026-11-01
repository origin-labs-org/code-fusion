import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  TID_SETTINGS_BACK_BUTTON,
  TID_SETTINGS_DATA_BASE_DIR_BROWSE,
  TID_SETTINGS_DATA_BASE_DIR_INPUT,
  TID_SETTINGS_DATA_BASE_DIR_SAVE,
  TID_SETTINGS_DATA_BASE_DIR_STATUS,
  TID_SETTINGS_PAGE,
  TID_SETTINGS_SECTION_NAV,
  TID_TASK_SETTINGS_BUTTON,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import {
  clearAppData,
  clickTestIdByDom,
  getE2EAppDataPaths,
  waitForTestIdByDom,
} from "../../../helpers/desktop-app.js";
import { resolveE2ERuntimePath } from "../../../helpers/e2e-runtime-paths.js";
import { reloadElectronSessionPreservingBrowserProfile } from "#e2e/helpers/e2e-electron-reload";
import { waitForRendererAfterColdRestart } from "#e2e/helpers/ssh-remote-lifecycle";
import { prepareV4ConversationE2E } from "../../../helpers/v4-conversation.js";
import {
  clickLastEnabledSSHDialogButton,
  fillSSHPasswordSettings,
  openSSHRemoteDialog,
  readSSHRuntimeConfig,
  runSSHCommand,
  completeSSHProjectConnection,
} from "../../../helpers/ssh-remote-p0.js";

const CASE_MARKER = "E2E_R3_DESKTOP_SETTINGS_AUTHORITY";
const paths = getE2EAppDataPaths();
const customRoot = resolveE2ERuntimePath("r3-desktop-settings-authority", "data");
const artifactDir = resolve(
  process.env.CF_E2E_ARTIFACT_DIR ?? ".e2e-artifacts/r3-desktop-settings-authority",
);
const hardwareSelector =
  '[role="switch"][aria-label="Chrome hardware acceleration"], [role="switch"][aria-label="Chrome hardware acceleration"]';
const certificateSelector =
  '[role="switch"][aria-label="Ignore certificate errors"], [role="switch"][aria-label="Ignore certificate errors"]';
const canary = "r3-desktop-settings-canary.txt";

async function openSection(section: string) {
  if (!(await $(`[data-testid="${TID_SETTINGS_PAGE}"]`).isExisting())) {
    await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON, { timeout: 15_000 });
    await waitForTestIdByDom(TID_SETTINGS_PAGE, { timeout: 15_000 });
  }
  await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, section), { timeout: 15_000 });
}

async function localSettings(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(paths.appDataDir, "setting.json"), "utf8"));
}

async function setSwitch(selector: string, checked: boolean) {
  const control = $(selector);
  await control.waitForExist({ timeout: 15_000 });
  if ((await control.getAttribute("aria-checked")) !== String(checked)) {
    await control.scrollIntoView();
    await control.click();
  }
  await browser.waitUntil(
    async () => (await control.getAttribute("aria-checked")) === String(checked),
    { timeout: 15_000 },
  );
}

describe(`${CASE_MARKER}: 远端激活时DesktopSettings仍属于Local machine`, () => {
  const facts: Record<string, unknown> = {};
  after(async () => {
    await mkdir(artifactDir, { recursive: true });
    await writeFile(join(artifactDir, "settings-authority.json"), JSON.stringify(facts, null, 2));
    await browser.electron.restoreAllMocks();
    await clearAppData();
    await rm(customRoot, { recursive: true, force: true });
    await rm(join(paths.appDataDir, canary), { force: true });
  });

  it("R3A-DEV-06-desktop-authority Saves local settings and data directory, Source not polluted, reads local values on cold restart", async function () {
    this.timeout(8 * 60_000);
    const config = readSSHRuntimeConfig(CASE_MARKER);
    await prepareV4ConversationE2E({ skipProvider: true });
    await openSSHRemoteDialog(CASE_MARKER);
    await fillSSHPasswordSettings(config);
    await clickLastEnabledSSHDialogButton(CASE_MARKER);
    const conversation = await completeSSHProjectConnection(config, CASE_MARKER);
    facts.workspaceIdentity = conversation.workspaceIdentity;
    const readSourceSettings = async (): Promise<Record<string, unknown>> => {
      const result = await runSSHCommand(config, 'cat "$HOME/.cf/v2/setting.json"');
      expect(result.code).toBe(0);
      return JSON.parse(result.stdout);
    };
    const sourceBefore = await readSourceSettings();
    const localBefore = await localSettings();
    await openSection("general");
    const hardwareEnabled = !(localBefore.desktopChromiumHardwareAccelerationEnabled ?? true);
    await setSwitch(hardwareSelector, hardwareEnabled);
    await browser.waitUntil(
      async () =>
        (await localSettings()).desktopChromiumHardwareAccelerationEnabled === hardwareEnabled,
      { timeout: 15_000, timeoutMsg: "Hardware acceleration not saved to Desktop" },
    );

    const archiveEnabled = !(sourceBefore.taskAutoArchiveEnabled ?? false);
    await openSection("archives");
    const archiveSelector = '[data-testid="archive-auto-archive-switch"]';
    await setSwitch(archiveSelector, archiveEnabled);
    await browser.waitUntil(
      async () => (await readSourceSettings()).taskAutoArchiveEnabled === archiveEnabled,
      { timeout: 15_000 },
    );
    expect((await localSettings()).taskAutoArchiveEnabled).toEqual(
      localBefore.taskAutoArchiveEnabled,
    );
    facts.sourceArchiveUpdated = true;

    await openSection("browser");
    const certificatesEnabled = !(localBefore.embeddedBrowserAllowInsecureCertificates ?? false);
    await setSwitch(certificateSelector, certificatesEnabled);
    await browser.waitUntil(
      async () =>
        (await localSettings()).embeddedBrowserAllowInsecureCertificates === certificatesEnabled,
      { timeout: 15_000, timeoutMsg: "Browser certificate policy not saved to Desktop" },
    );
    await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON, { timeout: 15_000 });
    await openSection("general");
    await browser.waitUntil(
      async () =>
        (await $(hardwareSelector).getAttribute("aria-checked")) === String(hardwareEnabled),
      { timeout: 15_000 },
    );
    await openSection("browser");
    await browser.waitUntil(
      async () =>
        (await $(certificateSelector).getAttribute("aria-checked")) === String(certificatesEnabled),
      { timeout: 15_000 },
    );
    facts.localReadAfterRemount = true;

    await openSection("general");
    await mkdir(customRoot, { recursive: true });
    await writeFile(join(paths.appDataDir, canary), CASE_MARKER);
    const picker = await browser.electron.mock("dialog", "showOpenDialog");
    await picker.mockResolvedValueOnce({ canceled: false, filePaths: [customRoot] });
    await clickTestIdByDom(TID_SETTINGS_DATA_BASE_DIR_BROWSE, { timeout: 15_000 });
    await browser.waitUntil(
      async () =>
        (await $(`[data-testid="${TID_SETTINGS_DATA_BASE_DIR_INPUT}"]`).getValue()) === customRoot,
      { timeout: 15_000 },
    );
    const oldPid = await browser.electron.execute(() => process.pid);
    await clickTestIdByDom(TID_SETTINGS_DATA_BASE_DIR_SAVE, { timeout: 15_000 });
    await browser.waitUntil(
      async () =>
        (await $(`[data-testid="${TID_SETTINGS_DATA_BASE_DIR_STATUS}"]`).getAttribute(
          "data-state",
        )) === "saved",
      { timeout: 60_000 },
    );
    expect((await localSettings()).dataBaseDir).toBe(customRoot);
    expect(await readFile(join(customRoot, ".cf/v2", canary), "utf8")).toBe(CASE_MARKER);
    const sourceAfter = await readSourceSettings();
    for (const field of [
      "dataBaseDir",
      "desktopChromiumHardwareAccelerationEnabled",
      "embeddedBrowserAllowInsecureCertificates",
    ]) {
      expect(sourceAfter[field]).toEqual(sourceBefore[field]);
    }
    facts.sourceDesktopSettingsUnchanged = true;
    facts.localCanaryCopied = true;
    const startupCwd = join(customRoot, ".cf", "workspace", "default");
    await expect(stat(startupCwd)).rejects.toMatchObject({ code: "ENOENT" });
    facts.startupCwdAbsentBeforeRestart = true;
    await reloadElectronSessionPreservingBrowserProfile(browser);
    await waitForRendererAfterColdRestart(CASE_MARKER);
    expect(await browser.electron.execute(() => process.pid)).not.toBe(oldPid);
    expect((await stat(startupCwd)).isDirectory()).toBe(true);
    facts.startupCwdReadyAfterRestart = true;
    await openSection("general");
    await browser.waitUntil(
      async () =>
        (await $(`[data-testid="${TID_SETTINGS_DATA_BASE_DIR_INPUT}"]`).getValue()) === customRoot,
      { timeout: 15_000 },
    );
    expect(await $(hardwareSelector).getAttribute("aria-checked")).toBe(String(hardwareEnabled));
    await openSection("browser");
    expect(await $(certificateSelector).getAttribute("aria-checked")).toBe(
      String(certificatesEnabled),
    );
    facts.coldRestartRetainedDesktopSettings = true;
  });
});
