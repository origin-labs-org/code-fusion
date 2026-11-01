import { redactFeedbackText } from "@origin-ai/cf-shared";
import type { FeedbackAgentModelContext } from "@/feedback/feedbackSubmitModelContext.js";
import type {
  FeedbackTicketModule,
  FeedbackTicketSeverity,
  FeedbackTicketType,
} from "@origin-ai/cf-shared";

const TITLE_MAX = 80;
const FEEDBACK_CF_AGENT_LABEL = "CodeFusion Agent";

type MessageFormatter = (descriptor: { id: string }, values?: Record<string, string>) => string;

export function buildFeedbackTitle(description: string, formatMessage: MessageFormatter): string {
  const normalized =
    description
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? description.replace(/\s+/g, " ").trim();
  return normalized.slice(0, TITLE_MAX) || formatMessage({ id: "feedback.title.fallback" });
}

export function buildDeveloperFacingDescription({
  raw,
  modelContext,
  ticketType = "bug",
  ticketModule = "Other",
  ticketSeverity = "P2-中",
  formatMessage,
}: {
  raw: string;
  modelContext: FeedbackAgentModelContext;
  ticketType?: FeedbackTicketType;
  ticketModule?: FeedbackTicketModule;
  ticketSeverity?: FeedbackTicketSeverity;
  formatMessage: MessageFormatter;
}): string {
  const notReported = formatMessage({ id: "feedback.submit.notReported" });
  return [
    "原始反馈",
    "",
    `Feedback type: ${ticketType}`,
    `产品模块: ${ticketModule}`,
    `严重程度: ${ticketSeverity}`,
    "Agent 框架: cf-agent",
    `Current Agent: ${FEEDBACK_CF_AGENT_LABEL}`,
    `Current model: ${redactFeedbackText(modelContext.display || modelContext.model || notReported)}`,
    "处理方式: 用户提交轻量表单，客户端自动补齐上下文，后端可异步生成 AI 分析",
    "",
    "用户原始描述",
    raw.trim(),
  ].join("\n");
}
