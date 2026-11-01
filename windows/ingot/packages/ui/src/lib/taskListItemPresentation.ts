import type { CfTaskMeta } from "@origin-ai/cf-shared";
import type { TaskListRowActivity } from "@/v4/taskListRowActivity.js";

export function deriveTaskLeadingIndicator(
  task: CfTaskMeta,
  activity: TaskListRowActivity | null,
): "error" | "unread" | "loading" | "none" {
  if (activity?.phase === "error") {
    return "error";
  }

  if (!activity && task.status === "error") {
    return "error";
  }

  if (typeof task.unreadAt === "number") {
    return "unread";
  }

  if (activity?.phase === "prewarming" || activity?.phase === "running") {
    return "loading";
  }

  return "none";
}

export function formatTaskRelativeTime(
  timestamp: number,
  intl: {
    formatMessage: (desc: { id: string }, values?: Record<string, string>) => string;
  },
): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return intl.formatMessage({ id: "taskList.justNow" });
  if (minutes < 60) {
    return intl.formatMessage({ id: "taskList.minutesAgo" }, { minutes: String(minutes) });
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return intl.formatMessage({ id: "taskList.hoursAgo" }, { hours: String(hours) });
  }

  const days = Math.floor(hours / 24);
  return intl.formatMessage({ id: "taskList.daysAgo" }, { days: String(days) });
}
