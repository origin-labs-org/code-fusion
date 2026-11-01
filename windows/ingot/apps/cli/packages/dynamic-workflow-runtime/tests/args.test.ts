

import { describe, expect, it } from "vitest";
import { InMemoryJournalStore } from "@origin-ai/cf-dynamic-workflow";
import { runWorkflowScript } from "../src/index.js";
import { AutoDriver } from "./auto-driver.js";
import { askSpecsFor, TEST_CWD } from "./helpers.js";

const RUN = "run";

function baseOptions(scriptText: string, journal: InMemoryJournalStore) {
  const driver = new AutoDriver(journal, {});
  return {
    scriptText,
    cwd: TEST_CWD,
    runId: RUN,
    caps: { maxConcurrency: 16 },
    askSpecs: askSpecsFor(scriptText),
    validate: () => [],
    makeDriver: (sink: Parameters<typeof driver.attach>[0]) => {
      driver.attach(sink);
      return driver;
    },
    timeoutMs: 20000,
  };
}

describe("args in the sandbox", () => {
  it("delivers the validated bag to the script", async () => {
    const journal = new InMemoryJournalStore();
    const script = "return [String(args.target), Number(args.depth), args.deep];";

    const settlement = await runWorkflowScript({
    cwd: TEST_CWD,
      ...baseOptions(script, journal),
      args: { target: "packages/core", depth: 3, deep: { nested: true } },
    });

    expect(settlement).toEqual({
      status: "completed",
      artifact: ["packages/core", 3, { nested: true }],
    });
  });

  it("is an empty object, never undefined, for a run with no arguments", async () => {
    const journal = new InMemoryJournalStore();
    const script = "return [typeof args, Object.keys(args).length, args.missing === undefined];";

    const settlement = await runWorkflowScript(baseOptions(script, journal));

    expect(settlement).toEqual({ status: "completed", artifact: ["object", 0, true] });
  });

  it("journals the args alongside the rest of the run metadata", async () => {
    const journal = new InMemoryJournalStore();

    await runWorkflowScript({
    cwd: TEST_CWD,
      ...baseOptions("return String(args.who);", journal),
      args: { who: "ada" },
    });

    expect(journal.getRun(RUN)?.args).toEqual({ who: "ada" });
  });

  it("leaves args off the run record entirely when the run had none", async () => {
    const journal = new InMemoryJournalStore();
    await runWorkflowScript(baseOptions("return 1;", journal));
    expect(journal.getRun(RUN)?.args).toBeUndefined();
  });

  it("freezes the top level of the bag", async () => {
    const journal = new InMemoryJournalStore();
    const script = [
      "const frozen = Object.isFrozen(args);",
      "let threw = false;",
      "try { (args as Record<string, unknown>).injected = 1; } catch { threw = true; }",
      "return [frozen, threw || args.injected === undefined];",
    ].join("\n");

    const settlement = await runWorkflowScript({
    cwd: TEST_CWD,
      ...baseOptions(script, journal),
      args: { original: 1 },
    });

    expect(settlement).toEqual({ status: "completed", artifact: [true, true] });
    expect(journal.getRun(RUN)?.args).toEqual({ original: 1 });
  });
});
