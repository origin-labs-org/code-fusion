import { access, copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import {
  clearAppData,
  getE2EAppDataPaths,
  restoreCliConfig,
  seedCliConfig,
  snapshotCliConfig,
  type CliConfigSnapshot,
} from "../helpers/desktop-app.js";
import { resolveE2ERuntimePath } from "../helpers/e2e-runtime-paths.js";
import { skipOccupationOnboardingIfPresent } from "../helpers/occupation-onboarding.js";
import {
  ELECTRON_WINDOW_RECORDING_CAPTURE_MODE,
  startElectronWindowRecording,
} from "../helpers/electron-window-recorder.js";
import { getLatestUpstreamToolResultByToolCallId } from "../helpers/conversation-session-network.js";
import {
  getV4PaneSnapshot,
  prepareV4ConversationE2E,
  sendV4Prompt,
  switchV4Mode,
  waitForV4PermissionDialogInComposerDock,
  waitForV4TimelineContaining,
} from "../helpers/v4-conversation.js";

const CASE = "conversation-session-permission-hook-rewrite";
const MARKER = "E2E_PERMISSION_HOOK_REWRITE";
const TOOL_ID = "toolu_e2e_permission_hook_rewrite";
const ROOT = resolveE2ERuntimePath(CASE);
const ARTIFACT = join(process.env.CF_E2E_ARTIFACT_DIR ?? process.cwd(), CASE);
const DIALOG =
  '[role="listbox"][aria-label="需要权限"], [role="listbox"][aria-label="需要权限"]';
const ALLOW = '[role="listbox"] [data-permission-option-kind="allowOnce"]';
const DOCK = '[data-v4-composer-dock="true"]';
const RULES = JSON.stringify({ version: 1, ask: [{ toolName: "Write" }] });
const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

interface BrowserObservation {
  commands: Array<{ id: string; at: number; held: boolean }>;
  frames: Array<{ at: number; count: number; text: string }>;
  release: () => void;
  restore: () => void;
}
declare global {
  interface Window {
    __permissionRewriteReview?: BrowserObservation;
  }
}

describe("PermissionRequest Hook 改写后的确认替换", () => {
  let config: CliConfigSnapshot;
  before(async function () {
    this.timeout(120000);
    await mkdir(ROOT, { recursive: true });
    await mkdir(ARTIFACT, { recursive: true });
    const source = fileURLToPath(
      new URL(
        "../fixtures/fs/conversation-session/conversation-session-permission-hook-rewrite/hook.mjs",
        import.meta.url,
      ),
    );
    const script = join(ROOT, "hook.mjs");
    await copyFile(source, script);
    config = await snapshotCliConfig();
    const commandHook = {
      type: "process",
      command: process.execPath,
      args: [script, ROOT],
      timeoutMs: 90000,
    };
    await seedCliConfig({
      hooks: {
        enabled: true,
        timeoutMs: 90000,
        events: {
          PermissionRequest: [{ matcher: "Write", hooks: [commandHook] }],
          PostToolUse: [{ matcher: "Write", hooks: [commandHook] }],
        },
      },
    });
    await skipOccupationOnboardingIfPresent();
    await prepareV4ConversationE2E();
    await switchV4Mode("build");
    await sendV4Prompt(`${MARKER}_SETUP Prepare the approval interaction demonstration.`);
    await waitForV4TimelineContaining(`${MARKER}_READY`, 60000);
    const sessionId = (await getV4PaneSnapshot()).sessionId;
    withDatabase((db) => {
      const session = db.prepare("select project_id from session where id = ?").get(sessionId!) as {
        project_id: string;
      };
      expect(session.project_id).toBeTruthy();
      db.prepare(
        "insert into local_setting (scope, scope_id, namespace, key, value, schema_version, time_created, time_updated) values ('project', ?, 'permission', 'ruleset', ?, 1, ?, ?)",
      ).run(session.project_id, RULES, Date.now(), Date.now());
    });
  });
  after(async () => {
    await browser.execute(() => window.__permissionRewriteReview?.restore());
    if (config) await restoreCliConfig(config);
    await browser.electron.restoreAllMocks();
    await clearAppData();
    await rm(ROOT, { recursive: true, force: true });
  });

  it("DCA-V1-06: Old confirmation replaced by B; late A approval is invalid, and B executes only once", async function () {
    this.timeout(180000);
    await observeAndDelayFirstApproval();
    const recording = process.env.CF_E2E_MANUAL_REVIEW === "1"
      ? await startElectronWindowRecording({
          outputPath: join(ARTIFACT, "approval-replacement.webm"),
          frameIntervalMs: 100,
        })
      : null;
    let staleResponse: Record<string, unknown> | undefined;
    try {
      await sendV4Prompt(
        `${MARKER}_RUN Write A-after-model.txt with the original content exactly once.`,
      );
      await waitForV4PermissionDialogInComposerDock();
      await browser.waitUntil(async () =>
        (await readTrace()).some((item) => item.phase === "started"),
      );
      expect(await $(DOCK).getText()).toContain("A-after-model.txt");
      await browser.saveScreenshot(join(ARTIFACT, "01-original-A.png"));
      expect(await exists(join(ROOT, "A-after-model.txt"))).toBe(false);
      if (recording) await browser.pause(3000);
      await $(ALLOW).click();
      await browser.waitUntil(async () => (await observation()).commands.length === 1, {
        timeout: 10000,
        timeoutMsg: "没有捕获到真实 UI 生成的旧批准命令",
      });
      await writeFile(join(ROOT, "release"), "release Hook rewrite");
      await browser.waitUntil(async () => (await $(DOCK).getText()).includes("B-after-hook.txt"), {
        timeout: 30000,
        timeoutMsg: "Modified B confirmation not displayed after Hook returned",
      });
      await waitForV4PermissionDialogInComposerDock();
      await browser.saveScreenshot(join(ARTIFACT, "02-rewritten-B.png"));
      await browser.execute(() => window.__permissionRewriteReview!.release());
      const oldId = (await observation()).commands[0]!.id;
      await browser.waitUntil(
        async () => {
          staleResponse = await readStaleResponse(oldId);
          return Boolean(staleResponse);
        },
        { timeout: 15000, timeoutMsg: "CLI did not confirm that the old interactionId was invalidated" },
      );
      expect(await $(DOCK).getText()).toContain("B-after-hook.txt");
      expect(await exists(join(ROOT, "B-after-hook.txt"))).toBe(false);
      expect((await readTrace()).filter((item) => item.phase === "executed")).toHaveLength(0);
      await browser.saveScreenshot(join(ARTIFACT, "03-stale-A-still-pending-B.png"));
      if (recording) await browser.pause(3000);
      await $(ALLOW).click();
      await waitForV4TimelineContaining(`${MARKER}_DONE`, 60000);
      await browser.waitUntil(async () =>
        (await readTrace()).some((item) => item.phase === "executed"),
      );
      expect(await exists(join(ROOT, "A-after-model.txt"))).toBe(false);
      expect(await readFile(join(ROOT, "B-after-hook.txt"), "utf8")).toBe(
        "Approved rewritten input B\n",
      );
      const trace = await readTrace();
      expect(trace.filter((item) => item.phase === "started")).toHaveLength(1);
      expect(trace.filter((item) => item.phase === "executed")).toHaveLength(1);
      const result = await getLatestUpstreamToolResultByToolCallId(TOOL_ID);
      expect(result?.isError).toBe(false);
      expect(result?.content).toContain("B-after-hook.txt");
      const captured = await observation();
      expect(captured.commands).toHaveLength(2);
      expect(captured.commands[0]!.id).not.toBe(captured.commands[1]!.id);
      expect(Math.max(...captured.frames.map((frame) => frame.count))).toBe(1);
      expect(await $$(DIALOG).length).toBe(0);
      expect(
        withDatabase((db) =>
          db
            .prepare(
              "select value from local_setting where namespace = 'permission' and key = 'ruleset'",
            )
            .all(),
        ),
      ).toEqual([{ value: RULES }]);
      await browser.saveScreenshot(join(ARTIFACT, "04-completed-B.png"));
    } finally {
      await writeFile(
        join(ARTIFACT, "interaction-evidence.json"),
        JSON.stringify(
          {
            clientMode: "desktop-continuous",
            video_capture_mode: recording ? ELECTRON_WINDOW_RECORDING_CAPTURE_MODE : null,
            ...(await observation()),
            staleResponse,
            trace: await readTrace(),
          },
          null,
          2,
        ),
      );
      await recording?.stop({ tailDurationMs: 500 });
    }
  });
});

function withDatabase<T>(action: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(join(getE2EAppDataPaths().storageRoot, "cli", "db", "db.sqlite"));
  try {
    return action(db);
  } finally {
    db.close();
  }
}

async function readTrace(): Promise<Array<{ phase: string }>> {
  if (!(await exists(join(ROOT, "trace.jsonl")))) return [];
  return (await readFile(join(ROOT, "trace.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function readStaleResponse(id: string): Promise<Record<string, unknown> | undefined> {
  const logDir =
    process.env.CF_LOG_DIR?.trim() || join(getE2EAppDataPaths().storageRoot, "cli", "log");
  for (const name of await readdir(logDir)) {
    if (!name.endsWith(".jsonl")) continue;
    const lines = (await readFile(join(logDir, name), "utf8")).split("\n");
    for (const line of lines.slice(0, -1)) {
      if (
        line.includes('"event":"cf_protocol.v4.interaction_already_resolved"') &&
        line.includes(id)
      )
        return JSON.parse(line) as Record<string, unknown>;
    }
  }
  return undefined;
}

function observation() {
  return browser.execute(() => ({
    commands: window.__permissionRewriteReview?.commands ?? [],
    frames: window.__permissionRewriteReview?.frames ?? [],
  }));
}

async function observeAndDelayFirstApproval() {
  await browser.execute((selector) => {
    const original = MessagePort.prototype.postMessage;
    const commands: BrowserObservation["commands"] = [];
    const frames: BrowserObservation["frames"] = [];
    let held: { port: MessagePort; data: Uint8Array } | undefined;
    const capture = () => {
      const dialogs = Array.from(document.querySelectorAll<HTMLElement>(selector));
      const frame = {
        at: performance.now(),
        count: dialogs.length,
        text: dialogs
          .map(
            (item) =>
              item.closest<HTMLElement>('[data-v4-composer-dock="true"]')?.innerText ??
              item.innerText,
          )
          .join("\n"),
      };
      const previous = frames.at(-1);
      if (!previous || previous.count !== frame.count || previous.text !== frame.text)
        frames.push(frame);
    };
    const observer = new MutationObserver(capture);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    capture();
    MessagePort.prototype.postMessage = function (message: unknown, options?: unknown) {
      if (message instanceof Uint8Array) {
        const text = new TextDecoder().decode(message);
        if (
          text.includes('"type":"resolveInteraction"') &&
          text.includes('"optionId":"allowOnce"')
        ) {
          const id = /"interactionId":"([^"]+)"/.exec(text)?.[1];
          if (!id) throw new Error("Approval command is missing interactionId");
          commands.push({ id, at: performance.now(), held: commands.length === 0 });
          if (commands.length === 1) {
            held = { port: this, data: message.slice() };
            return;
          }
        }
      }
      Reflect.apply(original, this, options === undefined ? [message] : [message, options]);
    };
    window.__permissionRewriteReview = {
      commands,
      frames,
      release() {
        if (!held) throw new Error("没有待投递的旧批准");
        original.call(held.port, held.data);
        held = undefined;
      },
      restore() {
        MessagePort.prototype.postMessage = original;
        observer.disconnect();
        if (held) original.call(held.port, held.data);
        delete window.__permissionRewriteReview;
      },
    };
  }, DIALOG);
}
