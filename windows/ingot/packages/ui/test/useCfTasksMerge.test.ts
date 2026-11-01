import { describe, expect, it } from "vitest";
import type { CfTaskMeta } from "@origin-ai/cf-shared";
import {
  mergeTaskMetaCandidates,
  mergeTaskWithOptimisticMeta,
} from "@/lib/cfTaskMetaMerge.js";

function createTaskMeta(overrides: Partial<CfTaskMeta> = {}): CfTaskMeta {
  return {
    taskId: "task-merge",
    traceId: "trace-merge",
    title: "TestsTask",
    workspacePath: "/repo/workspace",
    createdAt: 1,
    updatedAt: 1,
    mode: "default",
    provider: "codex",
    ...overrides,
  };
}

describe("mergeTaskWithOptimisticMeta", () => {
  it("会Retain optimistic 里的 unread Status，避免重刷list后蓝点闪回", () => {
    const persistedTask = createTaskMeta({
      updatedAt: 20,
      title: "Service端Title",
    });
    const optimisticTask = createTaskMeta({
      updatedAt: 10,
      title: "Service端Title",
      unreadAt: 789,
    });

    expect(mergeTaskWithOptimisticMeta(persistedTask, optimisticTask).unreadAt).toBe(789);
  });

  it("会RetainPersistence status，避免乐观Metadata覆盖后丢失Runtime", () => {
    const persistedTask = createTaskMeta({
      updatedAt: 20,
      status: "running",
    });
    const optimisticTask = createTaskMeta({
      updatedAt: 21,
      title: "Frontend乐观Title",
      status: undefined,
    });

    expect(mergeTaskWithOptimisticMeta(persistedTask, optimisticTask).status).toBe("running");
  });

  it("不会让较New的 New session 占位Title覆盖First messageUser query", () => {
    const persistedTask = createTaskMeta({
      updatedAt: 30,
      title: "New session",
      status: "running",
    });
    const optimisticTask = createTaskMeta({
      updatedAt: 20,
      title: "发现个Issue，Send完Messages后",
      status: "running",
    });

    expect(mergeTaskWithOptimisticMeta(persistedTask, optimisticTask).title).toBe(
      "发现个Issue，Send完Messages后",
    );
  });

  it("仍Allow generated title 覆盖First messageUser query", () => {
    const persistedTask = createTaskMeta({
      updatedAt: 40,
      title: "修复Session title闪烁",
      status: "completed",
    });
    const optimisticTask = createTaskMeta({
      updatedAt: 20,
      title: "发现个Issue，Send完Messages后",
      status: "running",
    });

    expect(mergeTaskWithOptimisticMeta(persistedTask, optimisticTask).title).toBe(
      "修复Session title闪烁",
    );
  });

  it("会让手动重命名TitleHigh于更New的 raw snapshot Title", () => {
    const indexedRenamedTask = createTaskMeta({
      title: "airline-1",
      titleOverridden: true,
      updatedAt: 20,
    });
    const rawSnapshotTask = createTaskMeta({
      title: "Analyze airline import flow",
      updatedAt: 30,
    });

    expect(
      mergeTaskMetaCandidates(rawSnapshotTask, indexedRenamedTask),
    ).toMatchObject({
      title: "airline-1",
      titleOverridden: true,
      updatedAt: 30,
    });
  });
});
