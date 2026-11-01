import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { ServiceChannels, parseRemoteWorkspaceIdentity } from "@origin-ai/cf-shared";
import { clearAppData, readSettings } from "#e2e/helpers/desktop-app";
import {
  callHandoffHost,
  installHandoffRpcProbe,
  restoreHandoffProbes,
} from "#e2e/helpers/remote-project-handoff-probe";
import { prepareSourceServerUpdateArchive } from "#e2e/helpers/source-server-update-fixture";
import { prepareV4ConversationE2E } from "#e2e/helpers/v4-conversation";
import { selectTaskOrganizeMode } from "#e2e/helpers/workspace-agent-warmup";
import {
  connectSSHWorkspace,
  prepareSSHConnectionPage,
  readSSHRuntimeConfig,
} from "#e2e/helpers/ssh-remote-p0";

const CASE_MARKER = "E2E_REMOTE_SIDEBAR_PENDING";
const artifactDir = resolve(
  process.env.CF_E2E_ARTIFACT_DIR ?? ".e2e-artifacts/remote-sidebar-pending",
);
const run = promisify(execFile);

async function setAppearance(locale: "zh-CN" | "en-US", theme: "light" | "dark") {
  await browser.execute(
    (lang, appearance) => {
      const actions = (
        window as Window & {
          __testActions?: {
            setLocale(value: "zh-CN" | "en-US"): void;
            setTheme(value: string): void;
          };
        }
      ).__testActions;
      if (!actions) throw new Error("Missing appearance actions");
      actions.setLocale(lang);
      actions.setTheme(appearance);
    },
    locale,
    theme,
  );
  await browser.executeAsync((done) =>
    requestAnimationFrame(() => requestAnimationFrame(() => done())),
  );
}

async function readRemoteCurrentSha(): Promise<string> {
  const container = process.env.CF_E2E_SSH_CONTAINER?.trim();
  if (!container) throw new Error(`${CASE_MARKER}: Missing CF_E2E_SSH_CONTAINER`);
  const { stdout } = await run(
    "docker",
    [
      "exec",
      "-u",
      process.env.CF_E2E_SSH_USERNAME?.trim() || "dev",
      container,
      "bash",
      "-lc",
      'grep -o \'"archiveSha256": *"[0-9a-f]*"\' "$HOME/.cf/server/current.json" | grep -o "[0-9a-f]\\{64\\}"',
    ],
    { timeout: 30_000 },
  );
  return stdout.trim();
}

describe(`${CASE_MARKER}: 待ProcessingDevice在Project行与DetailsShow具体原因`, () => {
  afterEach(async () => {
    await browser.saveScreenshot(resolve(artifactDir, "last-state.png"));
  });
  after(async () => {
    await restoreHandoffProbes();
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("RDUX-SIDEBAR-PENDING needs-upgrade displays \"Update Required\"; details entry navigates to device card in Settings without auto-updating", async function () {
    this.timeout(15 * 60_000);
    await mkdir(artifactDir, { recursive: true });
    const config = readSSHRuntimeConfig(CASE_MARKER);
    await prepareSSHConnectionPage(CASE_MARKER);
    await prepareV4ConversationE2E({ skipProvider: true });
    const tab = await connectSSHWorkspace({
      caseMarker: CASE_MARKER,
      config,
      workspacePath: config.workspacePaths[0]!,
    });
    const identity = tab.workspaceIdentity!;
    const sourceId = parseRemoteWorkspaceIdentity(identity)?.sourceServerId;
    if (!sourceId) throw new Error(`${CASE_MARKER}: RemoteProjectMissing Source identity`);
    const profileId = (await readSettings()).connectionProfiles?.find(
      (profile) => profile.sourceServerId === sourceId,
    )?.profileId;
    if (!profileId) throw new Error(`${CASE_MARKER}: 找不到Device线路`);

    const shaBefore = await readRemoteCurrentSha();
    const repack = await prepareSourceServerUpdateArchive(shaBefore, CASE_MARKER);
    expect(repack.newSha).not.toBe(shaBefore);

    await installHandoffRpcProbe();
    await callHandoffHost(ServiceChannels.SourceServerManagement, "disconnectSource", [sourceId]);
    await callHandoffHost(ServiceChannels.SourceServerManagement, "connectProfile", [
      profileId,
    ]).catch(() => undefined);

    await selectTaskOrganizeMode(["项目", "Project"]);
    const row = $(`[data-project-workspace-identity=${JSON.stringify(identity)}]`);
    const status = row.$('[data-testid="project-status-label"]');
    await browser.waitUntil(
      async () =>
        (await status.isExisting()) && /^(Update required|Update required)$/u.test(await status.getText()),
      { timeout: 60_000, timeoutMsg: `${CASE_MARKER}: Project行没有Show“Update required”` },
    );
    expect(await status.getAttribute("class")).toContain("text-warning-surface-foreground");
    expect(await row.$('[data-remote-state-icon="cloud-alert"]').isExisting()).toBe(true);
    const directory = await callHandoffHost<{ hosts: { id: string; upgradeTarget?: string }[] }>(
      ServiceChannels.RemoteProjects,
      "readDirectory",
    );
    expect(
      directory.hosts.find((host) => host.id === `remote:server:${sourceId}`)?.upgradeTarget,
    ).toBe("server");

    const details = $('[data-testid="remote-identity-details"]');
    for (const locale of ["zh-CN", "en-US"] as const) {
      for (const theme of ["light", "dark"] as const) {
        await setAppearance(locale, theme);
        expect(
          await browser.execute(
            (el) => el.scrollWidth <= el.clientWidth,
            await status.getElement(),
          ),
        ).toBe(true);
        const outside = await browser.execute(() => ({ x: innerWidth - 24, y: 24 }));
        await browser.action("pointer").move(outside).perform();
        await details.waitForDisplayed({ reverse: true });
        await row.$('[data-testid="virtual-project-toggle"]').moveTo();
        await details.waitForDisplayed();
        await browser.saveScreenshot(resolve(artifactDir, `pending-${locale}-${theme}.png`));
      }
    }
    await setAppearance("zh-CN", "dark");
    const outside = await browser.execute(() => ({ x: innerWidth - 24, y: 24 }));
    await browser.action("pointer").move(outside).perform();
    await details.waitForDisplayed({ reverse: true });
    await row.$('[data-testid="virtual-project-toggle"]').moveTo();
    await details.waitForDisplayed();
    const detailsText = await details.getText();
    expect(detailsText).toMatch(/Update required|Update required/u);
    expect(detailsText).not.toMatch(/Needs Attention|Needs attention/u);
    const buttons = await details.$$("button");
    expect(buttons).toHaveLength(1);
    const entry = details.$('[data-testid="remote-identity-device-settings"]');
    expect(await entry.getText()).toMatch(/Update Remote|Update remote device/u);
    await browser.saveScreenshot(resolve(artifactDir, "pending-details.png"));

    await entry.click();
    await details.waitForDisplayed({ reverse: true });
    const card = $(`[data-source-server-card="${sourceId}"]`);
    await card.waitForDisplayed({ timeout: 15_000 });
    await browser.waitUntil(
      () =>
        browser.execute(
          (id) =>
            document.activeElement === document.querySelector(`[data-source-server-card="${id}"]`),
          sourceId,
        ),
      { timeout: 10_000, timeoutMsg: `${CASE_MARKER}: Settings页没有定位到TargetDevice卡` },
    );
    expect(await card.getText()).toMatch(/Update Remote|Update remote device/u);
    await browser.saveScreenshot(resolve(artifactDir, "device-settings.png"));
    expect(await readRemoteCurrentSha()).toBe(shaBefore);
  });
});
