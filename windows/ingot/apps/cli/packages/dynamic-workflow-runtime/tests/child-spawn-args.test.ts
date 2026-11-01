

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { spawn as spawnType } from "node:child_process";
import { InMemoryJournalStore } from "@origin-ai/cf-dynamic-workflow";
import { runWorkflowScript } from "../src/index.js";
import { AutoDriver } from "./auto-driver.js";
import { askSpecsFor } from "./helpers.js";

const spawnCalls: Array<{ args: readonly string[]; options: Record<string, unknown> }> = [];
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const wrapped: typeof spawnType = ((...args: Parameters<typeof spawnType>) => {
    spawnCalls.push({
      args: (args[1] ?? []) as readonly string[],
      options: (args[2] ?? {}) as Record<string, unknown>,
    });
    return actual.spawn(...args);
  }) as typeof spawnType;
  return { ...actual, spawn: wrapped };
});

const SCRIPT = ['const a = agent("a");', 'const r = await a.ask("hello");', "return r;"].join("\n");

const roots: string[] = [];

afterEach(async () => {
  spawnCalls.length = 0;
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function tempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function runOnce(extra: Partial<Parameters<typeof runWorkflowScript>[0]> = {}) {
  const cwd = await tempRoot("dwf-spawn-args-cwd-");
  const journal = new InMemoryJournalStore();
  const driver = new AutoDriver(journal, { asks: { "ask#1": () => ({ type: "text", finalText: "hi" }) } });
  const settlement = await runWorkflowScript({
    scriptText: SCRIPT,
    runId: "run",
    cwd,
    caps: { maxConcurrency: 16 },
    askSpecs: askSpecsFor(SCRIPT),
    validate: () => [],
    makeDriver: (sink) => {
      driver.attach(sink);
      return driver;
    },
    timeoutMs: 20000,
    ...extra,
  });
  return { settlement, cwd };
}

async function readEntryPayload(entryPath: string): Promise<Record<string, unknown>> {
  const text = await readFile(entryPath, "utf8");
  const match = /^export const payload = (.*);$/m.exec(text);
  expect(match).not.toBeNull();
  return JSON.parse(match![1]!) as Record<string, unknown>;
}

async function writeSeaCliStandIn(): Promise<string> {
  const root = await tempRoot("dwf-sea-standin-");
  const scriptPath = join(root, "sea-cli-stand-in.mjs");
  await writeFile(
    scriptPath,
    `import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { createContext, runInContext } from "node:vm";

if (process.argv.length !== 3) {
  process.stderr.write("sea-cli-stand-in: unexpected argv " + JSON.stringify(process.argv.slice(2)) + "\\n");
  process.exit(1);
}

const entry = await import(pathToFileURL(process.argv[2]).href);
await entry.start({
  vm: { createContext, runInContext },
  createInterface,
  stdin: process.stdin,
  stdout: process.stdout,
});
`,
    "utf8",
  );
  return scriptPath;
}

describe("sandbox child spawn strategy", () => {
  it("spawns only the heap flag and the entry path when childSpawn is absent", async () => {
    const { settlement, cwd } = await runOnce();

    expect(settlement).toEqual({ status: "completed", artifact: "hi" });
    expect(spawnCalls).toHaveLength(1);
    const args = spawnCalls[0]!.args;

    expect(args).toEqual(["--max-old-space-size=256", join(cwd, ".cf", "workflow-runs", "run.mjs")]);
    await expect(readEntryPayload(args[1]!)).resolves.toMatchObject({ lowered: expect.any(String) });
    expect(spawnCalls[0]!.options.env).toMatchObject({ ELECTRON_RUN_AS_NODE: "1" });
    expect(spawnCalls[0]!.options.cwd).toBe(cwd);
  });

  it("keeps host-only run metadata out of the child payload (launch stays host-side)", async () => {
    //
    const { settlement, cwd } = await runOnce({
      launch: { inputId: "input-origin", subagentModel: "zhipu/glm-5.3-flash$high" },
      resumedFrom: "run-predecessor",
      toolCallId: "call-origin",
      parentSessionId: "sess_parent",
      name: "nightly triage",
      args: { topic: "release" },
    });

    expect(settlement).toEqual({ status: "completed", artifact: "hi" });
    const payload = await readEntryPayload(join(cwd, ".cf", "workflow-runs", "run.mjs"));
    expect(payload.args).toEqual({ topic: "release" });
    for (const field of ["launch", "resumedFrom", "toolCallId", "parentSessionId", "name"]) {
      expect(field in payload).toBe(false);
    }
  });

  it("maps maxOldSpaceSizeMb onto the node flag on the default path", async () => {
    await runOnce({ maxOldSpaceSizeMb: 512 });

    expect(spawnCalls[0]!.args[0]).toBe("--max-old-space-size=512");
  });

  it("spawns argsPrefix + entry path with zero node flags, and the run still settles", async () => {
    const standIn = await writeSeaCliStandIn();

    const { settlement, cwd } = await runOnce({ childSpawn: { argsPrefix: [standIn] } });

    expect(settlement).toEqual({ status: "completed", artifact: "hi" });
    expect(spawnCalls).toHaveLength(1);
    const args = spawnCalls[0]!.args;
    expect(args).toEqual([standIn, join(cwd, ".cf", "workflow-runs", "run.mjs")]);
    expect(args.some((arg) => arg.startsWith("--"))).toBe(false);
    await expect(readEntryPayload(args[1]!)).resolves.toMatchObject({ maxOldSpaceSizeMb: 256 });
    expect(spawnCalls[0]!.options.env).toMatchObject({ ELECTRON_RUN_AS_NODE: "1" });
  });

  it("forwards every argsPrefix token in order, entry path last", async () => {
    const standIn = await writeSeaCliStandIn();

    const { settlement } = await runOnce({
      childSpawn: { argsPrefix: [standIn, "__cf-dwf-child"] },
      timeoutMs: 20000,
    });

    expect(settlement).toMatchObject({ status: "stopped", reason: "interrupted" });
    expect(spawnCalls[0]!.args).toEqual([
      standIn,
      "__cf-dwf-child",
      expect.stringMatching(/run\.mjs$/),
    ]);
  });
});
