import { describe, expect, it } from "vitest";
import {
  completeHighspeedTurn,
  listHighspeedCardAutoShareCandidates,
  markHighspeedTurnMetricsPersisted,
  recordHighspeedTurn,
  setHighspeedCardTps,
} from "@/highspeed/highspeedTurnStore.js";
import {
  collectHighspeedCardShareBlockers,
  listHighspeedCardsAwaitingAutoShare,
} from "@/highspeed/highspeedShareDiagnostics.js";
import type { HighspeedCardSnapshot } from "@origin-ai/cf-shared";

function makeCard(cardId: string, expiresAt: number): HighspeedCardSnapshot {
  return {
    cardId,
    taskId: "task-share-blockers",
    provider: "zai",
    model: "glm-5",
    issuedAt: expiresAt - 60_000,
    expiresAt,
    regularTps: 30,
  };
}

function seedTurn(cardId: string, commandId: string, expiresAt: number): void {
  recordHighspeedTurn({
    sessionId: "session-share-blockers",
    sourceCommandId: commandId,
    card: makeCard(cardId, expiresAt),
    createdAt: expiresAt - 60_000,
  });
  completeHighspeedTurn({
    sourceCommandId: commandId,
    outputTokens: 900,
    durationMs: 19_000,
    modelDurationMs: 9_000,
    toolDurationMs: 8_000,
  });
  setHighspeedCardTps(cardId, 90);
}

describe("highspeed card share blockers", () => {
  it("卡inner任One轮未Persistence时Back带 sourceCommandId 的阻塞原因", () => {
    seedTurn("hsc-block-1", "cmd-block-1a", 10_000);
    seedTurn("hsc-block-1", "cmd-block-1b", 10_000);
    markHighspeedTurnMetricsPersisted("cmd-block-1a", 6_000);

    const blockers = collectHighspeedCardShareBlockers("hsc-block-1");
    expect(blockers).toEqual(["turn-metrics-not-persisted:cmd-block-1b"]);
  });

  it("零Output卡Back zero-output 阻塞", () => {
    recordHighspeedTurn({
      sessionId: "session-share-blockers",
      sourceCommandId: "cmd-block-2",
      card: makeCard("hsc-block-2", 10_000),
      createdAt: 9_000,
    });
    completeHighspeedTurn({
      sourceCommandId: "cmd-block-2",
      outputTokens: 0,
      durationMs: 5_000,
    });
    setHighspeedCardTps("hsc-block-2", 90);
    markHighspeedTurnMetricsPersisted("cmd-block-2", 1_000);

    expect(collectHighspeedCardShareBlockers("hsc-block-2")).toEqual(["zero-output"]);
  });

  it("所有门禁满足时无阻塞", () => {
    seedTurn("hsc-block-3", "cmd-block-3", 10_000);
    markHighspeedTurnMetricsPersisted("cmd-block-3", 6_000);

    expect(collectHighspeedCardShareBlockers("hsc-block-3")).toEqual([]);
  });

  it("Missing卡级 TPS 时WaitingPersistence的轮不会误报，未Completed统计的轮报 metrics-missing", () => {
    recordHighspeedTurn({
      sessionId: "session-share-blockers",
      sourceCommandId: "cmd-block-4",
      card: makeCard("hsc-block-4", 10_000),
      createdAt: 9_000,
    });

    expect(collectHighspeedCardShareBlockers("hsc-block-4")).toEqual([
      "turn-metrics-missing:cmd-block-4",
    ]);
  });

  it("加速倍率未达Label（≤1.2x）的卡不进候选，Diagnostics报 below-min-speedup", () => {
    seedTurn("hsc-lowspeed", "cmd-lowspeed", 10_000);
    markHighspeedTurnMetricsPersisted("cmd-lowspeed", 1_000);

    expect(
      listHighspeedCardAutoShareCandidates("session-share-blockers").some(
        (candidate) => candidate.cardId === "hsc-lowspeed",
      ),
    ).toBe(false);
    expect(collectHighspeedCardShareBlockers("hsc-lowspeed")).toEqual(["below-min-speedup"]);
  });

  it("Diagnostics结论与Auto分享候选Triage不漂移", () => {
    seedTurn("hsc-xcheck-1", "cmd-xcheck-1", 10_000);
    markHighspeedTurnMetricsPersisted("cmd-xcheck-1", 6_000);
    const candidates1 = listHighspeedCardAutoShareCandidates("session-share-blockers");
    expect(candidates1.some((c) => c.cardId === "hsc-xcheck-1")).toBe(true);
    expect(collectHighspeedCardShareBlockers("hsc-xcheck-1")).toEqual([]);

    seedTurn("hsc-xcheck-2", "cmd-xcheck-2a", 10_000);
    seedTurn("hsc-xcheck-2", "cmd-xcheck-2b", 10_000);
    markHighspeedTurnMetricsPersisted("cmd-xcheck-2a", 6_000);
    const candidates2 = listHighspeedCardAutoShareCandidates("session-share-blockers");
    expect(candidates2.some((c) => c.cardId === "hsc-xcheck-2")).toBe(false);
    expect(collectHighspeedCardShareBlockers("hsc-xcheck-2")).toEqual([
      "turn-metrics-not-persisted:cmd-xcheck-2b",
    ]);
  });

  it("listHighspeedCardsAwaitingAutoShare 只Back已到期且未尝试分享的卡", () => {
    const now = 20_000;
    seedTurn("hsc-await-1", "cmd-await-1", 10_000);
    seedTurn("hsc-await-2", "cmd-await-2", 30_000);

    const awaiting = listHighspeedCardsAwaitingAutoShare("session-share-blockers", now);
    expect(awaiting).toContain("hsc-await-1");
    expect(awaiting).not.toContain("hsc-await-2");
  });
});
