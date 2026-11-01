import type { CfTaskMeta } from "@origin-ai/cf-shared";
import type {
  PendingInteractionSummary,
  SessionSummary,
  SessionWorkflowActivity,
} from "@origin-ai/cf-shared/cf-protocol-v4";

export const TASK_LIST_ROW_ACTIVITY_FIELD = "__cfSessionActivity" as const;

export interface TaskListRowActivity {
  phase: SessionSummary["phase"];
  lastActivityAt: number;
  hasBackgroundWork: boolean;
  pendingInteractions?: PendingInteractionSummary;
  
  workflowActivity?: SessionWorkflowActivity;
}

export type TaskListMetaWithActivity = CfTaskMeta & {
  [TASK_LIST_ROW_ACTIVITY_FIELD]: TaskListRowActivity;
};

export function attachTaskListRowActivity<T extends CfTaskMeta>(
  task: T,
  activity: TaskListRowActivity,
): T & TaskListMetaWithActivity {
  return {
    ...task,
    [TASK_LIST_ROW_ACTIVITY_FIELD]: activity,
  };
}

export function getTaskListRowActivity(task: CfTaskMeta): TaskListRowActivity | null {
  const activity = (task as Partial<TaskListMetaWithActivity>)[TASK_LIST_ROW_ACTIVITY_FIELD];
  return activity ?? null;
}

export function isTaskListRowRunning(task: CfTaskMeta): boolean {
  const phase = getTaskListRowActivity(task)?.phase;
  return phase === "prewarming" || phase === "running";
}

export function isTaskListRowActive(task: CfTaskMeta): boolean {
  return isTaskListRowRunning(task) || getTaskListRowActivity(task)?.hasBackgroundWork === true;
}

export function getTaskListAttention(
  task: CfTaskMeta,
): { kind: "permission" | "userInput"; count: number } | null {
  const summary = getTaskListRowActivity(task)?.pendingInteractions;
  if (!summary) {
    return null;
  }
  const count = summary.permissionCount + summary.userInputCount;
  if (count === 0) {
    return null;
  }
  return {
    kind: summary.userInputCount > 0 ? "userInput" : "permission",
    count,
  };
}

export function mergeTaskListMembershipFields(
  activityTask: CfTaskMeta,
  membershipTask: CfTaskMeta,
): CfTaskMeta {
  const activity = getTaskListRowActivity(activityTask);
  if (!activity) {
    return membershipTask;
  }
  const membershipOwnsUnreadAt = Object.prototype.hasOwnProperty.call(membershipTask, "unreadAt");
  return attachTaskListRowActivity(
    {
      ...activityTask,
      ...membershipTask,
      createdAt: activityTask.createdAt,
      updatedAt: activity.lastActivityAt,
      status: activityTask.status,
      unreadAt: membershipOwnsUnreadAt ? membershipTask.unreadAt : activityTask.unreadAt,
    },
    activity,
  );
}
