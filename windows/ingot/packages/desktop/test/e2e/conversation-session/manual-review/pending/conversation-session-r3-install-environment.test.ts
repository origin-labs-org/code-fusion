import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { clearAppData } from "../../../helpers/desktop-app.js";
import { prepareV4ConversationE2E } from "../../../helpers/v4-conversation.js";
import {
  clickLastEnabledSSHDialogButton,
  fillSSHPasswordSettings,
  openSSHRemoteDialog,
  readHostProcesses,
  readRemoteTabSnapshot,
  readSSHRuntimeConfig,
  runSSHCommand,
  selectSSHRemoteDirectory,
  waitForRemoteTab,
  waitForSSHDirectoryStep,
  type SSHConnectionConfig,
  type SSHRuntimeConfig,
} from "../../../helpers/ssh-remote-p0.js";

const CASE_MARKER = "E2E_R3_INSTALL_ENVIRONMENT";
const artifactDir = resolve(
  process.env.CF_E2E_ARTIFACT_DIR ?? ".e2e-artifacts/r3-install-environment",
);
type InstallEnvironmentCase = "noexec-tmp" | "no-tar" | "no-forwarding" | "old-glibc";
const SUBCASE = (process.env.R3_INSTALL_ENV_CASE ?? "") as InstallEnvironmentCase;

async function readRemoteFacts(config: SSHConnectionConfig) {
  const facts = await runSSHCommand(
    config,
    'echo "tmp=$(mount | grep " /tmp " | head -n1)"; echo "tar=$(command -v tar || echo none)"; ' +
      'echo "forwarding=$(grep -iE "^AllowTcpForwarding" /etc/ssh/sshd_config | tail -n1)"; ' +
      'echo "current=$(test -f "$HOME/.cf/server/current.json" && grep -o \'"archiveSha256": *"[0-9a-f]*"\' "$HOME/.cf/server/current.json" || echo none)"; ' +
      'echo "staging=$(ls -d "$HOME"/.cf/server/staging* "$HOME"/.cf/server/bootstrap* 2>/dev/null | tr "\\n" ",")"; ' +
      'echo "serverRoot=$(ls -A "$HOME/.cf/server" 2>/dev/null | tr "\\n" ",")"; ' +
      'echo "libc=$(getconf GNU_LIBC_VERSION 2>/dev/null || echo none)"; ' +
      'echo "tmpEntries=$(ls /tmp 2>/dev/null | tr "\\n" ",")"; echo "status=$(cat "$HOME/.cf/server/run/status.json" 2>/dev/null | tr -d "\\n ")"',
  );
  return Object.fromEntries(
    facts.stdout
      .trim()
      .split("\n")
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  ) as Record<string, string>;
}

async function connectUntilErrorOrReady(config: SSHRuntimeConfig): Promise<{
  errorText: string;
  connectionLog: string;
  ready: boolean;
}> {
  await openSSHRemoteDialog(CASE_MARKER);
  await fillSSHPasswordSettings(config);
  await clickLastEnabledSSHDialogButton(CASE_MARKER);
  try {
    const phase = await waitForSSHDirectoryStep(CASE_MARKER, 180_000);
    expect(phase).toBe("directory");
    await selectSSHRemoteDirectory(config.workspacePaths[0]!, CASE_MARKER);
    const project = await waitForRemoteTab({
      caseMarker: CASE_MARKER,
      expectedPath: config.workspacePaths[0]!,
    });
    expect(project.remoteSessionId).toBeTruthy();
    return { errorText: "", connectionLog: "", ready: true };
  } catch (error) {
    const failure = await browser.execute(() => {
      const panel = document.querySelector<HTMLElement>('[data-testid="ssh-error"]');
      if (!panel?.getClientRects().length) return null;
      return {
        errorText: panel.innerText.trim(),
        connectionLog:
          document.querySelector<HTMLElement>('[data-testid="ssh-dialog"]')?.innerText ?? "",
        ready: false,
      };
    });
    if (!failure) throw error;
    return failure;
  }
}

describe(`${CASE_MARKER}: 受限远端环Context下的Install与Connect（${SUBCASE}）`, () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it(`R3A-BLD-09/CON-06 ${SUBCASE}`, async function () {
    this.timeout(20 * 60_000);
    if (!["noexec-tmp", "no-tar", "no-forwarding", "old-glibc"].includes(SUBCASE)) {
      throw new Error(
        `${CASE_MARKER}: R3_INSTALL_ENV_CASE 必须为 noexec-tmp|no-tar|no-forwarding|old-glibc`,
      );
    }
    const config = readSSHRuntimeConfig(CASE_MARKER);
    const before = await readRemoteFacts(config);
    expect(before.current).toBe("none");
    await prepareV4ConversationE2E({ skipProvider: true });
    const initialHosts = await readHostProcesses();
    expect(initialHosts).toHaveLength(1);

    const outcome = await connectUntilErrorOrReady(config);
    const after = await readRemoteFacts(config);
    const hosts = await readHostProcesses();
    await mkdir(artifactDir, { recursive: true });
    await writeFile(
      resolve(artifactDir, `${SUBCASE}.json`),
      JSON.stringify({ subcase: SUBCASE, before, outcome, after, hosts }, null, 2),
    );
    expect(hosts).toEqual(initialHosts);
    expect(outcome.errorText).not.toContain(config.password);

    if (SUBCASE === "noexec-tmp") {
      expect(before.tmp).toContain("noexec");
      if (!outcome.ready)
        throw new Error(`${CASE_MARKER}: noexec-tmp InstallFailed: ${outcome.errorText}`);
      expect(after.current).toMatch(/archiveSha256/u);
      expect(after.status).toContain('"state":"ready"');
      expect(after.tmpEntries).not.toContain("cf-server");
      return;
    }
    if (SUBCASE === "no-tar") {
      expect(before.tar).toBe("none");
      expect(outcome.ready).toBe(false);
      expect(outcome.errorText).toMatch(/环Context|environment/iu);
      expect(outcome.connectionLog.toLowerCase()).toContain("tar");
      expect(outcome.connectionLog).not.toMatch(/Uploading|上传/u);
      expect(after.current).toBe("none");
      return;
    }
    if (SUBCASE === "old-glibc") {
      expect(before.libc).toBe("glibc 2.17");
      expect(outcome.ready).toBe(false);
      expect(outcome.errorText).toMatch(/环Context|environment/iu);
      expect(outcome.connectionLog).toContain("glibc 2.17");
      expect(outcome.connectionLog).not.toMatch(/Uploading|上传/u);
      expect(after.current).toBe("none");
      expect(after.serverRoot).toBe("");
      return;
    }
    expect((before.forwarding ?? "").toLowerCase()).toContain("allowtcpforwarding no");
    expect(outcome.errorText).toBe("");
    expect(outcome.ready).toBe(true);
    expect(after.current).toMatch(/archiveSha256/u);
    expect(after.status).toContain('"state":"ready"');
    expect(
      (await readRemoteTabSnapshot(undefined, config.workspacePaths[0])).remoteSessionId,
    ).toBeTruthy();
  });
});
