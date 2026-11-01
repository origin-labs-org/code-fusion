

import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { spawn as spawnType } from "node:child_process";
import { InMemoryJournalStore } from "@origin-ai/cf-dynamic-workflow";
import {
  childEntryFileName,
  fallbackWorkflowRunsDir,
  runWorkflowScript,
  workflowRunsDir,
  writeChildEntryFile,
  type HarnessWarning,
} from "../src/index.js";
import { AutoDriver } from "./auto-driver.js";

const spawnCalls: Array<{ args: readonly string[] }> = [];
let spawnOverride: ((...args: Parameters<typeof spawnType>) => ReturnType<typeof spawnType>) | undefined;
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const wrapped: typeof spawnType = ((...args: Parameters<typeof spawnType>) => {
    spawnCalls.push({ args: (args[1] ?? []) as readonly string[] });
    if (spawnOverride !== undefined) return spawnOverride(...args);
    return actual.spawn(...args);
  }) as typeof spawnType;
  return { ...actual, spawn: wrapped };
});

const roots: string[] = [];

afterEach(async () => {
  spawnCalls.length = 0;
  spawnOverride = undefined;
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function tempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function runLowered(
  lowered: string,
  extra: Partial<Parameters<typeof runWorkflowScript>[0]> = {},
): Promise<{ settlement: Awaited<ReturnType<typeof runWorkflowScript>>; journal: InMemoryJournalStore }> {
  const journal = new InMemoryJournalStore();
  const driver = new AutoDriver(journal);
  const settlement = await runWorkflowScript({
    lowered,
    runId: "run",
    caps: { maxConcurrency: 4 },
    askSpecs: new Map(),
    validate: () => [],
    makeDriver: (sink) => {
      driver.attach(sink);
      return driver;
    },
    timeoutMs: 20000,
    ...extra,
  });
  return { settlement, journal };
}

describe("child entry file", () => {
  it("lands under <cwd>/.cf/workflow-runs/<runId>.mjs with a .gitignore, and stays after the run settles", async () => {
    const cwd = await tempRoot("dwf-entry-cwd-");

    const { settlement } = await runLowered("return __host.args.x;", {
      cwd,
      runId: "dwfrun-1234",
      args: { x: 7 },
    });

    expect(settlement).toEqual({ status: "completed", artifact: 7 });
    const entryPath = join(cwd, ".cf", "workflow-runs", "dwfrun-1234.mjs");
    expect(spawnCalls[0]!.args).toEqual(["--max-old-space-size=256", entryPath]);
    const text = await readFile(entryPath, "utf8");
    expect(text).toContain("// cf dynamic workflow run dwfrun-1234");
    expect(text).toContain('export const payload = {"lowered":"return __host.args.x;","args":{"x":7},"maxOldSpaceSizeMb":256}');
    expect(text).toContain("export const start = ");
    await expect(readFile(join(cwd, ".cf", "workflow-runs", ".gitignore"), "utf8")).resolves.toBe("*\n");
  });

  it("keeps the command line short no matter how large the script is (Windows ENAMETOOLONG guard)", async () => {
    const cwd = await tempRoot("dwf-entry-big-");
    const lowered = `const pad = ${JSON.stringify("x".repeat(200_000))};\nreturn pad.length;`;

    const { settlement } = await runLowered(lowered, { cwd });

    expect(settlement).toEqual({ status: "completed", artifact: 200_000 });
    const argvChars = spawnCalls[0]!.args.reduce((sum, arg) => sum + arg.length, 0);
    expect(argvChars).toBeLessThan(1_000);
    expect(spawnCalls[0]!.args.every((arg) => arg.length < 32_767)).toBe(true);
  });

  it("falls back to os.tmpdir() and warns when the project .cf cannot be created", async () => {
    const cwd = await tempRoot("dwf-entry-fallback-");
    await writeFile(join(cwd, ".cf"), "not a directory", "utf8");
    const warnings: HarnessWarning[] = [];

    const { settlement } = await runLowered("return 1;", {
      cwd,
      runId: "dwfrun-fallback",
      onWarning: (warning) => warnings.push(warning),
    });

    expect(settlement).toEqual({ status: "completed", artifact: 1 });
    const expectedPath = join(fallbackWorkflowRunsDir(), "dwfrun-fallback.mjs");
    expect(spawnCalls[0]!.args[1]).toBe(expectedPath);
    await expect(stat(expectedPath)).resolves.toBeDefined();
    expect(warnings).toEqual([
      {
        kind: "entry_file_fallback",
        projectDir: join(cwd, ".cf", "workflow-runs"),
        fallbackDir: fallbackWorkflowRunsDir(),
        error: expect.stringMatching(/ENOTDIR|EEXIST|ENOENT/),
      },
    ]);
    await rm(expectedPath, { force: true });
  });

  it("settles a synchronous spawn failure as stopped(interrupted) through the engine, so the journal row is not left running", async () => {
    const cwd = await tempRoot("dwf-entry-throw-");
    spawnOverride = () => {
      const error = new Error("spawn ENAMETOOLONG") as Error & { code: string };
      error.code = "ENAMETOOLONG";
      throw error;
    };

    const { settlement, journal } = await runLowered("return 1;", { cwd });

    expect(settlement.status).toBe("stopped");
    expect(settlement.status === "stopped" ? settlement.error?.message : "").toContain(
      "spawn ENAMETOOLONG",
    );
    expect(journal.getRun("run")).toMatchObject({ status: "stopped", stopReason: "interrupted" });
  });
});

describe("writeChildEntryFile", () => {
  it("sanitises the run id into the file name", () => {
    expect(childEntryFileName("dwfrun-1234-abcd")).toBe("dwfrun-1234-abcd.mjs");
    expect(childEntryFileName("../evil/run id")).toBe(".._evil_run_id.mjs");
  });

  it("reports where it wrote", async () => {
    const cwd = await tempRoot("dwf-entry-unit-");

    const written = writeChildEntryFile({ cwd, runId: "r1", source: "export const x = 1;\n" });

    expect(written).toEqual({ path: join(workflowRunsDir(cwd), "r1.mjs"), location: "project" });
    await expect(readFile(written.path, "utf8")).resolves.toBe("export const x = 1;\n");
  });

  it("leaves an existing .gitignore alone", async () => {
    const cwd = await tempRoot("dwf-entry-gitignore-");
    writeChildEntryFile({ cwd, runId: "r1", source: "" });
    await writeFile(join(workflowRunsDir(cwd), ".gitignore"), "custom\n", "utf8");

    writeChildEntryFile({ cwd, runId: "r2", source: "" });

    await expect(readFile(join(workflowRunsDir(cwd), ".gitignore"), "utf8")).resolves.toBe("custom\n");
  });
});
