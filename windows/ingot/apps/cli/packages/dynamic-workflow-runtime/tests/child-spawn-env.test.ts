

import { afterEach, describe, expect, it, vi } from "vitest";
import type { spawn as spawnType } from "node:child_process";
import { runWorkflowScript } from "../src/index.js";
import { AutoDriver } from "./auto-driver.js";
import { askSpecsFor, TEST_CWD } from "./helpers.js";
import { InMemoryJournalStore } from "@origin-ai/cf-dynamic-workflow";

const spawnCalls: Array<{ options: Record<string, unknown> }> = [];
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const wrapped: typeof spawnType = ((...args: Parameters<typeof spawnType>) => {
    spawnCalls.push({ options: (args[2] ?? {}) as Record<string, unknown> });
    return actual.spawn(...args);
  }) as typeof spawnType;
  return { ...actual, spawn: wrapped };
});

const SCRIPT = ['const a = agent("a");', 'const r = await a.ask("hello");', "return r;"].join("\n");
const CANARY_KEY = "DWF_SPAWN_ENV_CANARY";

afterEach(() => {
  delete process.env[CANARY_KEY];
  spawnCalls.length = 0;
});

describe("sandbox child spawn env", () => {
  it("spawns the child with ELECTRON_RUN_AS_NODE=1 and the inherited parent env", async () => {
    process.env[CANARY_KEY] = "inherited";

    const journal = new InMemoryJournalStore();
    const driver = new AutoDriver(journal, { asks: { "ask#1": () => ({ type: "text", finalText: "hi" }) } });
    const settlement = await runWorkflowScript({
    cwd: TEST_CWD,
      scriptText: SCRIPT,
      runId: "run",
      caps: { maxConcurrency: 16 },
      askSpecs: askSpecsFor(SCRIPT),
      validate: () => [],
      makeDriver: (sink) => {
        driver.attach(sink);
        return driver;
      },
      timeoutMs: 20000,
    });

    expect(settlement).toEqual({ status: "completed", artifact: "hi" });

    expect(spawnCalls).toHaveLength(1);
    const env = spawnCalls[0]?.options.env as Record<string, string | undefined> | undefined;
    expect(env).toBeDefined();
    expect(env?.ELECTRON_RUN_AS_NODE).toBe("1");
    expect(env?.[CANARY_KEY]).toBe("inherited");
  });
});
