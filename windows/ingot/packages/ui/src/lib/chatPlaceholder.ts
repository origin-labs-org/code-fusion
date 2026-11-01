import type { CfTaskRuntimeStatus } from "@origin-ai/cf-shared";

type ChatPlaceholderMessageKey =
  | "chat.placeholder.newTask"
  | "chat.placeholder.newTaskMobile"
  | "chat.placeholder.followUpAsk"
  | "chat.placeholder.followUpQueue";

export function resolveChatPlaceholderKey(options: {
  hasHistoryMessages: boolean;
  isTaskProcessing: boolean;
  compactNewTask?: boolean;
}): ChatPlaceholderMessageKey {
  const { compactNewTask = false, hasHistoryMessages, isTaskProcessing } = options;

  if (!hasHistoryMessages) {
    return compactNewTask ? "chat.placeholder.newTaskMobile" : "chat.placeholder.newTask";
  }

  return isTaskProcessing
    ? "chat.placeholder.followUpQueue"
    : "chat.placeholder.followUpAsk";
}

export function shouldDeferChatPlaceholder(options: {
  hasBoundTask: boolean;
  taskStatus: CfTaskRuntimeStatus;
}): boolean {
  const { hasBoundTask, taskStatus } = options;

  return hasBoundTask && (taskStatus === "creating" || taskStatus === "restoring");
}
