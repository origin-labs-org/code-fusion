import { describe, expect, it } from "vitest";
import {
  describeOffPeakCardStatus,
  readOffPeakCreateTaskOutputSummary,
} from "@/ToolCallBlocks/renderers/offpeak-create.js";
import { resolveOffPeakDetailNavigation } from "@/settings/AutomationsSection.js";
import type { CfOffPeakTask } from "@origin-ai/cf-shared";

const intl = {
  formatMessage: (
    { id }: { id: string },
    values?: Record<string, string | number>,
  ) => (id === "offPeak.chatCreated.queuedAt" ? `Queued第 ${values?.["position"]} 位` : id),
};

describe("OffPeakCreateTaskCard output (D49-6 static carousel tail card)", () => {
  it("从工具输出解析最小任务快照（含 JSON 字符串候选）", () => {
    const task = readOffPeakCreateTaskOutputSummary(
      JSON.stringify({
        task: {
          offPeakTaskId: "offpeak-abc",
          title: "重构 utils",
          status: "queued",
          queuePosition: 3,
          createdAt: 1_700_000_000_000,
        },
        message: "Created idle-time task offpeak-abc (#3 in queue).",
      }),
    );

    expect(task).toMatchObject({
      offPeakTaskId: "offpeak-abc",
      title: "重构 utils",
      status: "queued",
      queuePosition: 3,
    });
  });

  it("Missing offPeakTaskId is treated as invalid output (card must be able to locate the task)", () => {
    expect(
      readOffPeakCreateTaskOutputSummary({ task: { title: "无 id", status: "queued" } }),
    ).toBeNull();
  });

  it("Status line: displays snapshot at creation time if rank exists; falls back to queue copy if no rank", () => {
    expect(
      describeOffPeakCardStatus({ offPeakTaskId: "offpeak-1", queuePosition: 3 }, intl),
    ).toBe("3rd in queue");
    expect(describeOffPeakCardStatus({ offPeakTaskId: "offpeak-1" }, intl)).toBe(
      "offPeak.chatCreated.queued",
    );
  });
});

describe("resolveOffPeakDetailNavigation（卡片跳转 idle tab 编辑视图）", () => {
  const task = { offPeakTaskId: "offpeak-abc", title: "t" } as CfOffPeakTask;

  it("Keep pending while store is loading (do not consume navigation, do not false-report targetNotFound)", () => {
    expect(resolveOffPeakDetailNavigation([task], "offpeak-abc", false)).toEqual({
      status: "pending",
    });
  });

  it("命中返回 found 目标", () => {
    expect(resolveOffPeakDetailNavigation([task], "offpeak-abc", true)).toEqual({
      status: "found",
      target: task,
    });
  });

  it("Return missing when task has been deleted", () => {
    expect(resolveOffPeakDetailNavigation([task], "offpeak-gone", true)).toEqual({
      status: "missing",
    });
  });

  it("Return unavailable when refresh fails (store.error is not empty); do not make found/missing final determinations (review CR-01)", () => {
    expect(resolveOffPeakDetailNavigation([], "offpeak-abc", true, "list failed")).toEqual({
      status: "unavailable",
    });
    expect(resolveOffPeakDetailNavigation([], "offpeak-abc", false, "list failed")).toEqual({
      status: "pending",
    });
  });
});
