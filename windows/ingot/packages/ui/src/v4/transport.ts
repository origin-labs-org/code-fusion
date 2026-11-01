import type {
  CommandAck,
  CommandEnvelope,
  CommandsQueryParams,
  CommandsQueryResult,
  ConversationRowTarget,
  ConversationTopicFrame,
  TopicFrameDeliveryKind,
  SubscribeParams,
  V4AttachmentPutParams,
  V4AttachmentPutResult,
  V4ConversationFileChangesParams,
  V4ConversationFileChangesResult,
  V4ConversationFileRewindPreviewParams,
  V4ConversationFileRewindPreviewResult,
  V4ConversationPlansParams,
  V4ConversationPlansResult,
  V4ConversationRowsRangeParams,
  V4ConversationRowsRangeResult,
  V4ConversationWorkflowRunArtifactDataParams,
  V4ConversationWorkflowRunArtifactDataResult,
  V4ConversationWorkflowRunArtifactReadParams,
  V4ConversationWorkflowRunArtifactReadResult,
  V4ConversationWorkflowRunArtifactsParams,
  V4ConversationWorkflowRunArtifactsResult,
  V4ConversationWorkflowRunNodeResultParams,
  V4ConversationWorkflowRunNodeResultResult,
  V4ConversationWorkflowRunWorkspaceParams,
  V4ConversationWorkflowRunWorkspaceResult,
  V4ConversationWorkflowRunEventsParams,
  V4ConversationWorkflowRunsParams,
  V4ConversationWorkflowRunEventsResult,
  V4ConversationWorkflowRunsResult,
  ConversationResyncParams,
  V4ConversationResyncResult,
  V4ConversationSubscribeResult,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import type { AttachmentUploadOptions } from "@/v4/attachmentUploadTransaction.js";

export interface ConversationTransport {
  
  subscribe(params: SubscribeParams): Promise<V4ConversationSubscribeResult>;
  
  activate(subscriptionId: string): void;
  
  resync(params: ConversationResyncParams): Promise<V4ConversationResyncResult>;
  /** v4/conversation/unsubscribe。 */
  unsubscribe(subscriptionId: string): Promise<void>;
  
  sendCommand(
    envelope: CommandEnvelope,
    context?: { projectId?: string | null },
  ): Promise<CommandAck>;
  
  queryCommands(params: CommandsQueryParams): Promise<CommandsQueryResult>;
  
  rowsRange(params: V4ConversationRowsRangeParams): Promise<V4ConversationRowsRangeResult>;
  
  plans(params: V4ConversationPlansParams): Promise<V4ConversationPlansResult>;
  
  workflowRunEvents(
    params: V4ConversationWorkflowRunEventsParams,
  ): Promise<V4ConversationWorkflowRunEventsResult>;
  
  workflowRuns(params: V4ConversationWorkflowRunsParams): Promise<V4ConversationWorkflowRunsResult>;
  
  workflowRunArtifacts(
    params: V4ConversationWorkflowRunArtifactsParams,
  ): Promise<V4ConversationWorkflowRunArtifactsResult>;
  
  workflowRunArtifactData(
    params: V4ConversationWorkflowRunArtifactDataParams,
  ): Promise<V4ConversationWorkflowRunArtifactDataResult>;
  
  workflowRunArtifactRead(
    params: V4ConversationWorkflowRunArtifactReadParams,
  ): Promise<V4ConversationWorkflowRunArtifactReadResult>;
  
  workflowRunWorkspace(
    params: V4ConversationWorkflowRunWorkspaceParams,
  ): Promise<V4ConversationWorkflowRunWorkspaceResult>;
  
  workflowRunNodeResult(
    params: V4ConversationWorkflowRunNodeResultParams,
  ): Promise<V4ConversationWorkflowRunNodeResultResult>;
  
  fileChanges(params: V4ConversationFileChangesParams): Promise<V4ConversationFileChangesResult>;
  
  fileRewindPreview(
    params: V4ConversationFileRewindPreviewParams,
  ): Promise<V4ConversationFileRewindPreviewResult>;
  
  attachmentPut(
    params: V4AttachmentPutParams,
    options?: AttachmentUploadOptions,
  ): Promise<V4AttachmentPutResult>;
  
  attachmentRead(
    params: ConversationAttachmentReadParams,
  ): Promise<{ bytes: Uint8Array; mediaType: string } | { url: string; mediaType: string }>;
  
  attachmentReadRange(
    params: ConversationAttachmentReadParams & { offset: number; limit: number },
  ): Promise<{
    bytes: Uint8Array;
    mediaType: string;
    totalBytes: number;
    nextOffset: number | null;
  }>;
  
  onFrame(
    listener: (
      frame: ConversationTopicFrame,
      context?: { deliveryKind: TopicFrameDeliveryKind },
    ) => void,
  ): () => void;
  
  onAssemblyFault(
    listener: (fault: {
      topic: string;
      subscriptionId: string;
      reasonCode?: string;
      deliveryKind?: TopicFrameDeliveryKind;
    }) => void,
  ): () => void;
  
  onRuntimeRestart(listener: (reason?: "runtimeRestart" | "transportReplaced") => void): () => void;
  
  onRuntimeLifecycle?(listener: (state: "available" | "unavailable") => void): () => void;
}

export interface ConversationAttachmentReadParams {
  sessionId: string;
  ref: string;
  
  mediaType?: string;
  
  target?: ConversationRowTarget;
  attachmentIndex?: number;
  
  signal?: AbortSignal;
}

export { conversationTopic } from "@origin-ai/cf-shared/cf-protocol-v4";
