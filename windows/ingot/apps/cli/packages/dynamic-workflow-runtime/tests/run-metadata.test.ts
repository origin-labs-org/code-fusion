

import { describe, expect, it } from "vitest";
import { InMemoryJournalStore } from "@origin-ai/cf-dynamic-workflow";
import { runWorkflowScript } from "../src/index.js";
import { AutoDriver } from "./auto-driver.js";
import { askSpecsFor, TEST_CWD } from "./helpers.js";

const RUN = "run";

const SCRIPT = ['const a = agent("a");', 'const r = await a.ask("hello");', "return r;"].join("\n");

describe("run metadata through the real entry point", () => {
  it("forwards scriptText / scriptHash / parentSessionId / cwd / toolCallId onto the journaled run record", async () => {
    const journal = new InMemoryJournalStore();
    const driver = new AutoDriver(journal, { asks: { "ask#1": () => ({ type: "text", finalText: "hi" }) } });

    const settlement = await runWorkflowScript({
      scriptText: SCRIPT,
      runId: RUN,
      caps: { maxConcurrency: 16 },
      askSpecs: askSpecsFor(SCRIPT),
      validate: () => [],
      makeDriver: (sink) => {
        driver.attach(sink);
        return driver;
      },
      timeoutMs: 20000,
      scriptHash: "caller-computed-hash",
      parentSessionId: "sess_parent",
      cwd: TEST_CWD,
      toolCallId: "call-origin",
    });

    expect(settlement).toEqual({ status: "completed", artifact: "hi" });
    const run = journal.getRun(RUN);
    expect(run).toMatchObject({
      runId: RUN,
      status: "completed",
      scriptText: SCRIPT,
      scriptHash: "caller-computed-hash",
      parentSessionId: "sess_parent",
      cwd: TEST_CWD,
      toolCallId: "call-origin",
    });
  });

  it("carries the run's subagent model on the journaled run-launched event, reasoning segment included", async () => {
    const journal = new InMemoryJournalStore();
    const driver = new AutoDriver(journal, {
      asks: { "ask#1": () => ({ type: "text", finalText: "hi" }) },
    });

    await runWorkflowScript({
      scriptText: SCRIPT,
      runId: RUN,
      cwd: TEST_CWD,
      caps: { maxConcurrency: 16 },
      askSpecs: askSpecsFor(SCRIPT),
      validate: () => [],
      makeDriver: (sink) => {
        driver.attach(sink);
        return driver;
      },
      timeoutMs: 20000,
      launch: { inputId: "input-origin", subagentModel: "zhipu/glm-5.3-flash$high" },
    });

    const launched = journal
      .listEvents(RUN, { types: "all", reportItems: "all" })
      .find((stored) => stored.event.type === "run-launched");
    expect(launched?.event).toEqual({
      type: "run-launched",
      inputId: "input-origin",
      subagentModel: "zhipu/glm-5.3-flash$high",
    });
    expect("subagentModel" in journal.getRun(RUN)!).toBe(false);
  });

  it("omits subagentModel entirely when launch carries none", async () => {
    const journal = new InMemoryJournalStore();
    const driver = new AutoDriver(journal, {
      asks: { "ask#1": () => ({ type: "text", finalText: "hi" }) },
    });

    await runWorkflowScript({
      scriptText: SCRIPT,
      runId: RUN,
      cwd: TEST_CWD,
      caps: { maxConcurrency: 16 },
      askSpecs: askSpecsFor(SCRIPT),
      validate: () => [],
      makeDriver: (sink) => {
        driver.attach(sink);
        return driver;
      },
      timeoutMs: 20000,
      launch: { inputId: "input-origin" },
    });

    const launched = journal
      .listEvents(RUN, { types: "all", reportItems: "all" })
      .find((stored) => stored.event.type === "run-launched");
    expect("subagentModel" in launched!.event).toBe(false);
  });

  it("journals the authored scriptText, not the lowered body, when both are given", async () => {
    const journal = new InMemoryJournalStore();
    const driver = new AutoDriver(journal, {});

    const settlement = await runWorkflowScript({
    cwd: TEST_CWD,
      lowered: "return 7;",
      runId: RUN,
      caps: { maxConcurrency: 16 },
      askSpecs: new Map(),
      validate: () => [],
      makeDriver: (sink) => {
        driver.attach(sink);
        return driver;
      },
      timeoutMs: 20000,
      scriptText: "return 3 + 4; // authored",
      scriptHash: "hash-of-source",
    });

    expect(settlement).toEqual({ status: "completed", artifact: 7 });
    expect(journal.getRun(RUN)).toMatchObject({
      scriptText: "return 3 + 4; // authored",
      scriptHash: "hash-of-source",
    });
  });

  it("forwards the run name onto the journaled run record", async () => {
    const journal = new InMemoryJournalStore();
    const driver = new AutoDriver(journal, {});

    await runWorkflowScript({
    cwd: TEST_CWD,
      lowered: "return 1;",
      runId: RUN,
      caps: { maxConcurrency: 16 },
      askSpecs: new Map(),
      validate: () => [],
      makeDriver: (sink) => {
        driver.attach(sink);
        return driver;
      },
      timeoutMs: 20000,
      name: "nightly triage",
    });

    expect(journal.getRun(RUN)).toMatchObject({ name: "nightly triage" });
  });

  it("omits the metadata entirely when the caller passes none", async () => {
    const journal = new InMemoryJournalStore();
    const driver = new AutoDriver(journal, {});

    await runWorkflowScript({
    cwd: TEST_CWD,
      lowered: "return 1;",
      runId: RUN,
      caps: { maxConcurrency: 16 },
      askSpecs: new Map(),
      validate: () => [],
      makeDriver: (sink) => {
        driver.attach(sink);
        return driver;
      },
      timeoutMs: 20000,
    });

    const run = journal.getRun(RUN)!;
    for (const field of ["scriptText", "scriptHash", "parentSessionId", "name"]) {
      expect(field in run).toBe(false);
    }
  });

  it("rejects a resume whose scriptHash does not match the journaled one", async () => {
    const journal = new InMemoryJournalStore();
    const driver = new AutoDriver(journal, { asks: { "ask#1": () => ({ type: "text", finalText: "hi" }) } });
    const base = {
      runId: RUN,
      caps: { maxConcurrency: 16 },
      askSpecs: askSpecsFor(SCRIPT),
      validate: () => [],
      timeoutMs: 20000,
    } as const;

    await runWorkflowScript({
    cwd: TEST_CWD,
      ...base,
      scriptText: SCRIPT,
      scriptHash: "hash-v1",
      makeDriver: (sink) => {
        driver.attach(sink);
        return driver;
      },
    });
    expect(journal.getRun(RUN)?.scriptHash).toBe("hash-v1");

    const resumed = new AutoDriver(journal, {});
    await expect(
      runWorkflowScript({
    cwd: TEST_CWD,
        ...base,
        scriptText: `${SCRIPT}\n// edited`,
        scriptHash: "hash-v2",
        makeDriver: (sink) => {
          resumed.attach(sink);
          return resumed;
        },
      }),
    ).rejects.toMatchObject({
      code: "ScriptHashMismatch",
      mismatch: { expected: "hash-v1", got: "hash-v2" },
    });

    expect(journal.getRun(RUN)).toMatchObject({ status: "completed", scriptHash: "hash-v1" });
  });
});
