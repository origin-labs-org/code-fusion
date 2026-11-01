import { reloadElectronSessionPreservingBrowserProfile } from "#e2e/helpers/e2e-electron-reload";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { clearAppData, getE2EAppDataPaths, readSettings } from "#e2e/helpers/desktop-app";
import { waitForRendererAfterColdRestart } from "#e2e/helpers/ssh-remote-lifecycle";
import {
  clickLastEnabledSSHDialogButton,
  fillSSHPasswordSettings,
  openSSHRemoteDialog,
  openSSHSourceDirectory,
  readSSHRuntimeConfig,
  selectSSHRemoteDirectory,
  waitForRemoteTab,
  waitForSSHDirectoryStep,
} from "#e2e/helpers/ssh-remote-p0";
import { prepareV4ConversationE2E } from "#e2e/helpers/v4-conversation";
import {
  holdBoundaryConnection,
  holdBoundarySetting,
  releaseBoundarySetting,
  restoreBoundaryProbes,
} from "#e2e/helpers/remote-boundary-probe";

const CASE_MARKER = "E2E_R3_BOUNDARY_ACK";
const artifactDir = resolve(process.env.CF_E2E_ARTIFACT_DIR ?? ".e2e-artifacts/r3-boundary-ack");
const BOUNDARY = '[data-testid="source-server-boundary-dialog"]';
const STRICT_BOUNDARY = { allowBoundaryAcknowledgement: false };

async function readCredentialPresence() {
  const settings = await readSettings();
  const credentials = JSON.parse(await readFile(getE2EAppDataPaths().credentialsFile, "utf8"));
  const keys = (settings.connectionProfiles ?? [])
    .map((profile) =>
      profile.target.kind === "ssh" ? profile.target.passwordCredentialKey : undefined,
    )
    .filter((key): key is string => typeof key === "string");
  return {
    passwordRefs: keys.length,
    presentRefs: keys.filter((key) => Object.hasOwn(credentials, key)).length,
  };
}

describe(`${CASE_MARKER}: 首次主动Connect的持续Run介绍`, () => {
  const facts: Record<string, unknown> = {};
  after(async () => {
    await restoreBoundaryProbes();
    facts.credentialsAtEnd = await readCredentialPresence().catch(() => ({ readable: false }));
    await mkdir(artifactDir, { recursive: true });
    await writeFile(resolve(artifactDir, "boundary-ack.json"), JSON.stringify(facts, null, 2));
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("R3A-UI-04/RDUX-11 Must click \"Got it\" on first connection to mark as read; no duplicates for second project and after app restart", async function () {
    this.timeout(15 * 60_000);
    const config = readSSHRuntimeConfig(CASE_MARKER);
    await prepareV4ConversationE2E({ skipProvider: true });
    expect((await readSettings()).remoteBoundaryIntroAcknowledgedVersion ?? 0).toBeLessThan(1);
    await openSSHRemoteDialog(CASE_MARKER);
    await fillSSHPasswordSettings(config);
    await holdBoundaryConnection();
    await clickLastEnabledSSHDialogButton(CASE_MARKER);
    const intro = $(BOUNDARY);
    await browser.waitUntil(
      async () => {
        if (await browser.electron.execute(() => Boolean(globalThis.__boundaryConnection?.held)))
          return true;
        return browser.execute(() => {
          const install = Array.from(
            document.querySelectorAll<HTMLButtonElement>('[data-testid="ssh-dialog"] button'),
          ).find(
            (button) =>
              button.getClientRects().length > 0 &&
              !button.disabled &&
              /^(Install and continue|Install and continue)$/u.test(button.textContent?.trim() ?? ""),
          );
          install?.click();
          return false;
        });
      },
      { timeout: 180_000, interval: 500, timeoutMsg: `${CASE_MARKER}: 真实Connect没有到达Completed屏障` },
    );
    await $('[data-testid="ssh-dialog"]').$('.//button[normalize-space(.)="关闭"]').click();
    const cancel = $('[data-testid="confirm-dialog-confirm"]')
      .$("..")
      .$('.//button[span[normalize-space(.)="取消"]]');
    await cancel.waitForDisplayed();
    await holdBoundarySetting("get");
    await browser.electron.execute(() => globalThis.__boundaryConnection?.release());
    await browser.waitUntil(
      () => browser.execute(() => Boolean(window.__boundarySetting?.requests.length)),
      { timeout: 30_000, timeoutMsg: `${CASE_MARKER}: ConnectCompleted后没有Read介绍Status` },
    );
    await releaseBoundarySetting("get");
    expect(await intro.isExisting()).toBe(false);
    await cancel.click();
    await intro.waitForDisplayed({ timeout: 180_000 });
    expect((await readSettings()).remoteBoundaryIntroAcknowledgedVersion ?? 0).toBeLessThan(1);
    expect(await intro.getText()).toMatch(
      /Offline locally, tasks continue running|Local offline, tasks keep running/u,
    );
    expect(await intro.$('[data-testid="confirm-dialog-cancel"]').isExisting()).toBe(false);
    await browser.keys("Escape");
    expect(await intro.isDisplayed()).toBe(true);
    expect((await readSettings()).remoteBoundaryIntroAcknowledgedVersion ?? 0).toBeLessThan(1);
    await mkdir(artifactDir, { recursive: true });
    await browser.saveScreenshot(resolve(artifactDir, "first-connect-intro.png"));
    await holdBoundarySetting("update");
    await intro.$('[data-testid="confirm-dialog-confirm"]').click();
    await intro.waitForDisplayed({ reverse: true });
    await browser.waitUntil(
      () => browser.execute(() => Boolean(window.__boundarySetting?.requests.length)),
      { timeout: 15_000, timeoutMsg: `${CASE_MARKER}: confirm后没有Save介绍Status` },
    );
    await $('[data-testid="ssh-dialog"] button[title^="收起"]').click();
    await $('[data-testid="ssh-dialog"]').waitForDisplayed({ reverse: true });
    await releaseBoundarySetting("update");
    await browser.waitUntil(
      async () => (await readSettings()).remoteBoundaryIntroAcknowledgedVersion === 1,
      { timeout: 15_000, timeoutMsg: `${CASE_MARKER}: 明确确认后没有Save已读Status` },
    );
    const background = $('[data-testid="remote-connection-minimized"]');
    await background.waitForDisplayed();
    expect(await intro.isExisting()).toBe(false);
    expect(await $('[data-testid="virtual-project-name"]').isDisplayed()).toBe(false);
    await browser.saveScreenshot(resolve(artifactDir, "acknowledged-in-background.png"));
    await background.click();
    await waitForSSHDirectoryStep(CASE_MARKER, undefined, STRICT_BOUNDARY);
    await $('[data-testid="virtual-project-name"]').waitForDisplayed();
    expect(await intro.isExisting()).toBe(false);
    await $('[data-testid="virtual-project-browse"]').click();
    await $('[data-testid="virtual-project-directory-browser"]').waitForDisplayed();
    expect(await intro.isExisting()).toBe(false);
    expect((await readSettings()).remoteBoundaryOnboardingVersion).not.toBe(3);
    facts.explicitAcknowledgement = true;
    facts.rollbackCompatibleAcknowledgement = true;
    facts.occupiedConfirmationRecovered = true;
    facts.persistenceMinimizeDeferredUntilContinue = true;
    await restoreBoundaryProbes();
    await selectSSHRemoteDirectory(config.workspacePaths[0], CASE_MARKER);
    const first = await waitForRemoteTab({
      caseMarker: CASE_MARKER,
      expectedPath: config.workspacePaths[0],
    });
    facts.firstIdentity = first.workspaceIdentity;

    await openSSHSourceDirectory(config, CASE_MARKER);
    await waitForSSHDirectoryStep(CASE_MARKER, undefined, STRICT_BOUNDARY);
    expect(await intro.isExisting()).toBe(false);
    await selectSSHRemoteDirectory(config.workspacePaths[1], CASE_MARKER);
    await waitForRemoteTab({ caseMarker: CASE_MARKER, expectedPath: config.workspacePaths[1] });
    facts.secondProjectIntroductionAbsent = true;

    facts.credentialsBeforeRestart = await readCredentialPresence();
    expect(facts.credentialsBeforeRestart).toEqual({ passwordRefs: 1, presentRefs: 1 });
    await reloadElectronSessionPreservingBrowserProfile(browser);
    await waitForRendererAfterColdRestart(CASE_MARKER);
    expect((await readSettings()).remoteBoundaryIntroAcknowledgedVersion).toBe(1);
    await waitForRemoteTab({
      caseMarker: CASE_MARKER,
      expectedPath: config.workspacePaths[1],
      requireActive: false,
      timeoutMs: 180_000,
    });
    await openSSHSourceDirectory(config, CASE_MARKER);
    await waitForSSHDirectoryStep(CASE_MARKER, undefined, STRICT_BOUNDARY);
    expect(await intro.isExisting()).toBe(false);
    facts.restartIntroductionAbsent = true;
    facts.credentialsAfterRestart = await readCredentialPresence();
    expect(facts.credentialsAfterRestart).toEqual({ passwordRefs: 1, presentRefs: 1 });
  });
});
