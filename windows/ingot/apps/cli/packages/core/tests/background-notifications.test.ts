//
import { describe, expect, it } from "vitest";
import { createRootTraceContext, createSessionId } from "@origin-ai/cf-contracts";
import type { BackgroundResultOriginMeta } from "@origin-ai/cf-contracts";
import { resolveBackgroundTaskNotificationOriginMeta } from "../src/runtime/methods/background-notifications.js";
import {
  createRuntimeCommandId,
  type TaskNotificationRuntimeCommand,
} from "../src/runtime/command-queue.js";

function makeCommand(originMeta?: BackgroundResultOriginMeta): TaskNotificationRuntimeCommand {
  return {
    branchGeneration: 0,
    createdAt: new Date(),
    id: createRuntimeCommandId(),
    mode: "task-notification",
    priority: "next",
    source: "background_task",
    text: "notification body",
    traceContext: createRootTraceContext({ sessionId: createSessionId("bg-notif-test") }),
    ...(originMeta ? { originMeta } : {}),
  };
}

const workflowOriginMeta: BackgroundResultOriginMeta = {
  backgroundSource: "workflow",
  title: "nightly audit",
  workId: "dwfrun-1",
  workflowNotification: {
    kind: "terminal",
    status: "completed",
    summary: "nightly audit",
    result: "done",
    resultForm: "prose",
  },
};

describe("resolveBackgroundTaskNotificationOriginMeta", () => {
  it("单条：originMeta 整体透传，manifest 载荷保留", () => {
    const resolved = resolveBackgroundTaskNotificationOriginMeta([makeCommand(workflowOriginMeta)]);
    expect(resolved).toEqual(workflowOriginMeta);
  });

  it("批量轮：合成 title，刻意丢弃 workflowNotification（退回三基字段）", () => {
    const resolved = resolveBackgroundTaskNotificationOriginMeta([
      makeCommand(workflowOriginMeta),
      makeCommand({
        backgroundSource: "workflow",
        title: "hourly sweep",
        workId: "dwfrun-2",
        workflowNotification: {
          kind: "escalation",
          qid: "dwfq-2",
          actor: "poet",
          question: "继续吗？",
        },
      }),
    ]);
    expect(resolved).toEqual({
      backgroundSource: "workflow",
      title: "nightly audit · hourly sweep",
      workId: "dwfrun-1",
    });
    expect(resolved?.workflowNotification).toBeUndefined();
  });
});
