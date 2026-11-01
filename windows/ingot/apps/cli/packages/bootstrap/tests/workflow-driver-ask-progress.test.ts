

import { describe, expect, it } from "vitest";
import type { RunEvent } from "@origin-ai/cf-dynamic-workflow";
import { runDriverScript } from "./workflow-driver.helpers.js";

type ProgressEvent = Extract<RunEvent, { type: "node-progress" }>;

const progressOf = (events: RunEvent[]): ProgressEvent[] =>
  events.filter((e): e is ProgressEvent => e.type === "node-progress");

const TYPED_ASK_SCRIPT = [
  "interface Summary { title: string; points: string[]; }",
  'const worker = agent("worker", "You summarize repos.");',
  'const s = await worker.ask<Summary>("Summarize the repo");',
  "return s;",
].join("\n");

describe("workflow driver — node-progress", () => {
  it("一次 turn 一条，turn 从 1 起，且紧挨着排在 usage-updated 前面", async () => {
    const artifact = { title: "Repo", points: ["a"] };
    const { events } = await runDriverScript(TYPED_ASK_SCRIPT, {
      actorScripts: { "actor#1@1": [{ kind: "submit", result: artifact }] },
    });

    const progress = progressOf(events);
    expect(progress).toHaveLength(1);
    expect(progress[0]).toMatchObject({
      instance: { siteId: "ask#1", ordinal: 1 },
      turn: 1,
      toolCalls: 1,
      lastTool: { name: "submit_result" },
    });

    const index = events.findIndex((e) => e.type === "node-progress");
    expect(events[index + 1]?.type).toBe("usage-updated");
  });

  it("nudge 起的新一轮是第 2 个 turn（同一个 ask 内累加）", async () => {
    const valid = { title: "Repo", points: ["x"] };
    const { events } = await runDriverScript(TYPED_ASK_SCRIPT, {
      actorScripts: {
        "actor#1@1": [
          { kind: "text", text: "Here is the summary." },
          { kind: "submit", result: valid },
        ],
      },
    });

    const progress = progressOf(events);
    expect(progress.map((e) => e.turn)).toEqual([1, 2]);
    expect(progress.map((e) => e.toolCalls)).toEqual([0, 1]);
    expect(progress[0]).not.toHaveProperty("lastTool");
    expect(progress[1]?.lastTool).toMatchObject({ name: "submit_result" });
  });

  it("Resets on new ask: the same subagent\'s second ask counts from turn 1 again", async () => {
    const script = [
      'const worker = agent("worker");',
      'const a = await worker.ask("first");',
      'const b = await worker.ask("second");',
      "return `${a}/${b}`;",
    ].join("\n");

    const { settlement, events } = await runDriverScript(script, {
      actorScripts: {
        "actor#1@1": [
          { kind: "text", text: "A" },
          { kind: "text", text: "B" },
        ],
      },
    });

    expect(settlement).toEqual({ status: "completed", artifact: "A/B" });
    const progress = progressOf(events);
    expect(progress.map((e) => [e.instance.siteId, e.turn, e.toolCalls])).toEqual([
      ["ask#1", 1, 0],
      ["ask#2", 1, 0],
    ]);
  });
});
