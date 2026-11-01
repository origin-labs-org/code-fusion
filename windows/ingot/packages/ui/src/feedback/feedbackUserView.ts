import type { FeedbackComment, FeedbackTicketStatus } from "@origin-ai/cf-shared";

type MessageFormatter = (
  descriptor: { id: string },
  values?: Record<string, string>,
) => string;

const TOP_DESCRIPTION_SECTIONS = new Set([
  "结构化反馈",
  "开发复现信息",
  "用户原始描述",
]);
const REPRO_DESCRIPTION_SECTIONS = new Set([
  "问题概述",
  "复现步骤",
  "期望结果",
  "实际结果",
  "报错信息",
  "补充线索",
]);

const SYSTEM_COMMENT_PREFIX = "系统提示：";

export const STATUS_USER_HINT: Record<FeedbackTicketStatus, string> = {
  Submitted: "我们已收到，会尽快处理。",
  "Insufficient Information":
    "Additional information is needed; please see the official reply below.",
  Accepted: "Your feedback has been accepted, and we will schedule fixes or improvements.",
  "Closed with Reply":
    "The product manager has replied and closed this feedback. You can resubmit if the issue persists.",
  Archived:
    "The product manager has replied and closed this feedback. You can resubmit if the issue persists.",
  Rejected:
    "This feedback is not currently being processed. Please refer to the explanation below for details.",
  "In Development": "In progress. Any updates will be shared in the reply below.",
  Resolved: "The issue has been resolved and is awaiting release.",
  Launched: "The relevant fixes or improvements are live. Thank you for your feedback.",
};

export const STATUS_USER_HINT_MESSAGE_IDS: Record<FeedbackTicketStatus, string> = {
  Submitted: "feedback.statusHint.pendingReview",
  "Insufficient Information": "feedback.statusHint.needInfo",
  Accepted: "feedback.statusHint.accepted",
  "Closed with Reply": "feedback.statusHint.closedByReply",
  Archived: "feedback.statusHint.archived",
  Rejected: "feedback.statusHint.rejected",
  "In Development": "feedback.statusHint.inDevelopment",
  Resolved: "feedback.statusHint.resolved",
  Launched: "feedback.statusHint.released",
};

export function formatFeedbackStatusHint(
  status: FeedbackTicketStatus,
  formatMessage: MessageFormatter,
) {
  return formatMessage({ id: STATUS_USER_HINT_MESSAGE_IDS[status] });
}

export function formatRelativeTime(iso: string, formatMessage: MessageFormatter) {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return "";
  const diff = Date.now() - ts;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return formatMessage({ id: "feedback.time.justNow" });
  if (diff < hour) {
    return formatMessage(
      { id: "feedback.time.minutesAgo" },
      { count: String(Math.floor(diff / minute)) },
    );
  }
  if (diff < day) {
    return formatMessage(
      { id: "feedback.time.hoursAgo" },
      { count: String(Math.floor(diff / hour)) },
    );
  }
  if (diff < 7 * day) {
    return formatMessage(
      { id: "feedback.time.daysAgo" },
      { count: String(Math.floor(diff / day)) },
    );
  }
  return new Date(iso).toLocaleDateString();
}

export function formatSubmittedAt(iso: string, formatMessage: MessageFormatter) {
  const relative = formatRelativeTime(iso, formatMessage);
  if (!relative) return "";
  return formatMessage({ id: "feedback.time.submittedAt" }, { time: relative });
}

function isSystemComment(body: string) {
  return body.trimStart().startsWith(SYSTEM_COMMENT_PREFIX);
}

export function filterUserVisibleComments(comments: FeedbackComment[]) {
  return comments.filter((item) => !isSystemComment(item.body));
}

export function getUserFacingDescription(description: string) {
  const parsed = parseTicketDescription(description);
  if (parsed.raw) return parsed.raw.trim();
  if (parsed.reproOverview) return parsed.reproOverview.trim();
  const trimmed = description.trim();
  if (!trimmed || looksLikeStructuredTicketDescription(trimmed)) {
    return "";
  }
  return trimmed;
}

function parseTicketDescription(description: string) {
  const topSections = splitSections(description, TOP_DESCRIPTION_SECTIONS);
  const reproBody =
    topSections.find((item) => item.title === "Reproduction Details")?.body ?? null;
  const reproOverview = reproBody
    ? splitSections(reproBody, REPRO_DESCRIPTION_SECTIONS).find(
        (item) => item.title === "Issue Summary",
      )?.body ?? null
    : null;
  return {
    raw: topSections.find((item) => item.title === "Original User Description")?.body ?? null,
    reproOverview,
  };
}

function looksLikeStructuredTicketDescription(description: string) {
  return (
    description.includes("Structured Feedback") ||
    description.includes("Reproduction Details") ||
    description.includes("Organization method:")
  );
}

function splitSections(raw: string, headings: Set<string>) {
  const sections: { title: string; lines: string[] }[] = [];
  let current: { title: string; lines: string[] } | null = null;
  for (const line of raw.split(/\r?\n/)) {
    const title = line.trim();
    if (headings.has(title)) {
      if (current) sections.push(current);
      current = { title, lines: [] };
      continue;
    }
    if (!current) current = { title: "Content", lines: [] };
    current.lines.push(line);
  }
  if (current) sections.push(current);
  return sections
    .map((section) => ({ title: section.title, body: section.lines.join("\n").trim() }))
    .filter((section) => section.body || section.title !== "Content");
}
