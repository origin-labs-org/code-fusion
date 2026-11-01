import { describe, expect, it, vi } from "vitest";
import { Emitter } from "@origin-ai/cf-rpc";
import type { ICfTaskService } from "@origin-ai/cf-services";
import type { CfTaskMeta, CfWorkspaceEvent } from "@origin-ai/cf-shared";
import { createWindowHostControllerRuntime } from "@desktop/host/windowHostControllerService.js";
import {
  collectArchivedTaskDeletion,
  deleteArchivedTaskSelection,
} from "@/lib/archivedTaskDeletion.js";

function createSource(count: number, workspacePath = "/isolated/probe") {
  const events = new Emitter<CfWorkspaceEvent>();
  const rows = new Map<string, CfTaskMeta>(
    Array.from({ length: count }, (_, index) => {
      const task: CfTaskMeta = {
        taskId: `task-${index}`,
        traceId: `trace-${index}`,
        title: `task-${index}`,
        workspacePath,
        createdAt: 1,
        updatedAt: 1,
        mode: "default",
      };
      return [task.taskId, task];
    }),
  );
  const emitDeleted = () =>
    events.fire({
      type: "workspace_task_list_changed",
      workspacePath,
      reason: "task_deleted",
    });
  const source = {
    listTasks: vi.fn(async () => []),
    listPinnedTasks: vi.fn(async () => []),
    listArchivedTasks: vi.fn(async () => [...rows.values()]),
    onDynamicWorkspaceEvent: () => events.event,
    deleteArchivedTask: vi.fn(async ({ taskId }: { taskId: string }) => {
      const deleted = rows.delete(taskId);
      if (deleted) emitDeleted();
      return deleted;
    }),
    deleteArchivedTasks: vi.fn(async ({ taskIds }: { taskIds: string[] }) => {
      const deletedTaskIds = taskIds.filter((taskId) => rows.delete(taskId));
      if (deletedTaskIds.length) emitDeleted();
      return { deletedTaskIds, skippedTaskIds: [], failedTaskIds: [] };
    }),
  };
  return { source, rows };
}

describe("Archive batches cross the UI / Controller refresh boundary", () => {
  it.each([1, 8, 72])("%i 个目标只发一个批次，Host 分区读取不随目标数增长", async (count) => {
    const workspacePath = "/isolated/probe";
    const { source, rows } = createSource(count);
    const runtime = createWindowHostControllerRuntime({
      createId: () => "probe",
      resolveSource: () => ({
        scope: { kind: "local", workspacePath },
        sourceAvailability: "online",
        taskService: source as unknown as ICfTaskService,
      }),
    });
    try {
      const facade = {
        listArchivedTasks: source.listArchivedTasks,
        deleteArchivedTask: async (params: { taskId: string; workspacePath: string }) =>
          runtime.service.deleteArchivedTask({
            address: await runtime.resolveTaskAddress({ ...params, allowMissingTask: true }),
          }),
        deleteArchivedTasks: async (params: { taskIds: string[]; workspacePath: string }) =>
          runtime.service.deleteArchivedTasks({
            address: await runtime.resolveTaskAddress({
              ...params,
              taskId: params.taskIds[0]!,
              allowMissingTask: true,
            }),
            taskIds: params.taskIds,
          }),
      };
      await runtime.resolveTaskAddress({ workspacePath, taskId: "task-0" });
      const selection = await collectArchivedTaskDeletion([
        { workspacePath, label: "probe", service: facade },
      ]);
      source.listTasks.mockClear();
      source.listPinnedTasks.mockClear();
      source.listArchivedTasks.mockClear();
      expect(await deleteArchivedTaskSelection(selection, vi.fn())).toMatchObject({
        deleted: count,
        skipped: 0,
        failed: 0,
      });
      expect(rows.size).toBe(0);
      expect(source.deleteArchivedTasks).toHaveBeenCalledTimes(1);
      expect(source.deleteArchivedTask).not.toHaveBeenCalled();
      expect(source.listTasks).toHaveBeenCalledTimes(1);
      expect(source.listPinnedTasks).toHaveBeenCalledTimes(1);
      expect(source.listArchivedTasks).toHaveBeenCalledTimes(1);
    } finally {
      runtime.dispose();
    }
  });

  it("After successful batch persistence, list read failures must not be reported as delete failures", async () => {
    const workspacePath = "/isolated/probe";
    const { source, rows } = createSource(2);
    const onSourceError = vi.fn();
    const runtime = createWindowHostControllerRuntime({
      createId: () => "probe",
      onSourceError,
      resolveSource: () => ({
        scope: { kind: "local", workspacePath },
        sourceAvailability: "online",
        taskService: source as unknown as ICfTaskService,
      }),
    });
    try {
      const address = await runtime.resolveTaskAddress({ workspacePath, taskId: "task-0" });
      source.listTasks.mockRejectedValue(new Error("refresh failed"));
      expect(
        await runtime.service.deleteArchivedTasks({ address, taskIds: ["task-0", "task-1"] }),
      ).toEqual({ deletedTaskIds: ["task-0", "task-1"], skippedTaskIds: [], failedTaskIds: [] });
      expect(rows.size).toBe(0);
      expect(onSourceError).toHaveBeenCalledWith(expect.anything(), "refresh", expect.any(Error));
    } finally {
      runtime.dispose();
    }
  });

  it("Remote batches retain full address; writes forbidden for offline and replaced remoteSessionId", async () => {
    const workspacePath = "/isolated/probe";
    const workspaceIdentity = "remote:ssh:host:/isolated/probe";
    const { source } = createSource(2);
    let online = true;
    let remoteSessionId = "remote-1";
    const runtime = createWindowHostControllerRuntime({
      createId: () => "probe",
      resolveSource: () => ({
        scope: { kind: "remote", workspacePath, workspaceIdentity, remoteSessionId },
        sourceAvailability: online ? "online" : "offline",
        taskService: source as unknown as ICfTaskService,
      }),
    });
    try {
      const address = await runtime.resolveTaskAddress({
        workspacePath,
        workspaceIdentity,
        taskId: "task-0",
      });
      expect(await runtime.service.deleteArchivedTasks({ address, taskIds: ["task-0"] })).toEqual({
        deletedTaskIds: ["task-0"],
        skippedTaskIds: [],
        failedTaskIds: [],
      });
      expect(source.deleteArchivedTasks).toHaveBeenCalledExactlyOnceWith({
        workspacePath,
        workspaceIdentity,
        taskIds: ["task-0"],
      });
      online = false;
      await expect(
        runtime.service.deleteArchivedTasks({ address, taskIds: ["task-1"] }),
      ).rejects.toThrow("离线");
      online = true;
      remoteSessionId = "remote-2";
      await expect(
        runtime.service.deleteArchivedTasks({ address, taskIds: ["task-1"] }),
      ).rejects.toThrow();
      expect(source.deleteArchivedTasks).toHaveBeenCalledTimes(1);
    } finally {
      runtime.dispose();
    }
  });
});
