import { describe, expect, it } from "vitest";
import type { WorkflowRunState } from "@origin-ai/cf-shared/cf-protocol-v4";
import enUS from "@/i18n/locales/en-US.js";
import zhCN from "@/i18n/locales/zh-CN.js";
import { workflowRunEventLines } from "@/app-shell/workflowRunPanel.js";
import {
  throttleReasonLabel,
  workflowRunConcurrencyChip,
  workflowRunConcurrencyView,
} from "@/app-shell/workflowRunThrottle.js";

const format = (descriptor: { id: string }, values?: Record<string, string>) =>
  values ? `${descriptor.id}:${Object.values(values).join("/")}` : descriptor.id;

const T0 = 1_700_000_000_000;

describe("原因Tags（EventsLogs用）", () => {
  it("已知原因映射到短Tags键，陌生原因原样Show", () => {
    expect(throttleReasonLabel("rate_limited", format)).toBe(
      "chat.toolCall.workflow.run.throttle.reason.rateLimited",
    );
    expect(throttleReasonLabel("provider_overloaded", format)).toBe(
      "chat.toolCall.workflow.run.throttle.reason.overloaded",
    );
    expect(throttleReasonLabel("offpeak_queued", format)).toBe(
      "chat.toolCall.workflow.run.throttle.reason.offpeak",
    );
    for (const reason of [
      "server_error",
      "network_error",
      "timeout",
      "stream_idle_timeout",
      "stale_connection",
    ]) {
      expect(throttleReasonLabel(reason, format)).toBe(
        "chat.toolCall.workflow.run.throttle.reason.transient",
      );
    }
    expect(throttleReasonLabel("something_new", format)).toBe("something_new");
  });
});

describe("workflowRunConcurrencyView：被压在自己的Boundary之下，or有自己的Boundary时在场", () => {
  it("Running on default → undefined；被压下去 → cap/ceiling", () => {
    expect(workflowRunConcurrencyView({ cap: 14, ceiling: 14 }, T0)).toBeUndefined();
    expect(workflowRunConcurrencyView(undefined, T0)).toBeUndefined();
    expect(workflowRunConcurrencyView({ cap: 4, ceiling: 14 }, T0)).toEqual({
      cap: 4,
      ceiling: 14,
    });
  });

  it("有 limit 时Show两条Boundary里小的那个", () => {
    expect(workflowRunConcurrencyView({ cap: 8, ceiling: 8, limit: 3 }, T0)).toEqual({
      cap: 3,
      ceiling: 8,
    });
    expect(workflowRunConcurrencyView({ cap: 2, ceiling: 8, limit: 3 }, T0)).toEqual({
      cap: 2,
      ceiling: 8,
    });
    expect(workflowRunConcurrencyView({ cap: 8, ceiling: 8 }, T0)).toBeUndefined();
  });

  it("Default run 的Shared cap Long到 D 之上：读CountYes min(cap, D) = D，没有可说的", () => {
    expect(workflowRunConcurrencyView({ cap: 12, ceiling: 8 }, T0)).toBeUndefined();
  });

  it("调到Default之上的 run：芯片恒在，读CountYes min(cap, limit)", () => {
    expect(workflowRunConcurrencyView({ cap: 9, ceiling: 8, limit: 20 }, T0)).toEqual({
      cap: 9,
      ceiling: 8,
    });
    expect(workflowRunConcurrencyView({ cap: 24, ceiling: 8, limit: 20 }, T0)).toEqual({
      cap: 20,
      ceiling: 8,
    });
  });

  it("冷却按收到时刻推 deadline，Expired即缺席", () => {
    const concurrency = { cap: 4, ceiling: 14, cooldownMs: 20_000 };
    expect(workflowRunConcurrencyView(concurrency, T0)).toEqual({
      cap: 4,
      ceiling: 14,
      cooldownUntil: T0 + 20_000,
    });
    expect(workflowRunConcurrencyView(concurrency, T0 + 10_000)?.cooldownUntil).toBe(T0 + 20_000);
    expect(workflowRunConcurrencyView(concurrency, T0 + 20_000)).toEqual({ cap: 4, ceiling: 14 });
  });
});

describe("workflowRunConcurrencyChip：与 Configure 同进同退", () => {
  function runWith(overrides: Partial<WorkflowRunState>): WorkflowRunState {
    return {
      runId: "run-a",
      toolCallId: "tool-a",
      status: "running",
      usage: { spentTokens: 0, nodesUsed: 0 },
      actors: [],
      nodes: [],
      lastEventSequence: 0,
      concurrency: { cap: 13, ceiling: 13, limit: 4 },
      ...overrides,
    };
  }

  it.each([
    ["running", runWith({ status: "running" })],
    ["pending", runWith({ status: "pending" })],
    ["stopped（可恢复，恢复后仍在这条Boundary下Run）", runWith({ status: "stopped", stopReason: "user" })],
    ["errored（换SettingsRetry的主场景）", runWith({ status: "errored" })],
  ])("%s 的 run 带着芯片", (_case, state) => {
    expect(workflowRunConcurrencyChip(state, T0)).toEqual({ cap: 4, ceiling: 13 });
  });

  it.each([
    ["completed", runWith({ status: "completed" })],
    [
      "superseded",
      runWith({ status: "stopped", stopReason: "superseded", supersededBy: "run-next" }),
    ],
  ])("%s 的 run 没有芯片，即便Boundary仍在天花板之下", (_case, state) => {
    expect(workflowRunConcurrencyChip(state, T0)).toBeUndefined();
  });

  it("run 不在投影里、orRun在天花板上 → 没有芯片", () => {
    expect(workflowRunConcurrencyChip(undefined, T0)).toBeUndefined();
    expect(
      workflowRunConcurrencyChip(runWith({ concurrency: { cap: 13, ceiling: 13 } }), T0),
    ).toBeUndefined();
  });

  it("两种语言都Yes「最大ConcurrencyCount N」/「Max concurrency N」", () => {
    const key = "chat.toolCall.workflow.run.concurrency.label";
    expect((zhCN as Record<string, string>)[key]).toBe("最大ConcurrencyCount {cap}");
    expect((enUS as Record<string, string>)[key]).toBe("Max concurrency {cap}");
  });
});

describe("EventsLogs：Three条自FitConcurrencyEvents各有One行，其余仍走 unknown 兜底", () => {
  it("node-waiting(slot) / node-waiting(backoff) / node-executing / concurrency-changed", () => {
    const lines = workflowRunEventLines(
      [
        {
          sequence: 1,
          type: "node-waiting",
          payload: { instance: { siteId: "ask#1", ordinal: 1 }, cause: "slot" },
        },
        {
          sequence: 2,
          type: "node-waiting",
          payload: {
            instance: { siteId: "ask#1", ordinal: 1 },
            cause: "backoff",
            reason: "rate_limited",
            attempt: 2,
            delayMs: 20_500,
          },
        },
        {
          sequence: 3,
          type: "node-executing",
          payload: { instance: { siteId: "ask#1", ordinal: 1 } },
        },
        {
          sequence: 4,
          type: "concurrency-changed",
          payload: { key: "p/m", previous: 14, next: 7, reason: "rate_limited" },
        },
        { sequence: 5, type: "compaction", payload: { actor: { siteId: "a", ordinal: 1 } } },
      ],
      format,
    );
    expect(lines[0]).toMatchObject({
      label: "chat.toolCall.workflow.run.event.nodeWaitingSlot",
      detail: "ask#1@1",
      tone: "default",
    });
    expect(lines[1]).toMatchObject({
      label:
        "chat.toolCall.workflow.run.event.nodeWaitingBackoff:chat.toolCall.workflow.run.throttle.reason.rateLimited/21",
      detail: "ask#1@1",
      tone: "default",
    });
    expect(lines[2]).toMatchObject({
      label: "chat.toolCall.workflow.run.event.nodeExecuting",
      detail: "ask#1@1",
    });
    expect(lines[3]).toMatchObject({
      label: "chat.toolCall.workflow.run.event.concurrencyChanged:14/7",
      detail: "p/m",
    });
    expect(lines[4]?.label).toBe("chat.toolCall.workflow.run.event.unknown:compaction");
  });

  it("run-caps-changed 各有One行；caps 读不动时CountCharacter写「?」", () => {
    const lines = workflowRunEventLines(
      [
        {
          sequence: 1,
          type: "run-caps-changed",
          payload: {
            caps: { maxConcurrency: 2 },
            previous: { maxConcurrency: 8 },
            concurrencyCeiling: 8,
          },
        },
        { sequence: 2, type: "run-caps-changed", payload: { caps: "nope", previous: 8 } },
      ],
      format,
    );
    expect(lines[0]).toMatchObject({
      label: "chat.toolCall.workflow.run.event.runCapsChanged:8/2",
      tone: "default",
    });
    expect(lines[0]).not.toHaveProperty("detail");
    expect(lines[1]?.label).toBe("chat.toolCall.workflow.run.event.runCapsChanged:?/?");
  });

  it("两种语言各有One句：Concurrency上限 8 → 2 / Concurrency limit 8 → 2", () => {
    expect(zhCN["chat.toolCall.workflow.run.event.runCapsChanged"]).toBe(
      "Concurrency上限 {previous} → {next}",
    );
    expect(enUS["chat.toolCall.workflow.run.event.runCapsChanged"]).toBe(
      "Concurrency limit {previous} → {next}",
    );
  });

  it("node-waiting 缺 cause 时按 slot Processing（没有退避细节可说）", () => {
    const lines = workflowRunEventLines(
      [
        {
          sequence: 1,
          type: "node-waiting",
          payload: { instance: { siteId: "ask#1", ordinal: 1 } },
        },
      ],
      format,
    );
    expect(lines[0]?.label).toBe("chat.toolCall.workflow.run.event.nodeWaitingSlot");
  });
});
