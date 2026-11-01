

import { describe, expect, it } from "vitest";
import {
  InMemoryJournalStore,
  validate,
  type JsonSchema,
  type RunEvent,
  type ValidateFn,
} from "@origin-ai/cf-dynamic-workflow";
import { runWorkflowScript, type RunControlBinding } from "../src/index.js";
import { AutoDriver } from "./auto-driver.js";
import { askSpecsFor, TEST_CWD } from "./helpers.js";

const validateFn: ValidateFn = (schema, value) => validate(schema as JsonSchema, value);

const RUN = "run-control";

const SCRIPT = [
  'const worker = agent("worker", "You answer questions.");',
  'const answer = await worker.ask("What is the answer?");',
  "return answer;",
].join("\n");

function captureControl(): RunControlBinding & { retune: (n: number) => boolean } {
  let bound: { setMaxConcurrency(n: number): boolean } | undefined;
  return {
    bind(engine) {
      bound = engine;
    },
    retune(n) {
      if (bound === undefined) throw new Error("control was never bound to an engine");
      return bound.setMaxConcurrency(n);
    },
  };
}

describe("harness — Live control plane binding", () => {
  it("After sub-process starts, handles still point to current-generation engine: changes write to journal lines and event tracks", async () => {
    const journal = new InMemoryJournalStore();
    const control = captureControl();
    const retunes: boolean[] = [];
    const driver = new AutoDriver(journal, {
      asks: { "ask#1": () => ({ type: "text", finalText: "42" }) },
      onStartAsk: () => {
        retunes.push(control.retune(3));
      },
    });

    const settlement = await runWorkflowScript({
      scriptText: SCRIPT,
      cwd: TEST_CWD,
      runId: RUN,
      caps: { maxConcurrency: 8 },
      askSpecs: askSpecsFor(SCRIPT),
      validate: validateFn,
      makeDriver: (sink) => {
        driver.attach(sink);
        return driver;
      },
      control,
      timeoutMs: 20000,
    });

    expect(settlement).toEqual({ status: "completed", artifact: "42" });
    expect(retunes).toEqual([true]);
    expect(journal.getRun(RUN)?.caps).toEqual({ maxConcurrency: 3 });

    const changed = driver.events.filter(
      (e): e is Extract<RunEvent, { type: "run-caps-changed" }> => e.type === "run-caps-changed",
    );
    expect(changed).toEqual([
      {
        type: "run-caps-changed",
        runId: RUN,
        caps: { maxConcurrency: 3 },
        previous: { maxConcurrency: 8 },
      },
    ]);
  });

  it("After run settles, handles are no-ops: return false, lines and tracks no longer change", async () => {
    const journal = new InMemoryJournalStore();
    const control = captureControl();
    const driver = new AutoDriver(journal, {
      asks: { "ask#1": () => ({ type: "text", finalText: "42" }) },
    });

    await runWorkflowScript({
      scriptText: SCRIPT,
      cwd: TEST_CWD,
      runId: RUN,
      caps: { maxConcurrency: 8 },
      askSpecs: askSpecsFor(SCRIPT),
      validate: validateFn,
      makeDriver: (sink) => {
        driver.attach(sink);
        return driver;
      },
      control,
      timeoutMs: 20000,
    });

    const eventsAtSettlement = driver.events.length;
    expect(control.retune(2)).toBe(false);
    expect(journal.getRun(RUN)?.caps).toEqual({ maxConcurrency: 8 });
    expect(driver.events.length).toBe(eventsAtSettlement);
  });
});
