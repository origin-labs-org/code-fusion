import {
  copyFile,
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  stat,
  statfs,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { clearAppData, DEFAULT_WORKSPACE, getE2EAppDataPaths } from "../helpers/desktop-app.js";
import { resolveE2ERuntimePath } from "../helpers/e2e-runtime-paths.js";
import {
  getLatestUpstreamToolResultByToolCallId,
  countUpstreamRequests,
} from "../helpers/conversation-session-network.js";
import {
  listToolCallBlocks,
  waitForToolCallBlockByToolCallId,
} from "../helpers/conversation-session-tool.js";
import {
  clickV4Stop,
  getV4PaneSnapshot,
  getV4ConfigProjection,
  prepareV4ConversationE2E,
  sendV4Prompt,
  switchV4Mode,
  selectV4TaskById,
  waitForV4AssistantMessageContaining,
  waitForV4ConversationState,
} from "../helpers/v4-conversation.js";

import { startDraftFromProject } from "../helpers/project-sidebar.js";

const ROOT = resolveE2ERuntimePath("bash-direct-output", "中文 空格");
const LIMIT = 5 * 1024 ** 3;
const RELEASES = [
  "A.release",
  "B.release",
  "B.finish",
  "query.grow",
  "query.release",
  "foreground.release",
  "foreground.finish",
  "background.release",
  "background.finish",
  "read-failure.release",
  "realtime.1.release",
  "realtime.2.release",
  "realtime.3.release",
  "realtime.4.release",
  "realtime.5.release",
];
const outputs = new Set<string>();

async function release(name: string) {
  await writeFile(join(ROOT, name), "release");
}
async function waitFile(name: string) {
  await browser.waitUntil(async () => (await stat(join(ROOT, name)).catch(() => null)) !== null, {
    timeout: 90000,
    timeoutMsg: `producer 没有到达 ${name}`,
  });
}
async function idle() {
  await waitForV4ConversationState((s) => s.state === "idle", "BDO 会话没有回到 idle", 30000);
}
async function prompt(marker: string, newTask = true) {
  if (newTask) {
    await startDraftFromProject(DEFAULT_WORKSPACE);

    await switchV4Mode("yolo");
    await browser.waitUntil(async () => (await getV4ConfigProjection()).mode === "yolo", {
      timeout: 15000,
      timeoutMsg: "项目草稿未应用 yolo 模式",
    });
  }
  await sendV4Prompt(`${marker}: Execute the exact Bash output regression fixture.`);
}
async function done(marker: string) {
  await waitForV4AssistantMessageContaining(`${marker}_DONE`, 90000);
  await idle();
}
async function result(id: string) {
  const value = await getLatestUpstreamToolResultByToolCallId(id);
  expect(value).not.toBeNull();
  return value!;
}
async function outputPath(id: string) {
  const sessionId = (await getV4PaneSnapshot()).sessionId;
  expect(sessionId).not.toBe("draft");
  const path = join(
    getE2EAppDataPaths().storageRoot,
    "cli",
    "exec",
    sessionId!,
    `${id}-stdout.log`,
  );
  outputs.add(path);
  return path;
}
async function snippet(path: string, tail = false) {
  const handle = await open(path, "r");
  try {
    const size = (await handle.stat()).size;
    const buffer = Buffer.alloc(Math.min(size, 128));
    await handle.read(buffer, 0, buffer.length, tail ? size - buffer.length : 0);
    return buffer.toString();
  } finally {
    await handle.close();
  }
}
async function setExpanded(id: string, expanded: boolean) {
  await waitForToolCallBlockByToolCallId(id);
  const trigger = await $(`[data-testid="tool-summary-trigger-${id}"]`);
  if ((await trigger.getAttribute("aria-expanded")) !== String(expanded)) await trigger.click();
}

async function assertOutputHidden(id: string) {
  await browser.waitUntil(
    async () =>
      browser.execute((toolId) => {
        const block = document.querySelector(`[data-testid="chat-tool-call-block-${toolId}"]`);
        return (
          Boolean(block) &&
          !block!.querySelector(
            '[data-testid^="bash-output-preview-"], [data-testid="bash-result-output"], [data-testid="bash-output-notice"], [data-testid="bash-output-file"]',
          )
        );
      }, id),
    { timeout: 5000, timeoutMsg: `Collapse后的 Bash 仍渲染Output：${id}` },
  );
}

describe("Bash direct file output supplementary E2E", () => {
  before(async function () {
    this.timeout(120000);
    await mkdir(ROOT, { recursive: true });
    await copyFile(
      new URL("../fixtures/fs/conversation-session/bash-direct-output/writer.cjs", import.meta.url),
      join(ROOT, "writer.cjs"),
    );
    await prepareV4ConversationE2E();
    await switchV4Mode("yolo");
    await browser.waitUntil(async () => (await getV4ConfigProjection()).mode === "yolo", {
      timeout: 15000,
      timeoutMsg: "项目草稿未应用 yolo 模式",
    });
  });
  beforeEach(async () => {
    for (const name of await readdir(ROOT)) if (name.endsWith(".pid")) await rm(join(ROOT, name));
    for (const name of [
      ...RELEASES,
      "query.ready",
      "query.grown",
      "foreground.ready",
      "background.ready",
      "read-failure.ready",
      "realtime.1.ready",
      "realtime.2.ready",
      "realtime.3.ready",
      "realtime.4.ready",
      "realtime.5.ready",
    ]) {
      await rm(join(ROOT, name), { force: true });
    }
  });
  afterEach(async () => {
    await Promise.all(RELEASES.map(release));
    if ((await getV4PaneSnapshot()).canStop) await clickV4Stop();
    const pids = await Promise.all(
      (await readdir(ROOT))
        .filter((name) => name.endsWith(".pid"))
        .map(async (name) => Number(await readFile(join(ROOT, name), "utf8"))),
    );
    await browser.waitUntil(
      async () =>
        pids.every((pid) => {
          try {
            process.kill(pid, 0);
            return false;
          } catch {
            return true;
          }
        }),
      { timeout: 10000, timeoutMsg: "This Bash producer cleanup did not complete" },
    );
    for (const path of outputs) await rm(path, { force: true, recursive: true });
    outputs.clear();
  });
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("BDO01: Chinese space paths, two streams without newlines, and non-zero empty outputs maintain correct results", async function () {
    this.timeout(120000);
    await prompt("E2E_BDO_SMALL");
    await done("E2E_BDO_SMALL");
    expect((await result("toolu_bdo_small")).content).toBe("BDO_Chinese_STDOUT|Chinese_STDERR");
    expect((await result("toolu_bdo_empty_error")).content).toContain("Exit code 7");
    expect(await stat(await outputPath("toolu_bdo_small")).catch(() => null)).toBeNull();
  });

  it("BDO02: Foreground output exceeding 64 MiB retains full file, details show only body", async function () {
    this.timeout(120000);
    await prompt("E2E_BDO_LARGE");
    await done("E2E_BDO_LARGE");
    const path = await outputPath("toolu_bdo_large");
    expect((await stat(path)).size).toBe(
      65 * 1024 ** 2 + Buffer.byteLength("BDO_HEAD\n\nBDO_TAIL\n"),
    );
    expect(await snippet(path)).toContain("BDO_HEAD");
    expect(await snippet(path, true)).toContain("BDO_TAIL");
    expect((await result("toolu_bdo_large")).content).toContain(path);
    await setExpanded("toolu_bdo_large", false);
    await assertOutputHidden("toolu_bdo_large");
    await setExpanded("toolu_bdo_large", true);
    const body = await $('[data-testid="bash-result-output"]');
    await body.waitForDisplayed();
    await browser.waitUntil(async () => (await body.getText()).includes("BDO_HEAD"), {
      timeout: 10000,
      timeoutMsg: "Expanded Bash header summary is not displayed",
    });
    expect(await body.getText()).toContain("BDO_HEAD");
    expect(await body.getText()).not.toContain("BDO_TAIL");
    expect(Buffer.byteLength(await body.getText())).toBe(30000);
    expect(await $('[data-testid="bash-output-notice"]').isExisting()).toBe(false);
    expect(await $('[data-testid="bash-output-file"]').isExisting()).toBe(false);
    await setExpanded("toolu_bdo_large", false);
    await assertOutputHidden("toolu_bdo_large");
  });

  it("BDO03: During concurrent foreground Bash shared progress, one exiting does not affect the other", async function () {
    this.timeout(120000);
    const previews = () =>
      browser.execute(() =>
        Array.from(document.querySelectorAll('[data-testid="bash-output-preview-full"]')).map(
          (el) => el.textContent ?? "",
        ),
      );
    const waitPreview = (text: string) =>
      browser.waitUntil(async () => (await previews()).some((s) => s.includes(text)), {
        timeout: 30000,
        timeoutMsg: `Bash 没有更New进度：${text}`,
      });
    await prompt("E2E_BDO_PROGRESS_A");
    await setExpanded("toolu_bdo_progress_a", true);
    await waitPreview("A-STAGE1");
    const fullPreview = await $('[data-testid="bash-output-preview-full"]');
    await fullPreview.waitForDisplayed();
    await browser.waitUntil(async () => (await fullPreview.getText()).includes("A-STAGE1"), {
      timeout: 10000,
      timeoutMsg: "Expanded Bash progress preview is not displayed",
    });
    const fullText = await fullPreview.getText();
    expect(fullText).toContain("A-STAGE1");
    expect(fullText.split("\n").length).toBeGreaterThan(5);
    expect(fullText.split("\n").length).toBeLessThanOrEqual(100);
    expect(Buffer.byteLength(fullText)).toBeLessThanOrEqual(4096);
    await setExpanded("toolu_bdo_progress_a", false);
    await assertOutputHidden("toolu_bdo_progress_a");
    const sessionA = (await getV4PaneSnapshot()).sessionId!;
    await outputPath("toolu_bdo_progress_a");
    await prompt("E2E_BDO_PROGRESS_B");
    await setExpanded("toolu_bdo_progress_b", true);
    await waitPreview("B-STAGE1");
    const sessionB = (await getV4PaneSnapshot()).sessionId!;
    await outputPath("toolu_bdo_progress_b");
    for (const text of await previews()) expect(text.length).toBeLessThanOrEqual(4096);
    await selectV4TaskById(sessionA);
    await setExpanded("toolu_bdo_progress_a", true);
    await waitPreview("A-STAGE1");
    await release("A.release");
    await done("E2E_BDO_PROGRESS_A");
    await selectV4TaskById(sessionB);
    await setExpanded("toolu_bdo_progress_b", true);
    await release("B.release");
    await browser.waitUntil(async () => (await previews()).some((s) => s.includes("B-STAGE2")), {
      timeout: 10000,
      timeoutMsg: "After the first Bash completed, progress for the other Bash stopped updating",
    });
    await release("B.finish");
    await done("E2E_BDO_PROGRESS_B");
    expect(await previews()).toEqual([]);
  });

  it("BDO07: Live refresh when expanded, output not rendered when collapsed, displays latest content upon re-expanding", async function () {
    this.timeout(60000);
    const id = "toolu_bdo_realtime";
    const marker = "E2E_BDO_REALTIME";
    const artifactDir = process.env.CF_E2E_ARTIFACT_DIR;
    if (!artifactDir) throw new Error("E2E artifact directory is required for refresh timings");
    const observations: {
      stage: number;
      fileVisibleMs: number;
      previewVisibleMs: number;
      height: number;
      lineHeight: number;
      bottomGap: number;
    }[] = [];
    await prompt(marker);
    await waitFile("realtime.1.ready");
    const path = await outputPath(id);
    const pid = Number(await readFile(join(ROOT, "realtime.pid"), "utf8"));
    await setExpanded(id, true);
    let expectedOutput = "";
    let frozenOutput = "";
    const scrollMetrics = () =>
      browser.execute(() => {
        const el = document.querySelector<HTMLElement>('[data-testid="bash-output-scroll"]')!;
        return {
          height: el.clientHeight,
          lineHeight: Number.parseFloat(getComputedStyle(el.querySelector("pre")!).lineHeight),
          bottomGap: el.scrollHeight - el.scrollTop - el.clientHeight,
        };
      });

    for (const stage of [1, 2, 3, 4, 5]) {
      if (stage > 1) await waitFile(`realtime.${stage}.ready`);
      const writtenAt = Number(await readFile(join(ROOT, `realtime.${stage}.ready`), "utf8"));
      const fragment = `实时-${stage}-stdout|实时-${stage}-stderr`;
      expectedOutput += (stage > 1 ? `line-${stage} abcdefghijklmnop\n`.repeat(80) : "") + fragment;
      expect(await readFile(path, "utf8")).toBe(expectedOutput);
      const fileVisibleMs = Date.now() - writtenAt;
      if (stage === 3) {
        await browser.pause(1200);
        await assertOutputHidden(id);
        await setExpanded(id, true);
      }
      const preview = await $('[data-testid="bash-output-preview-full"]');
      if (stage === 4) {
        await browser.pause(1500);
        expect(await preview.getText()).toBe(frozenOutput);
        await browser.execute(() => {
          const el = document.querySelector<HTMLElement>('[data-testid="bash-output-scroll"]')!;
          el.scrollTop = el.scrollHeight;
          el.dispatchEvent(new Event("scroll", { bubbles: true }));
        });
      }
      await browser.waitUntil(
        async () => (await preview.isExisting()) && (await preview.getText()).includes(fragment),
        {
          timeout: stage === 1 ? 8000 : 5000,
          timeoutMsg: `第 ${stage} 段 Bash Output未在Exit前Refresh`,
        },
      );
      const previewVisibleMs = Date.now() - writtenAt;
      expect(previewVisibleMs).toBeLessThanOrEqual(stage === 1 ? 8000 : 5000);
      expect(process.kill(pid, 0)).toBe(true);
      expect((await listToolCallBlocks()).find((block) => block.toolCallId === id)?.status).toBe(
        "in_progress",
      );
      expect(await getLatestUpstreamToolResultByToolCallId(id)).toBeNull();
      const metrics = await scrollMetrics();
      observations.push({ stage, fileVisibleMs, previewVisibleMs, ...metrics });
      console.log("BASH_REALTIME_VIEWPORT", JSON.stringify(observations.at(-1)));
      await writeFile(
        join(artifactDir, "bash-realtime-refresh.json"),
        JSON.stringify(observations, null, 2),
      );
      expect(metrics.lineHeight).toBeGreaterThan(0);
      expect(metrics.height).toBe(metrics.lineHeight * (stage === 1 ? 1 : 5));
      expect(metrics.bottomGap).toBeLessThanOrEqual(1);
      const scrollViewport = await $('[data-testid="bash-output-scroll"]');
      await browser.waitUntil(
        async () =>
          (await scrollViewport.getAttribute("data-scroll-mask")) ===
          (stage === 1 ? "none" : "top"),
        { timeout: 5000, timeoutMsg: "Bash fade direction is incorrect after pinning to bottom" },
      );
      expect(
        await scrollViewport.getCSSProperty("mask-image").then((value) => value.value === "none"),
      ).toBe(stage === 1);
      expect(await $('[data-testid="bash-output-resume"]').isExisting()).toBe(false);
      if (stage === 2) {
        await setExpanded(id, false);
        await assertOutputHidden(id);
      }
      if (stage === 3 || stage === 5) {
        frozenOutput = await preview.getText();
        await browser.execute(() => {
          const el = document.querySelector<HTMLElement>('[data-testid="bash-output-scroll"]')!;
          el.scrollTop = (el.scrollHeight - el.clientHeight) / 2;
          el.dispatchEvent(new Event("scroll", { bubbles: true }));
        });
        await browser.waitUntil(
          async () => (await scrollViewport.getAttribute("data-scroll-mask")) === "both",
          {
            timeout: 5000,
            timeoutMsg: "No top/bottom fade in Bash middle position",
          },
        );
        await browser.execute(() => {
          const el = document.querySelector<HTMLElement>('[data-testid="bash-output-scroll"]')!;
          el.scrollTop = 0;
          el.dispatchEvent(new Event("scroll", { bubbles: true }));
        });
        await browser.waitUntil(
          async () =>
            (await $('[data-testid="bash-output-scroll"]').getAttribute("data-following")) ===
            "false",
          { timeout: 5000, timeoutMsg: "Auto-scroll was not paused after user scrolled up" },
        );
        expect(await $('[data-testid="bash-output-resume"]').isExisting()).toBe(false);
        expect(await scrollViewport.getAttribute("data-scroll-mask")).toBe("bottom");
      }
      await release(`realtime.${stage}.release`);
    }

    await done(marker);
    await setExpanded(id, false);
    await assertOutputHidden(id);
    await setExpanded(id, true);
    const finalOutput = await $('[data-testid="bash-result-output"]');
    await browser.waitUntil(async () => (await finalOutput.getText()) === expectedOutput, {
      timeout: 10000,
      timeoutMsg: "Final Bash output is not displayed after re-expanding",
    });
    const finalMetrics = await scrollMetrics();
    expect(finalMetrics.height).toBe(finalMetrics.lineHeight * 5);
    expect(await $('[data-testid="bash-output-resume"]').isExisting()).toBe(false);
    expect((await result(id)).content).toBe(expectedOutput);
    expect((await waitForToolCallBlockByToolCallId(id)).status).toBe("completed");
    expect(await $('[data-testid="bash-output-preview-short"]').isExisting()).toBe(false);
    expect(await $('[data-testid="bash-output-preview-full"]').isExisting()).toBe(false);
    await setExpanded(id, false);
    await assertOutputHidden(id);
    expect(
      await countUpstreamRequests({ includes: [marker], excludes: ["Generate a concise title"] }),
    ).toBe(2);
  });

  it("BDO04: TaskOutput repeats head read during runtime and tail read upon completion", async function () {
    this.timeout(120000);
    await prompt("E2E_BDO_QUERY");
    await done("E2E_BDO_QUERY");
    await waitFile("query.ready");
    const path = await outputPath("toolu_bdo_query");
    await prompt("E2E_BDO_QUERY_FIRST", false);
    await done("E2E_BDO_QUERY_FIRST");
    const first = (await result("toolu_bdo_query_first")).content;
    expect(first).toContain("BDO_QUERY_HEAD");
    expect(first).not.toContain("BDO_QUERY_FIRST_TAIL");
    await release("query.grow");
    await waitFile("query.grown");
    await prompt("E2E_BDO_QUERY_SECOND", false);
    await done("E2E_BDO_QUERY_SECOND");
    const second = (await result("toolu_bdo_query_second")).content;
    const firstOutput = first.match(/<output>([\s\S]*?)<\/output>/)?.[1];
    expect(firstOutput).toBeDefined();
    expect(second.match(/<output>([\s\S]*?)<\/output>/)?.[1]).toBe(firstOutput);
    expect(second).not.toContain("BDO_QUERY_SECOND_TAIL");
    await release("query.release");
    await waitForV4AssistantMessageContaining("E2E_BDO_QUERY_NOTIFIED", 30000);
    await prompt("E2E_BDO_QUERY_FINAL", false);
    await done("E2E_BDO_QUERY_FINAL");
    const final = (await result("toolu_bdo_query_final")).content;
    expect(final).toContain("BDO_QUERY_FINAL_TAIL");
    expect(final).not.toContain("BDO_QUERY_HEAD");
    expect((await stat(path)).size).toBeGreaterThan(600000);
  });

  for (const mode of ["foreground", "background"] as const) {
    it(`BDO05: ${mode} 真实 5 GiB Boundaries与 5 秒 watchdog`, async function () {
      this.timeout(150000);
      const disk = await statfs(ROOT, { bigint: true });
      if (disk.bavail * disk.bsize < BigInt(12 * 1024 ** 3))
        throw new Error("Writing 5 GiB requires at least 12 GiB free space; cannot pass without execution");
      const marker = `E2E_BDO_LIMIT_${mode.toUpperCase()}`;
      await prompt(marker);
      await waitFile(`${mode}.ready`);
      const path = await outputPath(`toolu_bdo_limit_${mode}`);
      expect((await stat(path)).size).toBe(LIMIT);
      await browser.pause(5500);
      const pid = Number(await readFile(join(ROOT, `${mode}.pid`), "utf8"));
      expect(() => process.kill(pid, 0)).not.toThrow();
      await release(`${mode}.release`);
      await waitFile(`${mode}.exceeded`);
      await waitForV4AssistantMessageContaining(`${marker}_KILLED`, 20000);
      await idle();
      if (mode === "foreground") {
        const output = await result("toolu_bdo_limit_foreground");
        expect(output.isError).toBe(true);
        const persisted = output.content.match(/Full output saved to: ([^\n]+)/)?.[1];
        const full = persisted ? await readFile(persisted, "utf8") : output.content;
        expect(full).toContain("Command killed: output file exceeded 5GB");
        expect(await stat(path).catch(() => null)).toBeNull();
      } else {
        expect((await stat(path)).size).toBe(LIMIT + 1);
        expect(
          await countUpstreamRequests({
            includes: [marker, "<task-notification>", "<status>killed</status>"],
          }),
        ).toBe(1);
      }
      await browser.waitUntil(
        async () => {
          try {
            process.kill(pid, 0);
            return false;
          } catch {
            return true;
          }
        },
        { timeout: 10000, timeoutMsg: "Over-limit producer did not exit" },
      );
    });
  }

  it("BDO06: Diagnostics available on actual output read/open failure, subsequent Bash can still execute", async function () {
    this.timeout(120000);
    await prompt("E2E_BDO_READ_FAILURE");
    await waitFile("read-failure.ready");
    const path = await outputPath("toolu_bdo_read_failure");
    await rm(path);
    await release("read-failure.release");
    await done("E2E_BDO_READ_FAILURE");
    expect((await result("toolu_bdo_read_failure")).content).toContain("bash output unavailable");
    const blocked = await outputPath("toolu_bdo_open_failure");
    await mkdir(blocked, { recursive: true });
    await prompt("E2E_BDO_OPEN_FAILURE", false);
    await done("E2E_BDO_OPEN_FAILURE");
    expect((await result("toolu_bdo_open_failure")).content).toContain("EISDIR");
    expect((await stat(blocked)).isDirectory()).toBe(true);
    await prompt("E2E_BDO_RECOVERY", false);
    await done("E2E_BDO_RECOVERY");
    expect((await result("toolu_bdo_recovery")).content).toBe("BDO_Chinese_STDOUT|Chinese_STDERR");
  });
});
