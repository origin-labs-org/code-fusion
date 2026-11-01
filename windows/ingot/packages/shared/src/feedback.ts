export type FeedbackTicketType = "bug" | "usage" | "feature" | "performance";

export type FeedbackTicketStatus =
  | "Submitted"
  | "Insufficient Information"
  | "Accepted"
  | "Closed with Reply"
  | "Archived"
  | "Rejected"
  | "In Development"
  | "Resolved"
  | "Launched";

export type FeedbackAttachmentKind = "log" | "image" | "other";

export type FeedbackTicketModule =
  | "Plugin / MCP"
  | "Agent task execution failed"
  | "Model Configuration / API Key"
  | "Model Call Error"
  | "Permissions / Configuration Saving"
  | "SSH Connection Failed"
  | "WSL Connection Failed"
  | "UI Layout / Interaction"
  | "Slow Model Response / Quota"
  | "Crash / Internal Error"
  | "Documentation / Usage Inquiry"
  | "Other";

export type FeedbackTicketFramework = "cf-agent";

export const FEEDBACK_FRAMEWORK_NONE = "none" as const;
export type FeedbackTicketFrameworkSelectValue =
  | FeedbackTicketFramework
  | typeof FEEDBACK_FRAMEWORK_NONE;

export type FeedbackTicketSeverity = "P1-高" | "P2-中" | "P3-低";

export interface FeedbackReporter {
  user_id?: string;
  username?: string;
  display_name?: string;
}

export interface FeedbackDeviceInfo {
  appVersion?: string;
  buildCommitId?: string;
  buildTime?: string;
  electronVersion?: string;
  nodeVersion?: string;
  osType?: string;
  osPlatform?: string;
  osRelease?: string;
  osVersion?: string;
  osArch?: string;
  
  agentProvider?: string;
  
  agentFramework?: FeedbackTicketFramework;
  
  agentModel?: string;
  
  agentModelDisplay?: string;
  
  agentModelOptionCount?: number;
  
  agentModelOptionsPreview?: string[];
  hostname?: string;
  deviceMid?: string;
}

export interface CreateFeedbackTicketInput {
  title: string;
  description: string;
  type: FeedbackTicketType;
  severity?: FeedbackTicketSeverity;
  module?: FeedbackTicketModule;
  framework?: FeedbackTicketFramework;
  source?: string;
  reporter?: FeedbackReporter;
  device?: FeedbackDeviceInfo;
  
  contact?: string;
  
  locale?: "zh-CN" | "en-US";
}

export interface FeedbackTicketSummary {
  id: string;
  title: string;
  type: FeedbackTicketType;
  severity?: FeedbackTicketSeverity;
  module?: FeedbackTicketModule;
  status: FeedbackTicketStatus;
  assignee_id?: string | null;
  
  assignee_display?: string | null;
  
  reporter_display?: string | null;
  
  unread?: boolean;
  
  last_user_activity_at?: string | null;
  created_at: string;
  updated_at: string;
}

export type FeedbackTicketEventType =
  | "created"
  | "status_changed"
  | "assignee_changed"
  | "staff_replied"
  | "user_replied";

export interface FeedbackTicketEvent {
  id: number;
  type: FeedbackTicketEventType;
  summary: string;
  actor_display_name?: string | null;
  payload?: Record<string, unknown> | null;
  created_at: string;
}

export interface FeedbackAttachment {
  id: number;
  kind: FeedbackAttachmentKind;
  filename: string;
  size: number;
  sha256?: string | null;
  redacted: boolean;
  content_type?: string | null;
  download_url?: string | null;
  preview_url?: string | null;
  created_at: string;
}

export interface FeedbackCommentAttachment {
  id: number;
  filename: string;
  size: number;
  content_type?: string | null;
  download_url?: string | null;
  preview_url?: string | null;
}

export interface FeedbackComment {
  id: number;
  
  message_id?: string;
  author_user_id?: string | null;
  author_display_name?: string | null;
  body: string;
  attachments?: FeedbackCommentAttachment[];
  is_staff: boolean;
  created_at: string;
}

export interface FeedbackTicketDetail extends FeedbackTicketSummary {
  description: string;
  framework?: FeedbackTicketFramework;
  reporter?: FeedbackReporter | null;
  device?: FeedbackDeviceInfo | null;
  attachments: FeedbackAttachment[];
  comments: FeedbackComment[];
  events: FeedbackTicketEvent[];
  lark_record_id?: string | null;
}

export interface FeedbackListQuery {
  mine?: boolean;
  status?: FeedbackTicketStatus;
  type?: FeedbackTicketType;
  offset?: number;
  limit?: number;
}

export interface FeedbackListResult {
  items: FeedbackTicketSummary[];
  total: number;
}

export const FEEDBACK_TICKET_MODULES: FeedbackTicketModule[] = [
  "Plugin / MCP",
  "Agent task execution failed",
  "Model Configuration / API Key",
  "Model Call Error",
  "Permissions / Configuration Saving",
  "SSH Connection Failed",
  "WSL Connection Failed",
  "UI Layout / Interaction",
  "Slow Model Response / Quota",
  "Crash / Internal Error",
  "Documentation / Usage Inquiry",
  "Other",
];

export const FEEDBACK_TICKET_TYPES: { value: FeedbackTicketType; label: string }[] = [
  { value: "bug", label: "Bug 反馈" },
  { value: "usage", label: "使用问题" },
  { value: "feature", label: "功能建议" },
  { value: "performance", label: "性能问题" },
];

export const FEEDBACK_TICKET_SEVERITIES: FeedbackTicketSeverity[] = ["P1-高", "P2-中", "P3-低"];

export const DEFAULT_FEEDBACK_TICKET_FRAMEWORK: FeedbackTicketFramework = "cf-agent";

export const FEEDBACK_TICKET_FRAMEWORK_OPTIONS: {
  value: FeedbackTicketFramework;
  label: string;
}[] = [{ value: "cf-agent", label: "CodeFusion Agent" }];

export const FEEDBACK_TICKET_FRAMEWORKS: {
  value: FeedbackTicketFrameworkSelectValue;
  label: string;
}[] = [{ value: FEEDBACK_FRAMEWORK_NONE, label: "未指定" }, ...FEEDBACK_TICKET_FRAMEWORK_OPTIONS];
