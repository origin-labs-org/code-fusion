import { useEffect, useRef } from "react";
import type { IPlatformService } from "@origin-ai/cf-shared";
import type { CfOffPeakTaskStatus } from "@origin-ai/cf-shared";
import type { IOffPeakTaskService } from "@origin-ai/cf-services";
import type { IntlInstance } from "@/i18n/index.js";
import { logger } from "@/logger.js";

const OFF_PEAK_NOTIFICATION_POLL_MS = 30_000;

function notifiableStatus(status: CfOffPeakTaskStatus): "completed" | "failed" | null {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  return null;
}

export function useOffPeakTaskNotifications(params: {
  offPeakTaskService: IOffPeakTaskService;
  platform: Pick<IPlatformService, "showTaskNotification"> | null | undefined;
  enabled: boolean;
  formatMessage: IntlInstance["formatMessage"];
}): void {
  const { offPeakTaskService, platform, enabled, formatMessage } = params;
  const seenStatusRef = useRef(new Map<string, CfOffPeakTaskStatus>());

  useEffect(() => {
    if (!enabled || !platform) return;
    let disposed = false;

    const tick = async () => {
      try {
        const tasks = await offPeakTaskService.list();
        if (disposed) return;
        const seen = seenStatusRef.current;
        const alive = new Set<string>();
        for (const task of tasks) {
          alive.add(task.offPeakTaskId);
          const previous = seen.get(task.offPeakTaskId);
          seen.set(task.offPeakTaskId, task.status);
          if (previous === task.status) continue;
          const kind = notifiableStatus(task.status);
          if (!kind) continue;
          if (previous === undefined) continue;
          const titleKey =
            kind === "completed" ? "offPeak.notify.completed.title" : "offPeak.notify.failed.title";
          const bodyKey =
            kind === "completed" ? "offPeak.notify.completed.body" : "offPeak.notify.failed.body";
          try {
            platform.showTaskNotification({
              taskId: task.sessionId ?? task.conversationId ?? task.offPeakTaskId,
              status: kind === "completed" ? "completed" : "failed",
              title: formatMessage({ id: titleKey }),
              body: formatMessage({ id: bodyKey }, { title: task.title || task.prompt }),
            });
          } catch (error) {
            logger.warn("[off-peak] notification dispatch failed", error);
          }
        }
        for (const id of seen.keys()) {
          if (!alive.has(id)) seen.delete(id);
        }
      } catch (error) {
        logger.warn("[off-peak] notification poll failed", error);
      }
    };

    void tick();
    const timer = setInterval(() => void tick(), OFF_PEAK_NOTIFICATION_POLL_MS);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [enabled, platform, offPeakTaskService, formatMessage]);
}
