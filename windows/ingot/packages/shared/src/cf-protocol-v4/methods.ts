/**
 * V4 protocol method names.
 *
 * The literal values are the wire contract between the host and clients; tests pin the
 * ones that already shipped. Keep every entry in `v4/<area>/<operation>` form.
 */
export const V4_METHODS = {
  attachmentAbort: "v4/attachment/abort",
  attachmentBegin: "v4/attachment/begin",
  attachmentChunk: "v4/attachment/chunk",
  attachmentCommit: "v4/attachment/commit",
  attachmentPreviewSource: "v4/attachment/previewSource",
  attachmentRead: "v4/attachment/read",
  backgroundBashOutput: "v4/background/bashOutput",
  command: "v4/command",
  commandsQuery: "v4/commands/query",
  connectionFlow: "v4/connection/flow",
  controllerResync: "v4/controller/resync",
  controllerSubscribe: "v4/controller/subscribe",
  controllerUnsubscribe: "v4/controller/unsubscribe",
  conversationAttachmentRead: "v4/conversation/attachmentRead",
  conversationAttachmentStat: "v4/conversation/attachmentStat",
  conversationFileChanges: "v4/conversation/fileChanges",
  conversationFileRewindPreview: "v4/conversation/fileRewindPreview",
  conversationPlans: "v4/conversation/plans",
  conversationResync: "v4/conversation/resync",
  conversationRowsRange: "v4/conversation/rowsRange",
  conversationSubscribe: "v4/conversation/subscribe",
  conversationUnsubscribe: "v4/conversation/unsubscribe",
  conversationUsage: "v4/conversation/usage",
  conversationWorkflowRunArtifactData: "v4/conversation/workflowRunArtifactData",
  conversationWorkflowRunArtifactRead: "v4/conversation/workflowRunArtifactRead",
  conversationWorkflowRunArtifacts: "v4/conversation/workflowRunArtifacts",
  conversationWorkflowRunEvents: "v4/conversation/workflowRunEvents",
  conversationWorkflowRunNodeResult: "v4/conversation/workflowRunNodeResult",
  conversationWorkflowRuns: "v4/conversation/workflowRuns",
  conversationWorkflowRunWorkspace: "v4/conversation/workflowRunWorkspace",
  offPeakControl: "v4/offPeak/control",
  sessionsIndexReconcile: "v4/sessionsIndex/reconcile",
  usageStats: "v4/usage/stats",
} as const;

export type V4Method = (typeof V4_METHODS)[keyof typeof V4_METHODS];
