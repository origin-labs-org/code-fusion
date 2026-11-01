

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSqliteSessionStore } from "@origin-ai/cf-adapters/storage";
import type { JournalStorePort, RunRecord } from "@origin-ai/cf-dynamic-workflow";
import type { DwfRunLifeSpan } from "@origin-ai/cf-adapters/storage";
import { runLineageActiveMs } from "../src/app/dynamic-workflow-run-elapsed.js";
import { resolveDynamicWorkflowJournalStore } from "../src/app/dynamic-workflow-run-journal.js";

function fakeJournal(input: {
  lives: Record<string, DwfRunLifeSpan[]>;
  resumedFrom?: Record<string, string>;
  omitLifeSpans?: boolean;
}): JournalStorePort & { calls: string[] } {
  const calls: string[] = [];
  const base = {
    calls,
    getRun(runId: string): RunRecord | undefined {
      if (input.lives[runId] === undefined && input.resumedFrom?.[runId] === undefined) {
        return undefined;
      }
      const resumedFrom = input.resumedFrom?.[runId];
      return {
        runId,
        caps: { maxConcurrency: 4 },
        spentTokens: 0,
        status: "completed",
        ...(resumedFrom === undefined ? {} : { resumedFrom }),
      } satisfies RunRecord;
    },
  } as unknown as JournalStorePort & { calls: string[] };
  if (input.omitLifeSpans === true) return base;
  return Object.assign(base, {
    listRunLifeSpans(runId: string): DwfRunLifeSpan[] {
      calls.push(runId);
      return input.lives[runId] ?? [];
    },
  });
}

const HOUR = 3_600_000;

describe("runLineageActiveMs", () => {
  it("单世 run：就是那一世的墙钟", () => {
    const journal = fakeJournal({ lives: { a: [{ startedAt: 1_000, lastActivityAt: 61_000 }] } });

    expect(runLineageActiveMs(journal, "a")).toBe(60_000);
  });

  it("多世 run（resume）：逐世相加，世与世之间的死时间不计", () => {
    const journal = fakeJournal({
      lives: {
        a: [
          { startedAt: 0, lastActivityAt: HOUR },
          { startedAt: 200 * HOUR, lastActivityAt: 200 * HOUR + 120_000 },
        ],
      },
    });

    expect(runLineageActiveMs(journal, "a")).toBe(HOUR + 120_000);
  });

  it("修订链：沿 resumedFrom 上溯，前驱的每一世都算进来", () => {
    const journal = fakeJournal({
      lives: {
        a: [{ startedAt: 0, lastActivityAt: 4 * HOUR }],
        b: [{ startedAt: 10 * HOUR, lastActivityAt: 10 * HOUR + HOUR }],
        c: [{ startedAt: 20 * HOUR, lastActivityAt: 20 * HOUR + 12_000 }],
      },
      resumedFrom: { c: "b", b: "a" },
    });

    expect(runLineageActiveMs(journal, "c")).toBe(4 * HOUR + HOUR + 12_000);
    expect(runLineageActiveMs(journal, "b")).toBe(4 * HOUR + HOUR);
    expect(runLineageActiveMs(journal, "a")).toBe(4 * HOUR);
  });

  it("Read surface absent (engine\'s in-memory journal): undefined, letting caller fall back to current generation", () => {
    const journal = fakeJournal({
      lives: { a: [{ startedAt: 0, lastActivityAt: HOUR }] },
      omitLifeSpans: true,
    });

    expect(runLineageActiveMs(journal, "a")).toBeUndefined();
  });

  it("一世都没有（老 run / 行已清理）：undefined，不是 0", () => {
    const journal = fakeJournal({ lives: {} });

    expect(runLineageActiveMs(journal, "a")).toBeUndefined();
    expect(
      runLineageActiveMs(fakeJournal({ lives: { a: [{ startedAt: 5, lastActivityAt: 5 }] } }), "a"),
    ).toBe(0);
  });

  it("Predecessor row pruned: current run\'s generations are still counted, chain naturally stops at the unreadable hop", () => {
    const journal = fakeJournal({
      lives: { c: [{ startedAt: 0, lastActivityAt: 12_000 }] },
      resumedFrom: { c: "gone" },
    });

    expect(runLineageActiveMs(journal, "c")).toBe(12_000);
  });

  it("墙钟倒退的一世钳到 0，不从别的世里减时间", () => {
    const journal = fakeJournal({
      lives: {
        a: [
          { startedAt: 1_000, lastActivityAt: 500 },
          { startedAt: 10_000, lastActivityAt: 70_000 },
        ],
      },
    });

    expect(runLineageActiveMs(journal, "a")).toBe(60_000);
  });

  it("Self-referencing and cyclic resumedFrom won\'t loop infinitely; each run is read only once", () => {
    const selfRef = fakeJournal({
      lives: { a: [{ startedAt: 0, lastActivityAt: 1_000 }] },
      resumedFrom: { a: "a" },
    });
    expect(runLineageActiveMs(selfRef, "a")).toBe(1_000);
    expect(selfRef.calls).toEqual(["a"]);

    const cycle = fakeJournal({
      lives: {
        a: [{ startedAt: 0, lastActivityAt: 1_000 }],
        b: [{ startedAt: 0, lastActivityAt: 2_000 }],
      },
      resumedFrom: { a: "b", b: "a" },
    });
    expect(runLineageActiveMs(cycle, "a")).toBe(3_000);
    expect(cycle.calls).toEqual(["a", "b"]);
  });

  it("长链在跳数上限处停下（读一个时长不该扫过任意多行）", () => {
    const lives: Record<string, DwfRunLifeSpan[]> = {};
    const resumedFrom: Record<string, string> = {};
    for (let index = 0; index < 200; index += 1) {
      lives[`r${index}`] = [{ startedAt: 0, lastActivityAt: 1_000 }];
      resumedFrom[`r${index}`] = `r${index + 1}`;
    }
    const journal = fakeJournal({ lives, resumedFrom });

    expect(runLineageActiveMs(journal, "r0")).toBe(64_000);
    expect(journal.calls).toHaveLength(64);
  });
});

describe("runLineageActiveMs — 对着真实 sqlite journal", () => {
  const CAPS = { maxConcurrency: 4 };
  const T0 = Date.UTC(2026, 8, 18, 9, 0, 0);

  afterEach(() => {
    vi.useRealTimers();
  });

  
  function appendAt(
    journal: JournalStorePort,
    runId: string,
    at: number,
    event: "start" | "log" | "settle",
  ): void {
    vi.setSystemTime(at);
    journal.appendEvent(
      runId,
      event === "start"
        ? { type: "run-started", runId, caps: CAPS }
        : event === "log"
          ? { type: "log", message: "工作中" }
          : { type: "run-settled", status: "completed" },
    );
  }

  it("多世 + 修订链：真库上的求和只算活着的那几段", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "cf-dwf-elapsed-"));
    const store = await createSqliteSessionStore({ dbPath: join(tempRoot, "session.sqlite") });
    try {
      const journal = resolveDynamicWorkflowJournalStore(store as never);
      expect(journal).toBeDefined();
      vi.useFakeTimers({ toFake: ["Date"] });

      journal!.createRun({ runId: "dwfrun-pred", caps: CAPS, spentTokens: 0, status: "running" });
      appendAt(journal!, "dwfrun-pred", T0, "start");
      appendAt(journal!, "dwfrun-pred", T0 + 3_600_000, "log");
      appendAt(journal!, "dwfrun-pred", T0 + 48 * 3_600_000, "start");
      appendAt(journal!, "dwfrun-pred", T0 + 48 * 3_600_000 + 120_000, "settle");

      journal!.createRun({
        runId: "dwfrun-amended",
        caps: CAPS,
        spentTokens: 0,
        status: "running",
        resumedFrom: "dwfrun-pred",
      });
      appendAt(journal!, "dwfrun-amended", T0 + 72 * 3_600_000, "start");
      appendAt(journal!, "dwfrun-amended", T0 + 72 * 3_600_000 + 12_000, "settle");

      expect(runLineageActiveMs(journal!, "dwfrun-pred")).toBe(3_600_000 + 120_000);
      expect(runLineageActiveMs(journal!, "dwfrun-amended")).toBe(3_600_000 + 120_000 + 12_000);
    } finally {
      vi.useRealTimers();
      store.close();
      await rm(tempRoot, { force: true, recursive: true });
    }
  });
});
