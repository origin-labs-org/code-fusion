

import { describe, expect, it } from "vitest";
import { InMemoryJournalStore } from "@origin-ai/cf-dynamic-workflow";
import { runScript } from "./helpers.js";

const RUN = "run";

const SCRIPT = [
  "interface Verdict { approved: boolean; reason: string; }",
  'const paths = await files.glob("src/**/*.ts");',
  "const verdicts = await Promise.all(",
  '  paths.map((p) => agent(`reviewer-${p}`).ask<Verdict>(`Review ${p}`)),',
  ");",
  'const lead = agent("lead");',
  "const summary = await lead.ask(`Reviewed ${paths.length} files`);",
  "return { reviewed: paths.length, summary, rejected: verdicts.filter((v) => !v.approved).length };",
].join("\n");

describe("e2e — resume by pure replay", () => {
  it("re-runs over a populated journal with a fresh child and zero driver dispatches", async () => {
    const paths = ["src/a.ts", "src/b.ts"];
    const journal = new InMemoryJournalStore();

    const first = await runScript(SCRIPT, {
      journal,
      worldReads: () => paths,
      asks: {
        "ask#1": ({ message }) => ({
          type: "submit",
          payload: { approved: !message.instructions.includes("src/b.ts"), reason: "r" },
        }),
        "ask#2": () => ({ type: "text", finalText: "all reviewed" }),
      },
    });
    expect(first.settlement).toEqual({
      status: "completed",
      artifact: { reviewed: 2, summary: "all reviewed", rejected: 1 },
    });
    expect(first.driver.startAskCount()).toBe(3); // 2 review + 1 summary

    const second = await runScript(SCRIPT, {
      journal,
      worldReads: () => {
        throw new Error("Resume should not trigger world-read (should be a journal hit)");
      },
      onStartAsk: (instance) => {
        throw new Error(`resume 不应 startAsk：${instance.siteId}@${instance.ordinal}`);
      },
    });

    expect(second.settlement).toEqual(first.settlement);
    expect(second.driver.startAskCount()).toBe(0);
    expect(second.driver.sessionCreations).toHaveLength(0);
    const cached = second.driver.eventsOfType("node-settled").filter((e) => e.cached === true);
    expect(cached.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps the first run's journaled node results intact on resume", async () => {
    const journal = new InMemoryJournalStore();
    await runScript(SCRIPT, {
      journal,
      worldReads: () => ["only.ts"],
      asks: {
        "ask#1": () => ({ type: "submit", payload: { approved: true, reason: "clean" } }),
        "ask#2": () => ({ type: "text", finalText: "done" }),
      },
    });
    const node = journal.getNode(RUN, "ask#1", 1);
    expect(node?.result).toEqual({ approved: true, reason: "clean" });

    await runScript(SCRIPT, {
      journal,
      worldReads: () => {
        throw new Error("no world-read on resume");
      },
      onStartAsk: () => {
        throw new Error("no dispatch on resume");
      },
    });
    expect(journal.getNode(RUN, "ask#1", 1)?.result).toEqual({ approved: true, reason: "clean" });
  });

  it("re-dispatches the interrupted ask on a re-created actor session after a cancel", async () => {
    const TWO_ASKS = [
      'const worker = agent("worker");',
      'const first = await worker.ask("first task");',
      "const second = await worker.ask(`second after ${first}`);",
      "return { first, second };",
    ].join("\n");

    const journal = new InMemoryJournalStore();
    const controller = new AbortController();

    const first = await runScript(TWO_ASKS, {
      journal,
      signal: controller.signal,
      asks: { "ask#1": () => ({ type: "text", finalText: "R1" }) },
      onStartAsk: (instance) => {
        if (instance.siteId === "ask#2") controller.abort();
      },
    });
    expect(first.settlement).toEqual({ status: "stopped", reason: "user" });
    expect(journal.getNode(RUN, "ask#1", 1)?.status).toBe("completed");
    expect(journal.getNode(RUN, "ask#2", 1)?.status).toBe("running");
    expect(journal.getActor(RUN, "actor#1", 1)?.sessionId).toBeDefined();

    const second = await runScript(TWO_ASKS, {
      journal,
      asks: { "ask#2": () => ({ type: "text", finalText: "R2" }) },
      onStartAsk: (instance) => {
        if (instance.siteId !== "ask#2") {
          throw new Error(`只Allow重派发 ask#2，收到 ${instance.siteId}@${instance.ordinal}`);
        }
      },
    });
    expect(second.settlement).toEqual({
      status: "completed",
      artifact: { first: "R1", second: "R2" },
    });
    expect(second.driver.startAskCount()).toBe(1);
    expect(second.driver.sessionCreations).toEqual([{ siteId: "actor#1", ordinal: 1 }]);
  });
});

describe("e2e — resume of a fan-out that reports after the join", () => {
  const FAN_OUT = [
    "interface Verdict { approved: boolean; reason: string; }",
    'const paths = await files.glob("src/**/*.ts");',
    "const verdicts = await Promise.all(",
    "  paths.map(async (p) => {",
    "    const v = await agent(`reviewer-${p}`).ask<Verdict>(`Review ${p}`);",
    "    report({ path: p, approved: v.approved });",
    "    return v;",
    "  }),",
    ");",
    "return { reviewed: verdicts.length };",
  ].join("\n");

  const PATHS = ["src/a.ts", "src/b.ts"];

  it("resumes without an InputHashMismatch and never re-reports an item", async () => {
    const journal = new InMemoryJournalStore();

    const first = await runScript(FAN_OUT, {
      journal,
      worldReads: () => PATHS,
      asks: {
        "ask#1": ({ message }) =>
          message.instructions.includes("src/a.ts")
            ? [
                { type: "submit", payload: { approved: true } },
                { type: "submit", payload: { approved: true, reason: "fixed" }, delayMs: 30 },
              ]
            : { type: "submit", payload: { approved: false, reason: "nit" } },
      },
    });
    expect(first.settlement).toEqual({ status: "completed", artifact: { reviewed: 2 } });

    const reportRows = journal
      .listNodes(RUN, { kinds: "all", withResult: true })
      .filter((n) => n.kind === "report")
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((n) => n.result);
    expect(reportRows).toEqual([
      { path: "src/b.ts", approved: false },
      { path: "src/a.ts", approved: true },
    ]);

    const second = await runScript(FAN_OUT, {
      journal,
      worldReads: () => {
        throw new Error("Resume should not trigger world-read (should be a journal hit)");
      },
      onStartAsk: (instance) => {
        throw new Error(`resume 不应 startAsk：${instance.siteId}@${instance.ordinal}`);
      },
    });

    expect(second.settlement).toEqual(first.settlement);
    expect(journal.getRun(RUN)?.failure).toBeUndefined();
    expect(second.driver.startAskCount()).toBe(0);
    expect(
      second.driver
        .eventsOfType("node-settled")
        .filter((e) => e.cached === true)
        .map((e) => `${e.instance.siteId}@${e.instance.ordinal}`),
    ).toEqual(["world-read#1@1", "ask#1@2", "ask#1@1"]);
    expect(second.driver.eventsOfType("report")).toEqual([]);
    expect(
      journal
        .listNodes(RUN, { kinds: "all", withResult: true })
        .filter((n) => n.kind === "report")
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((n) => n.result),
    ).toEqual(reportRows);
  });
});
