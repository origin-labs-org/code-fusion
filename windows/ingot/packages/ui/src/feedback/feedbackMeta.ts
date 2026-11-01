import type {
  FeedbackTicketModule,
  FeedbackTicketSeverity,
  FeedbackTicketStatus,
  FeedbackTicketType,
} from "@origin-ai/cf-shared";
import type { ComponentType, SVGProps } from "react";
import {
  FeedbackBugIcon,
  FeedbackIdeaIcon,
  FeedbackPerformanceIcon,
  FeedbackQuestionIcon,
} from "@/feedback/feedbackIcons.js";

interface TypeMeta {
  value: FeedbackTicketType;
  label: string;
  description: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  
  iconText: string;
}

type MessageFormatter = (
  descriptor: { id: string },
  values?: Record<string, string>,
) => string;

export const FEEDBACK_TYPE_META: TypeMeta[] = [
  {
    value: "bug",
    label: "遇到 Bug",
    description: "报错、崩溃、功能不符合预期",
    Icon: FeedbackBugIcon,
    iconText: "text-rose-500 dark:text-rose-400",
  },
  {
    value: "usage",
    label: "不会使用",
    description: "操作不清楚、配置不确定",
    Icon: FeedbackQuestionIcon,
    iconText: "text-sky-500 dark:text-sky-400",
  },
  {
    value: "feature",
    label: "想提建议",
    description: "希望支持的新能力或体验优化",
    Icon: FeedbackIdeaIcon,
    iconText: "text-amber-500 dark:text-amber-400",
  },
  {
    value: "performance",
    label: "运行很慢",
    description: "卡顿、响应慢、资源占用异常",
    Icon: FeedbackPerformanceIcon,
    iconText: "text-violet-500 dark:text-violet-400",
  },
];
export const SEVERITY_META: {
  value: FeedbackTicketSeverity;
  label: string;
  hint: string;
  dot: string;
}[] = [
  { value: "P1-高", label: "完全用不了", hint: "P1", dot: "bg-rose-500" },
  { value: "P2-中", label: "影响使用", hint: "P2", dot: "bg-amber-500" },
  { value: "P3-低", label: "小问题/建议", hint: "P3", dot: "bg-emerald-500" },
];

interface StatusMeta {
  className: string;
  dot: string;
}

export const STATUS_META: Record<FeedbackTicketStatus, StatusMeta> = {
  Submitted: {
    className: "text-amber-700 dark:text-amber-300",
    dot: "bg-amber-500",
  },
  "Insufficient Information": {
    className: "text-orange-700 dark:text-orange-300",
    dot: "bg-orange-500",
  },
  Accepted: {
    className: "text-sky-700 dark:text-sky-300",
    dot: "bg-sky-500",
  },
  "Closed with Reply": {
    className: "text-emerald-700 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
  Archived: {
    className: "text-emerald-700 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
  Rejected: {
    className: "text-foreground-subtle",
    dot: "bg-foreground-subtlest",
  },
  "In Development": {
    className: "text-violet-700 dark:text-violet-300",
    dot: "bg-violet-500",
  },
  Resolved: {
    className: "text-emerald-700 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
  Launched: {
    className: "text-emerald-700 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
};

export const SEVERITY_BADGE: Record<
  FeedbackTicketSeverity,
  { label: string; className: string }
> = {
  "P1-高": {
    label: "P1",
    className: "text-rose-600 dark:text-rose-400 border-rose-500/40",
  },
  "P2-中": {
    label: "P2",
    className: "text-amber-600 dark:text-amber-400 border-amber-500/40",
  },
  "P3-低": {
    label: "P3",
    className: "text-emerald-600 dark:text-emerald-400 border-emerald-500/40",
  },
};

export const FEEDBACK_MODULE_MESSAGE_IDS: Record<FeedbackTicketModule, string> = {
  "Plugin / MCP": "feedback.module.pluginMcp",
  "Agent task execution failed": "feedback.module.agentTaskFailed",
  "Model Configuration / API Key": "feedback.module.modelConfigApiKey",
  "Model Call Error": "feedback.module.modelCallError",
  "Permissions / Configuration Saving": "feedback.module.permissionConfigSave",
  "SSH Connection Failed": "feedback.module.sshConnectionFailed",
  "WSL Connection Failed": "feedback.module.wslConnectionFailed",
  "UI Layout / Interaction": "feedback.module.uiLayoutInteraction",
  "Slow Model Response / Quota": "feedback.module.modelSlowQuota",
  "Crash / Internal Error": "feedback.module.crashInternalError",
  "Documentation / Usage Inquiry": "feedback.module.docsUsage",
  Other: "feedback.module.other",
};

export const FEEDBACK_STATUS_MESSAGE_IDS: Record<FeedbackTicketStatus, string> = {
  Submitted: "feedback.status.pendingReview",
  "Insufficient Information": "feedback.status.needInfo",
  Accepted: "feedback.status.accepted",
  "Closed with Reply": "feedback.status.closedByReply",
  Archived: "feedback.status.completed",
  Rejected: "feedback.status.rejected",
  "In Development": "feedback.status.inDevelopment",
  Resolved: "feedback.status.resolved",
  Launched: "feedback.status.released",
};

export function formatFeedbackModuleLabel(
  module: FeedbackTicketModule,
  formatMessage: MessageFormatter,
) {
  return formatMessage({ id: FEEDBACK_MODULE_MESSAGE_IDS[module] });
}

export function formatFeedbackStatusLabel(
  status: FeedbackTicketStatus,
  formatMessage: MessageFormatter,
) {
  return formatMessage({ id: FEEDBACK_STATUS_MESSAGE_IDS[status] });
}
