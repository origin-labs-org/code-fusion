import type { AutoArchiveInput, ProjectRepositoryContract } from "#src/project-storage/contract.js";
import type { ProjectTaskRef } from "#src/project/contract.js";
import { createServiceLogger } from "#src/logger/serviceLogger.js";

export const TASK_AUTO_ARCHIVE_SCAN_INTERVAL_MS = 5 * 60 * 1000;

const TASK_AUTO_ARCHIVE_SETTING_KEYS: ReadonlySet<string> = new Set([
  "taskAutoArchiveEnabled",
  "taskAutoArchiveOlderThanDays",
]);

export function shouldRescanTaskAutoArchive(keys: readonly string[]): boolean {
  return keys.some((key) => TASK_AUTO_ARCHIVE_SETTING_KEYS.has(key));
}

export interface TaskAutoArchiveSchedulerOptions {
  
  readPolicy(): Promise<AutoArchiveInput | null>;
  repository(): Promise<Pick<ProjectRepositoryContract, "archiveInactive">>;
  
  afterChange(): Promise<void>;
  intervalMs?: number;
}

export interface TaskAutoArchiveScheduler {
  
  start(): void;
  
  scan(): Promise<ProjectTaskRef[]>;
  dispose(): void;
}

export function createTaskAutoArchiveScheduler(
  options: TaskAutoArchiveSchedulerOptions,
): TaskAutoArchiveScheduler {
  const log = createServiceLogger("task-auto-archive");
  const intervalMs = options.intervalMs ?? TASK_AUTO_ARCHIVE_SCAN_INTERVAL_MS;
  let timer: ReturnType<typeof setInterval> | null = null;
  let disposed = false;
  let running: Promise<ProjectTaskRef[]> | null = null;
  let queued: Promise<ProjectTaskRef[]> | null = null;

  const runOnce = async (): Promise<ProjectTaskRef[]> => {
    const policy = await options.readPolicy();
    if (!policy || disposed) return [];
    const archived = (await options.repository()).archiveInactive(policy);
    if (archived.length === 0) return archived;
    log.info(undefined, `AutoArchive ${archived.length} 条Task`, {
      cutoff: policy.cutoff,
      taskIds: archived.map((task) => task.taskId),
    });
    await options.afterChange();
    return archived;
  };

  const scan = (): Promise<ProjectTaskRef[]> => {
    if (disposed) return Promise.resolve([]);
    if (!running) {
      running = runOnce().finally(() => {
        running = null;
      });
      return running;
    }
    queued ??= running
      .catch(() => [])
      .then(() => {
        queued = null;
        return scan();
      });
    return queued;
  };

  const scanInBackground = () => {
    void scan().catch((error) => {
      log.warn(undefined, "自动归档扫描失败，等待下一轮", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };

  return {
    start() {
      if (timer || disposed) return;
      scanInBackground();
      timer = setInterval(scanInBackground, intervalMs);
      timer.unref?.();
    },
    scan,
    dispose() {
      disposed = true;
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
