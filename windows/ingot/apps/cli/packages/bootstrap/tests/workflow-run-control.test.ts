

import { describe, expect, it } from "vitest";
import { InMemoryJournalStore } from "@origin-ai/cf-dynamic-workflow";
import { retuneRunConcurrency } from "../src/app/dynamic-workflow-run-retune.js";
import type { RunRegistryEntry } from "../src/app/dynamic-workflow-run-observation.js";
import { createWorkflowRunControl } from "../src/app/workflow-run-control.js";

const RUN = "dwfrun-control";
const DEFAULT_CONCURRENCY = 8;

function fakeEngine(verdict = true) {
  const calls: number[] = [];
  return {
    calls,
    engine: {
      setMaxConcurrency: (next: number) => {
        calls.push(next);
        return verdict;
      },
    },
  };
}

function fakeGate() {
  const limits: number[] = [];
  return { limits, gate: { setLimit: (next: number) => limits.push(next) } };
}

function liveEntry(control: RunRegistryEntry["control"], maxConcurrency?: number): RunRegistryEntry {
  return {
    controller: new AbortController(),
    startedAt: new Date(),
    cwd: "/tmp",
    scriptText: "",
    settlement: Promise.resolve({ status: "stopped", reason: "user" }) as never,
    ...(control === undefined ? {} : { control }),
    ...(maxConcurrency === undefined ? {} : { maxConcurrency }),
  };
}

function contextWith(entry: RunRegistryEntry) {
  const journal = new InMemoryJournalStore();
  journal.createRun({ runId: RUN, caps: { maxConcurrency: 4 }, spentTokens: 0, status: "running" });
  return { defaultConcurrency: () => DEFAULT_CONCURRENCY, journal, runs: new Map([[RUN, entry]]) };
}

describe("workflow run control", () => {
  it("还没绑上引擎：setMaxConcurrency 回 false，闸门不动，值也绝不缓冲", () => {
    const control = createWorkflowRunControl();
    const { gate, limits } = fakeGate();
    control.bindSeatGate(gate);

    expect(control.setMaxConcurrency(2)).toBe(false);
    expect(limits).toEqual([]);

    const { calls, engine } = fakeEngine();
    control.bind(engine);
    expect(calls).toEqual([]);
    expect(limits).toEqual([]);

    expect(control.setMaxConcurrency(2)).toBe(true);
    expect(calls).toEqual([2]);
    expect(limits).toEqual([2]);
  });

  it("引擎说没改（已结算 / 值没变）时闸门的上界一动不动", () => {
    const control = createWorkflowRunControl();
    const { gate, limits } = fakeGate();
    const { calls, engine } = fakeEngine(false);
    control.bind(engine);
    control.bindSeatGate(gate);

    expect(control.setMaxConcurrency(2)).toBe(false);
    expect(calls).toEqual([2]);
    expect(limits).toEqual([]);
  });

  it("没有闸门的装配也照常改（只剩调度器一个执行点）", () => {
    const control = createWorkflowRunControl();
    const { calls, engine } = fakeEngine();
    control.bind(engine);
    expect(control.setMaxConcurrency(3)).toBe(true);
    expect(calls).toEqual([3]);
  });

  it("retuneConcurrency 对着一个未绑定的控制面回 not_live，并且什么都没写", () => {
    const control = createWorkflowRunControl();
    const entry = liveEntry(control, 4);
    const ctx = contextWith(entry);

    expect(retuneRunConcurrency(ctx, { maxConcurrency: 2, runId: RUN })).toEqual({
      ok: false,
      reason: "not_live",
      current: 4,
    });
    expect(entry.maxConcurrency).toBe(4);
    expect(ctx.journal.getRun(RUN)?.caps).toEqual({ maxConcurrency: 4 });
    expect(ctx.journal.listEvents(RUN, { types: "all", reportItems: "all" })).toEqual([]);
  });

  it("retuneConcurrency 对着没有控制面的老条目同样回 not_live", () => {
    const ctx = contextWith(liveEntry(undefined, 4));
    expect(retuneRunConcurrency(ctx, { maxConcurrency: 2, runId: RUN })).toEqual({
      ok: false,
      reason: "not_live",
    });
  });
});
