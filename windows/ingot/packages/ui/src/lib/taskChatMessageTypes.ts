import type {
  CfAssistantMessagePart,
  CfAssistantMessageFeedback,
  CfPromptAttachment,
  CfTimelineMeta,
  CfTaskSnapshotBodyRef,
  CfTaskSnapshotToolFieldRef,
  CfTaskSnapshotToolSlice,
} from "@origin-ai/cf-shared";

export interface TaskChatToolCall {
  toolId: string;
  
  parentToolUseId?: string | null;
  
  toolName?: string;
  kind: string;
  title?: string;
  input: unknown;
  status: string;
  
  content?: string;
  
  thought?: string;
  output?: unknown;
  error?: string;
  raw?: unknown;
  
  snapshotRefs?: CfTaskSnapshotToolFieldRef[];
  
  startedAt?: number;
}

export type TaskChatMessagePart = CfAssistantMessagePart;

export interface TaskModelChangeUiTimeline {
  type: "model_change";
  fromModelLabel: string;
  toModelLabel: string;
}

export type TaskUiTimelineMeta = TaskModelChangeUiTimeline;

export interface TaskChatMessage {
  id: string;
  
  protocolMessageId?: string;
  
  mergedMessageIds?: string[];
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  
  goalIteration?: number;
  
  streamGroupId?: string;
  mailboxMessage?: {
    content: string;
    createdAt?: string;
    fromSessionId: string;
    messageId: string;
  };
  
  durationMs?: number;
  
  interrupted?: boolean;
  
  feedback?: CfAssistantMessageFeedback;
  attachments?: CfPromptAttachment[];
  toolCalls?: TaskChatToolCall[];
  thought?: string;
  
  parts?: TaskChatMessagePart[];
  
  turnIndex?: number;
  
  bodyRefs?: CfTaskSnapshotBodyRef[];
  
  toolSlice?: CfTaskSnapshotToolSlice;
  
  streaming?: boolean;
  
  syntheticTimeline?: CfTimelineMeta;
  
  uiTimeline?: TaskUiTimelineMeta;
  
  turnSteer?: {
    status: "guided";
  };
}
