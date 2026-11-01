import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { TID_TERMINAL, TID_TERMINAL_TOGGLE } from "@origin-ai/cf-shared/test-ids";
import { clearAppData, clickTestIdByDom, waitForTestIdByDom } from "../../../helpers/desktop-app.js";
import {
  connectSSHWorkspaceAndSendFirstTurn,
  prepareSSHLifecycle,
  type SSHLifecycleProvider,
} from "../../../helpers/ssh-remote-lifecycle.js";
import {
  readHostProcesses,
  readRemoteTabSnapshot,
  runSSHCommand,
  waitForRemoteTab,
  type SSHConnectionConfig,
} from "../../../helpers/ssh-remote-p0.js";
import { selectV4TaskById } from "../../../helpers/v4-conversation.js";

const CASE_MARKER = "E2E_R3_TERMINAL";
const artifactDir = resolve(process.env.CF_E2E_ARTIFACT_DIR ?? ".e2e-artifacts/r3-terminal");
const run = promisify(execFile);

async function severDesktopSshSessions(container: string): Promise<string> {
  const script = [
    "target_uid=$(id -u dev); killed=''",
    "for d in /proc/[0-9]*; do p=${d#/proc/}; [ \"$p\" = 1 ] && continue",
    "c=$(tr '\\0' ' ' < \"$d/cmdline\" 2>/dev/null) || continue; case \"$c\" in *sshd*) ;; *) continue;; esac",
    "uid=$(awk '/^Uid:/ {print $2}' \"$d/status\"); [ \"$uid\" = \"$target_uid\" ] || continue",
    "parent=$(awk '{print $4}' \"$d/stat\"); kill -9 \"$p\" 2>/dev/null && killed=\"$killed $p\"",
    "[ \"$parent\" != 1 ] && kill -9 \"$parent\" 2>/dev/null && killed=\"$killed $parent\"; done",
    "echo $killed",
  ].join("; ");
  return (await run("docker", ["exec", container, "sh", "-c", script])).stdout.trim();
}

async function countRemoteShells(config: SSHConnectionConfig, workspacePath: string): Promise<number> {
  const result = await runSSHCommand(
    config,
    `n=0; for d in /proc/[0-9]*; do c=$(tr "\\0" " " < "$d/cmdline" 2>/dev/null) || continue; case "$c" in *bas[h]*|*zs[h]*|*"/bin/s"[h]*) [ "$(readlink $d/cwd 2>/dev/null)" = "${workspacePath}" ] && n=$((n+1));; esac; done; echo $n`,
  );
  return Number.parseInt(result.stdout.trim() || "0", 10);
}

async function selectWorkspaceTab(taskId: string): Promise<void> {
  await selectV4TaskById(taskId, 30_000);
}

async function openTerminalAndWaitPrompt(): Promise<void> {
  const open = await browser.execute(
    (terminalTestId) =>
      Array.from(document.querySelectorAll<HTMLElement>(`[data-testid="${terminalTestId}"] .xterm-rows`)).some(
        (row) => row.offsetParent !== null,
      ),
    TID_TERMINAL,
  );
  if (!open) {
    await clickTestIdByDom(TID_TERMINAL_TOGGLE, { timeoutMsg: `${CASE_MARKER}: Terminal 入口不可点击` });
  }
  await waitForTestIdByDom(TID_TERMINAL, { timeout: 30_000, timeoutMsg: `${CASE_MARKER}: Terminal 没有打开` });
  await browser.waitUntil(
    async () => {
      const text = await terminalText();
      return /[$#]\s*$/.test(text) || /TICK|R3_TERM/u.test(text);
    },
    { timeout: 45_000, timeoutMsg: `${CASE_MARKER}: 远端 shell Notice符未出现` },
  );
}

async function typeInTerminal(command: string): Promise<void> {
  await browser.execute((terminalTestId) => {
    const areas = Array.from(
      document.querySelectorAll<HTMLTextAreaElement>(
        `[data-testid="${terminalTestId}"] .xterm-helper-textarea`,
      ),
    );
    const visible = areas.filter((area) => area.closest<HTMLElement>(".xterm")?.offsetParent !== null);
    (visible.at(-1) ?? areas.at(-1))?.focus();
  }, TID_TERMINAL);
  const chunks = command.match(/.{1,16}/gu) ?? [command];
  let typed = "";
  for (const chunk of chunks) {
    let echoed = false;
    for (let attempt = 0; attempt < 4 && !echoed; attempt += 1) {
      await browser.keys(chunk.split(""));
      const expectedTail = (typed + chunk).slice(-12);
      echoed = await browser
        .waitUntil(async () => (await terminalText()).includes(expectedTail), { timeout: 8000, interval: 200 })
        .then(() => true)
        .catch(() => false);
      if (!echoed) {
        await browser.execute((terminalTestId) => {
          const areas = Array.from(
            document.querySelectorAll<HTMLTextAreaElement>(`[data-testid="${terminalTestId}"] .xterm-helper-textarea`),
          );
          areas.at(-1)?.focus();
        }, TID_TERMINAL);
        await browser.keys(Array.from({ length: chunk.length }, () => "Backspace"));
      }
    }
    if (!echoed) throw new Error(`${CASE_MARKER}: Terminal未回显Input块 ${chunk}`);
    typed += chunk;
  }
  await browser.keys(["Enter"]);
}

async function terminalText(): Promise<string> {
  return browser.execute((terminalTestId) => {
    const rows = Array.from(
      document.querySelectorAll<HTMLElement>(`[data-testid="${terminalTestId}"] .xterm-rows`),
    );
    const visible = rows.filter((row) => row.getClientRects().length > 0 && row.offsetParent !== null);
    return (visible.at(-1) ?? rows.at(-1))?.textContent ?? "";
  }, TID_TERMINAL);
}

async function waitTerminalIncludes(marker: string, timeout = 60_000): Promise<string> {
  let text = "";
  await browser.waitUntil(
    async () => {
      text = await terminalText();
      return text.includes(marker);
    },
    { timeout, interval: 300, timeoutMsg: `${CASE_MARKER}: Terminal 没有Show ${marker}` },
  );
  return text;
}

function tickCount(text: string): number {
  return (text.match(/TICK-\d+/gu) ?? []).length;
}

function maxTick(text: string): number {
  return Math.max(0, ...Array.from(text.matchAll(/TICK-(\d+)/gu), (match) => Number(match[1])));
}

async function isTerminalPanelHidden(): Promise<boolean> {
  return browser.execute((terminalTestId) => {
    const sections = Array.from(
      document.querySelectorAll<HTMLElement>(`[data-testid="${terminalTestId}"]`),
    ).filter((section) => section.querySelector(".xterm-rows"));
    if (sections.length === 0) return false;
    return sections.every((section) => {
      if (section.closest('[aria-hidden="true"]')) return true;
      const panel = section.closest<HTMLElement>("[data-panel]");
      return Boolean(panel) && panel!.getBoundingClientRect().height === 0;
    });
  }, TID_TERMINAL);
}

async function captureTerminalPanelDiagnostics(): Promise<Record<string, unknown>> {
  return browser.execute(
    (terminalTestId, toggleTestId) => {
      const section = document.querySelector<HTMLElement>(`[data-testid="${terminalTestId}"]`);
      const ariaChain: string[] = [];
      let node: HTMLElement | null = section;
      while (node && ariaChain.length < 12) {
        if (node.hasAttribute("aria-hidden")) {
          ariaChain.push(`${node.tagName.toLowerCase()}:${node.getAttribute("aria-hidden")}`);
        }
        node = node.parentElement;
      }
      const panel =
        section?.closest<HTMLElement>("[data-panel]") ?? section?.closest<HTMLElement>("[data-panel-id]");
      const toggle = document.querySelector<HTMLButtonElement>(`[data-testid="${toggleTestId}"]`);
      const sectionRect = section?.getBoundingClientRect();
      const sections = Array.from(
        document.querySelectorAll<HTMLElement>(`[data-testid="${terminalTestId}"]`),
      ).map((item) => {
        const ancestors: string[] = [];
        let cursor = item.parentElement;
        while (cursor && ancestors.length < 4) {
          ancestors.push(`${cursor.tagName.toLowerCase()}${cursor.dataset.panel !== undefined ? "[data-panel]" : ""}${cursor.hasAttribute("aria-hidden") ? `[aria-hidden=${cursor.getAttribute("aria-hidden")}]` : ""}`);
          cursor = cursor.parentElement;
        }
        return {
          ancestors,
          hasXtermRows: Boolean(item.querySelector(".xterm-rows")),
          height: Math.round(item.getBoundingClientRect().height),
          panelHeight: Math.round(item.closest("[data-panel]")?.getBoundingClientRect().height ?? -1),
        };
      });
      return {
        ariaChain,
        sections,
        activeElement: document.activeElement?.tagName.toLowerCase() ?? null,
        panel: panel
          ? {
              flexGrow: getComputedStyle(panel).flexGrow,
              height: Math.round(panel.getBoundingClientRect().height),
              opacity: getComputedStyle(panel).opacity,
            }
          : null,
        sectionCount: document.querySelectorAll(`[data-testid="${terminalTestId}"]`).length,
        sectionHeight: sectionRect ? Math.round(sectionRect.height) : null,
        toggleCount: document.querySelectorAll(`[data-testid="${toggleTestId}"]`).length,
        toggleDisabled: toggle?.disabled ?? null,
        toggleSelected: toggle?.className.includes("bg-selected") ?? null,
      };
    },
    TID_TERMINAL,
    TID_TERMINAL_TOGGLE,
  );
}

async function clickTerminalButtonByLabel(labels: string[]): Promise<void> {
  const clicked = await browser.execute(
    (terminalTestId, candidates) => {
      const buttons = Array.from(
        document.querySelectorAll<HTMLButtonElement>(`[data-testid="${terminalTestId}"] button[aria-label]`),
      );
      const target = buttons.find((button) => candidates.includes(button.getAttribute("aria-label") ?? ""));
      target?.click();
      return Boolean(target);
    },
    TID_TERMINAL,
    labels,
  );
  if (!clicked) throw new Error(`${CASE_MARKER}: Terminal面板没有找到按钮 ${labels.join("/")}`);
}

async function closeActiveTerminalTab(): Promise<void> {
  const clicked = await browser.execute((terminalTestId) => {
    const contents = Array.from(
      document.querySelectorAll<HTMLElement>(`[data-testid="${terminalTestId}"] [data-terminal-tab-content]`),
    );
    const activeTrigger = contents
      .map((content) => content.parentElement)
      .find((trigger) => trigger?.hasAttribute("data-active"));
    const close = activeTrigger?.querySelector<HTMLButtonElement>("button");
    close?.click();
    return Boolean(close);
  }, TID_TERMINAL);
  if (!clicked) throw new Error(`${CASE_MARKER}: 没有找到激活Terminal tab 的Close按钮`);
}

describe(`${CASE_MARKER}: 远端TerminalLongCommand、跨 workspace 归属、断线恢复与Close回收`, () => {
  let provider: SSHLifecycleProvider | null = null;
  const facts: Record<string, unknown> = {};
  let releaseLongCommand: (() => Promise<unknown>) | undefined;

  after(async () => {
    await releaseLongCommand?.().catch(() => undefined);
    await mkdir(artifactDir, { recursive: true });
    await writeFile(resolve(artifactDir, "terminal.json"), JSON.stringify(facts, null, 2));
    await provider?.tunnel.close().catch(() => undefined);
    provider = null;
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("R3A-DEV-03 Continuous output of long command in terminal A; switching to terminal B shows correct cwd; terminal A output retained after reconnect; closing terminal reclaims remote PTY", async function () {
    this.timeout(30 * 60_000);
    const container = process.env.CF_E2E_SSH_CONTAINER?.trim();
    if (!container) throw new Error(`${CASE_MARKER}: Missing CF_E2E_SSH_CONTAINER`);
    const prepared = await prepareSSHLifecycle(CASE_MARKER, { tunnelUsername: "tunnel" });
    provider = prepared.provider;
    const [workspaceA, workspaceB] = prepared.config.workspacePaths;
    const releaseFile = `.r3-terminal-${Date.now().toString(36)}.stop`;
    releaseLongCommand = () => runSSHCommand(prepared.config, `: > '${workspaceA}/${releaseFile}'`);
    const shellsBeforeA = await countRemoteShells(prepared.config, workspaceA);
    const shellsBeforeB = await countRemoteShells(prepared.config, workspaceB);

    const taskA = await connectSSHWorkspaceAndSendFirstTurn({
      caseMarker: CASE_MARKER,
      config: prepared.config,
      label: "A",
      provider,
      workspacePath: workspaceA,
    });
    const taskB = await connectSSHWorkspaceAndSendFirstTurn({
      caseMarker: CASE_MARKER,
      config: prepared.config,
      label: "B",
      provider,
      workspacePath: workspaceB,
    });
    const hosts = await readHostProcesses();

    await selectWorkspaceTab(taskA.taskId);
    await waitForRemoteTab({ caseMarker: CASE_MARKER, expectedIdentity: taskA.identity, expectedPath: workspaceA });
    await openTerminalAndWaitPrompt();
    await typeInTerminal(`pwd; i=0; while [ ! -f ${releaseFile} ]; do i=$((i+1)); echo TICK-$i; sleep 1; done; rm -f ${releaseFile}`);
    const aText = await waitTerminalIncludes("TICK-3");
    expect(aText).toContain(workspaceA);
    await browser.waitUntil(async () => (await countRemoteShells(prepared.config, workspaceA)) > shellsBeforeA, {
      timeout: 30_000,
      timeoutMsg: `${CASE_MARKER}: 远端没有出现 A 的 PTY shell`,
    });
    facts.shellsA = { before: shellsBeforeA, during: await countRemoteShells(prepared.config, workspaceA) };

    await selectWorkspaceTab(taskB.taskId);
    await waitForRemoteTab({ caseMarker: CASE_MARKER, expectedIdentity: taskB.identity, expectedPath: workspaceB });
    await openTerminalAndWaitPrompt();
    await browser.waitUntil(async () => !(await terminalText()).includes("TICK-"), {
      timeout: 15_000,
      timeoutMsg: `${CASE_MARKER}: 切到 B 后Terminal仍Show A 的Output`,
    });
    let bText = "";
    for (let attempt = 0; attempt < 3 && !bText.includes("R3_TERM_B_MARK"); attempt += 1) {
      await browser.pause(1500);
      await typeInTerminal('pwd; echo R3_TERM_B_"MARK"');
      bText = await waitTerminalIncludes("R3_TERM_B_MARK", 20_000).catch(async () => terminalText());
      const attempts = (facts.bAttempts as string[] | undefined) ?? [];
      attempts.push(bText.slice(-200));
      facts.bAttempts = attempts;
    }
    expect(bText).toContain("R3_TERM_B_MARK");
    expect(bText).toContain(workspaceB);
    expect(bText).not.toContain("TICK-");
    const shellsDuringB = await countRemoteShells(prepared.config, workspaceB);
    expect(shellsDuringB).toBeGreaterThan(shellsBeforeB);
    facts.shellsB = { before: shellsBeforeB, during: shellsDuringB };

    await selectWorkspaceTab(taskA.taskId);
    await waitForRemoteTab({ caseMarker: CASE_MARKER, expectedIdentity: taskA.identity, expectedPath: workspaceA });
    await openTerminalAndWaitPrompt();
    const beforeSever = maxTick(await waitTerminalIncludes("TICK-", 30_000));
    let afterSwitch = beforeSever;
    await browser.waitUntil(async () => {
      afterSwitch = maxTick(await terminalText());
      return afterSwitch > beforeSever;
    }, { timeout: 20_000, timeoutMsg: `${CASE_MARKER}: 切回 A 后Output没有Continue增Long` });
    expect(afterSwitch).toBeGreaterThan(beforeSever);
    facts.ticksAcrossTabSwitch = { beforeSever, afterSwitch };

    facts.severed = await severDesktopSshSessions(container);
    await browser.waitUntil(
      async () => {
        const snapshot = await readRemoteTabSnapshot(taskA.identity).catch(() => null);
        return Boolean(snapshot?.remoteSessionId && snapshot.remoteSessionId !== taskA.remoteSessionId);
      },
      { timeout: 120_000, interval: 1000, timeoutMsg: `${CASE_MARKER}: 断连后没有Auto换代` },
    );
    await selectWorkspaceTab(taskA.taskId);
    await openTerminalAndWaitPrompt();
    const recoveredText = await waitTerminalIncludes("TICK-", 60_000);
    expect(recoveredText).not.toContain("R3_TERM_B_MARK");
    facts.terminalAfterRecovery = {
      ticks: tickCount(recoveredText),
      containsDone: recoveredText.includes("R3_TERM_A_DONE"),
      remoteShellsA: await countRemoteShells(prepared.config, workspaceA),
    };
    expect(await readHostProcesses()).toEqual(hosts);

    const shellsBeforeCollapse = await countRemoteShells(prepared.config, workspaceA);
    const maxTickBeforeCollapse = maxTick(await terminalText());
    await clickTestIdByDom(TID_TERMINAL_TOGGLE, { timeoutMsg: `${CASE_MARKER}: Terminal Close入口不可点击` });
    await browser.waitUntil(() => isTerminalPanelHidden(), {
      timeout: 15_000,
      timeoutMsg: `${CASE_MARKER}: Terminal面板没有Collapse`,
    });
    facts.panelCollapsed = await captureTerminalPanelDiagnostics();
    facts.shellsWhileCollapsed = await countRemoteShells(prepared.config, workspaceA);
    expect(facts.shellsWhileCollapsed).toBe(shellsBeforeCollapse);
    await clickTestIdByDom(TID_TERMINAL_TOGGLE, { timeoutMsg: `${CASE_MARKER}: Terminal 展开入口不可点击` });
    await browser.waitUntil(async () => !(await isTerminalPanelHidden()), {
      timeout: 15_000,
      timeoutMsg: `${CASE_MARKER}: Terminal面板没有重New展开`,
    });
    const reopenedText = await waitTerminalIncludes("TICK-", 30_000);
    facts.maxTickAroundCollapse = { before: maxTickBeforeCollapse, afterReopen: maxTick(reopenedText) };
    expect(maxTick(reopenedText)).toBeGreaterThanOrEqual(maxTickBeforeCollapse);

    const shellsBeforeNewTab = await countRemoteShells(prepared.config, workspaceA);
    await clickTerminalButtonByLabel(["新建终端", "New terminal"]);
    await browser.waitUntil(
      async () => (await countRemoteShells(prepared.config, workspaceA)) > shellsBeforeNewTab,
      { timeout: 30_000, timeoutMsg: `${CASE_MARKER}: New Terminal tab 后远端没有出现New的 PTY shell` },
    );
    await openTerminalAndWaitPrompt();
    facts.shellsWithSecondTab = await countRemoteShells(prepared.config, workspaceA);
    await closeActiveTerminalTab();
    let shellsAfterTabClose = facts.shellsWithSecondTab as number;
    await browser.waitUntil(
      async () => {
        shellsAfterTabClose = await countRemoteShells(prepared.config, workspaceA);
        return shellsAfterTabClose <= shellsBeforeNewTab;
      },
      { timeout: 60_000, interval: 2000, timeoutMsg: `${CASE_MARKER}: CloseTerminal tab 后Remote PTY 未回收` },
    );
    facts.shellsAfterTabClose = { beforeNewTab: shellsBeforeNewTab, afterClose: shellsAfterTabClose };
    expect(await waitTerminalIncludes("TICK-", 30_000)).toContain("TICK-");
    facts.shellsB_afterAClose = await countRemoteShells(prepared.config, workspaceB);
    expect(facts.shellsB_afterAClose).toBe(shellsDuringB);
  });
});
