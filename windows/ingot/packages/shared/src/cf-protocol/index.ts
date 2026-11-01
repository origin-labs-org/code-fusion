import { requestVerificationReasons } from "../request-security-edition/verification-policy.js";
import { cfProtocolTraceSchema } from "./trace.js";
export { channelReplyRequestSchema, channelReplyResultSchema } from "../channel-mention.js";
export { cfProtocolTraceSchema, type CfProtocolTrace } from "./trace.js";
import {
  databaseMigrationFactsSchema,
  databaseStartupErrorCodeSchema,
  databaseStartupErrorDetailsSchema,
} from "../database-startup.js";
import {
  MCP_APPS_APP_TOOLS_MAX_PER_INSTANCE,
  MCP_APPS_APP_TOOL_CALL_ID_MAX_CHARS,
  MCP_APPS_APP_TOOL_ERROR_MESSAGE_MAX_CHARS,
  mcpAppsAppToolCallResultSchema,
  mcpAppsAppToolDescriptorSchema,
} from "../mcp-apps/appTools.js";
import { mcpAppsSamplingParamsSchema, mcpAppsSamplingResultSchema } from "../mcp-apps/sampling.js";
import { mcpAppInstanceSchema } from "../mcp-apps/instance.js";
export { conversationQuoteSchema, conversationQuotesSchema } from "../conversationSelection.js";

// session/rewindCascade、session/previewFileRewind、session/applyFileRewind、
import { z } from "zod";
import { accountProviderUnavailableReasonSchema } from "../account-provider-state.js";
import { bashOutputDisplaySchema } from "../bash-output-display.js";
import { cfAutomationBotDeliveryTargetSchema } from "../bots.js";
import { executionOutputPreviewSchema } from "../execution-output-preview.js";
import { completeModelPropertiesDataSchema } from "../model-config.js";
import { modelExecutionSchema } from "../model-execution.js";
export type { ModelExecutionSelectionFallback } from "../model-execution.js";
export * from "../off-peak-execution.js";
import { modelSelectionSchema } from "../model-selection.js";
import { APP_USAGE_RANGES, appUsageSnapshotSchema } from "../usage-stats.js";
import { DYNAMIC_WORKFLOW_MODES } from "../dynamic-workflow-feature.js";
import { errorAttributionSchema } from "../cf-protocol-v4/snapshot.js";
export * from "../background-bash-output.js";
export * from "../process-diagnostic.js";
export { attachmentSourceKindSchema, type AttachmentSourceKind } from "../attachment-source.js";
import { PROTOCOL_V4_LIMITS } from "../cf-protocol-v4/core.js";

export const cfTopicResourceReadParamsSchema = z
  .object({
    requestId: z.string().min(1).max(256),
    taskId: z.string().min(1).max(256),
    inputId: z.string().min(1).max(256),
    authorizationId: z.string().min(1).max(256),
    messageId: z.string().min(1).max(256),
    resourceIndex: z.number().int().nonnegative(),
  })
  .strict();
export const cfTopicResourceReadResultSchema = z
  .object({
    ref: z.string().min(1),
    fileName: z.string().min(1).max(1024),
    mime: z.string().min(1).max(256),
    bytes: z.number().int().min(0).max(PROTOCOL_V4_LIMITS.attachmentMaxBytes),
  })
  .strict();
export const cfTopicResourceCancelParamsSchema = z
  .object({ requestId: z.string().min(1).max(256), taskId: z.string().min(1).max(256) })
  .strict();
export const cfTopicResourceCancelResultSchema = z.object({ cancelled: z.boolean() }).strict();
export type CfTopicResourceReadParams = z.infer<typeof cfTopicResourceReadParamsSchema>;
export type CfTopicResourceReadResult = z.infer<typeof cfTopicResourceReadResultSchema>;
export { activeWorkSummarySchema, type ActiveWorkSummary } from "../cf-protocol-v4/snapshot.js";
import {
  browserBackendListResultSchema,
  browserSessionContextKindSchema,
} from "../browser-use/backend.js";
import { browserClientModeSchema, browserCommandSchema } from "../browser-use/commands.js";
import { browserCommandResultSchema } from "../browser-use/result.js";
import { appToolSearchModeSchema } from "../app-runtime-preferences.js";
import { integratedTerminalShellSelectionSchema } from "../validationAppSettings.js";
import { cfTaskModeSchema } from "../cf-task-mode-schema.js";
import { OFFICIAL_MCP_AUTH_PORT_FAILURE_REASONS } from "../official-mcp-auth.js";
import {
  cfSyntheticUserMessageSourceSchema as legacyCfSyntheticUserMessageSourceSchema,
  cfDeliveryKindSchema,
  cfInteractionRequestOriginSchema,
  cfMessagePartSchema,
  cfMessageVisibilitySchema,
  cfMessageWithPartsSchema,
  cfPermissionDecisionSchema,
  cfPermissionResponseSchema,
  cfPermissionUpdateSchema,
  cfSessionApiRetryStatusSchema,
  cfSessionContextUsageSchema,
  cfSessionGoalSchema,
  cfSessionGoalVerificationSchema,
  cfSessionGoalVerificationTimelineSchema,
  cfSessionInfoSchema,
  cfSessionKindSchema,
  cfSessionModeSchema,
  cfSessionRuntimeStateSchema,
  cfSessionStatusSchema,
  cfToolStateSchema,
  cfWorkspaceRefSchema,
} from "../cf-protocol-legacy-types.js";

export * from "../localTtft.js";
export {
  hookExecutionProjectionSchema,
  hookInvocationRowSchema,
  type HookExecutionProjection,
  type HookInvocationRow,
} from "../cf-protocol-v4/rows.js";

export {
  sessionsIndexReconcileParamsSchema,
  sessionsIndexReconcileResultSchema,
  type SessionsIndexReconcileParams,
  type SessionsIndexReconcileResult,
} from "../cf-protocol-v4/sessions-index.js";

export const CF_PROTOCOL_NAME = "CodeFusion Protocol" as const;
export const CF_PROTOCOL_VERSION = 1 as const;
export const CF_PROTOCOL_V4_WIRE_VERSION = 3 as const;
export const cfRuntimeCapabilitiesSchema = z.object({
  historyFirst: z.boolean().optional(),
  independentPlanState: z.boolean().optional(),
});
export const cfProtocolErrorCodes = {
  sessionUnavailable: -32004,
} as const;

const nonEmptyString = z.string().trim().min(1);
const jsonObjectSchema = z.record(z.string(), z.unknown());
const timestampMsSchema = z.number().int().nonnegative();
const protocolInstantSchema = z.union([timestampMsSchema, nonEmptyString, z.date()]);

export const cfNodeReplImageToolResultDisplaySchema = z
  .object({
    kind: z.literal("node_repl_images"),
    images: z
      .array(
        z
          .object({
            base64: z
              .string()
              .min(1)
              .max(200 * 1024),
            mimeType: z.string().regex(/^image\/[a-z0-9.+-]+$/iu),
          })
          .strict(),
      )
      .min(1)
      .max(2),
    truncated: z.boolean().optional(),
    source: z.literal("browser_turn_end").optional(),
  })
  .strict();

const cfWorkflowNamePatternSchema = z
  .object({
    head: z.string().min(1).max(128).optional(),
    tail: z.string().min(1).max(128).optional(),
  })
  .strict();

const cfWorkflowEdgeSchema = z
  .object({
    from: z.string().min(1).max(64),
    to: z.string().min(1).max(64),
    back: z.literal(true).optional(),
  })
  .strict();

const cfCreateWorkflowCausalityGraphDisplaySchema = z
  .object({
    steps: z
      .array(
        z
          .object({
            id: z.string().min(1).max(64),
            kind: z.enum(["ask", "world-read", "hole"]),
            label: z.string().min(1).max(128),
            labelPattern: cfWorkflowNamePatternSchema.optional(),
            line: z.number().int().positive().optional(),
            column: z.number().int().positive().optional(),
            lane: z.string().min(1).max(64),
            lanes: z.array(z.string().min(1).max(64)).max(32).optional(),
            source: z.string().min(1).max(64).optional(),
            phase: z.string().min(1).max(64).optional(),
            repeat: z.enum(["stack", "serial"]).optional(),
            fill: z.string().min(1).max(64).optional(),
          })
          .strict(),
      )
      .max(64),
    lanes: z
      .array(
        z
          .object({
            id: z.string().min(1).max(64),
            name: z.string().min(1).max(128).optional(),
            namePattern: cfWorkflowNamePatternSchema.optional(),
            line: z.number().int().positive().optional(),
            column: z.number().int().positive().optional(),
          })
          .strict(),
      )
      .max(32),
    participants: z
      .array(
        z
          .object({
            id: z.string().min(1).max(64),
            phase: z.string().min(1).max(64),
            lane: z.string().min(1).max(64),
            steps: z.array(z.string().min(1).max(64)).min(1).max(64),
            member: z
              .object({ index: z.number().int().nonnegative(), of: z.number().int().positive() })
              .strict()
              .optional(),
            many: z.literal(true).optional(),
          })
          .strict(),
      )
      .max(64),
    handoffs: z
      .array(
        cfWorkflowEdgeSchema
          .extend({ types: z.array(z.string().min(1).max(128)).min(1).max(8).optional() })
          .strict(),
      )
      .max(256),
    phases: z
      .array(
        z
          .object({
            id: z.string().min(1).max(64),
            name: z.string().min(1).max(128).optional(),
            line: z.number().int().positive().optional(),
            column: z.number().int().positive().optional(),
            alongside: z.array(z.string().min(1).max(64)).min(1).max(32).optional(),
            fill: z.string().min(1).max(64).optional(),
          })
          .strict(),
      )
      .max(32)
      .optional(),
    phaseEdges: z.array(cfWorkflowEdgeSchema).max(128).optional(),
    phaseStreams: z
      .array(z.object({ from: z.string().min(1).max(64), to: z.string().min(1).max(64) }).strict())
      .max(128)
      .optional(),
    holes: z
      .array(
        z
          .object({
            siteId: z.string().min(1).max(64),
            name: z.string().min(1).max(128),
            type: z.string().min(1).max(128),
            phase: z.string().min(1).max(64).optional(),
            tail: z.boolean().optional(),
          })
          .strict(),
      )
      .max(32)
      .optional(),
    exits: z.array(z.string().min(1).max(64)).max(32).optional(),
    sink: z.array(z.string().min(1).max(64)).max(64).optional(),
    truncated: z.boolean().optional(),
  })
  .strict();

export const cfCreateWorkflowToolResultDisplaySchema = z
  .object({
    kind: z.literal("create_workflow"),
    ok: z.boolean(),
    errorCount: z.number().int().nonnegative(),
    diagnostics: z
      .array(
        z
          .object({
            line: z.number().int().nonnegative(),
            column: z.number().int().nonnegative(),
            code: z.number().int().nonnegative(),
            message: z.string().min(1).max(2_048),
          })
          .strict(),
      )
      .max(100),
    causalityGraph: cfCreateWorkflowCausalityGraphDisplaySchema.optional(),
    truncated: z.boolean().optional(),
    fill: z
      .object({
        siteId: z.string().min(1).max(64),
        name: z.string().min(1).max(128),
        draftPath: z.string().min(1).max(1_024).optional(),
        line: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const cfToolResultObjectSchema = jsonObjectSchema.superRefine((result, context) => {
  const display = result.display;
  if (typeof display !== "object" || display === null || Array.isArray(display)) {
    return;
  }
  const kind = (display as Record<string, unknown>).kind;
  const schemaByKind: Record<string, z.ZodTypeAny> = {
    node_repl_images: cfNodeReplImageToolResultDisplaySchema,
    create_workflow: cfCreateWorkflowToolResultDisplaySchema,
    bash_output: bashOutputDisplaySchema,
  };
  const schema = typeof kind === "string" ? schemaByKind[kind] : undefined;
  if (!schema) return;
  const parsed = schema.safeParse(display);
  if (parsed.success) return;
  for (const issue of parsed.error.issues) {
    context.addIssue({ ...issue, path: ["display", ...issue.path] });
  }
});

export const cfProtocolRequestIdSchema = z.union([z.string(), z.number().int()]);
export type CfProtocolRequestId = z.infer<typeof cfProtocolRequestIdSchema>;

export const TOPIC_RESOURCE_RELAY_CHUNK_BYTES = 384 * 1024;
export const TOPIC_RESOURCE_RELAY_CHANNEL = "host-topic-resource";
export const cfTopicResourceRelayRequestSchema = cfTopicResourceReadParamsSchema
  .extend({
    workspacePath: z.string().min(1).max(4096),
    workspaceIdentity: z.string().min(1).max(4096),
    remoteSessionId: z.string().min(1).max(256),
    trace: cfProtocolTraceSchema.optional(),
  })
  .strict();
export type CfTopicResourceRelayRequest = z.infer<typeof cfTopicResourceRelayRequestSchema>;
export const cfTopicResourceRelayKeySchema = cfTopicResourceCancelParamsSchema;
export const cfTopicResourceRelayChunkRequestSchema = cfTopicResourceRelayKeySchema
  .extend({
    index: z.number().int().nonnegative(),
  })
  .strict();
export const cfTopicResourceRelayMetadataSchema = z
  .object({
    fileName: z.string().min(1).max(1024),
    mime: z.string().min(1).max(256),
    bytes: z.number().int().min(0).max(PROTOCOL_V4_LIMITS.attachmentMaxBytes),
    totalChunks: z
      .number()
      .int()
      .min(0)
      .max(Math.ceil(PROTOCOL_V4_LIMITS.attachmentMaxBytes / TOPIC_RESOURCE_RELAY_CHUNK_BYTES)),
    checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  })
  .strict();
export const cfTopicResourceRelayChunkSchema = z
  .object({
    dataBase64: z.string().max((TOPIC_RESOURCE_RELAY_CHUNK_BYTES / 3) * 4),
  })
  .strict();

export const cfProtocolRequestSchema = z
  .object({
    id: cfProtocolRequestIdSchema,
    method: nonEmptyString,
    params: z.unknown().optional(),
    trace: cfProtocolTraceSchema.optional(),
  })
  .strict();
export type CfProtocolRequest = z.infer<typeof cfProtocolRequestSchema>;

export const cfProtocolNotificationSchema = z
  .object({
    method: nonEmptyString,
    params: z.unknown().optional(),
    trace: cfProtocolTraceSchema.optional(),
  })
  .strict();
export type CfProtocolNotification = z.infer<typeof cfProtocolNotificationSchema>;

export const cfProtocolResponseSchema = z
  .object({
    id: cfProtocolRequestIdSchema,
    result: z.unknown(),
  })
  .strict();
export type CfProtocolResponse = z.infer<typeof cfProtocolResponseSchema>;

export const cfProtocolErrorSchema = z
  .object({
    id: cfProtocolRequestIdSchema,
    error: z
      .object({
        code: z.number().int(),
        message: nonEmptyString,
        data: z.unknown().optional(),
      })
      .strict(),
  })
  .strict();
export type CfProtocolError = z.infer<typeof cfProtocolErrorSchema>;

export const cfProtocolMessageSchema = z.union([
  cfProtocolRequestSchema,
  cfProtocolNotificationSchema,
  cfProtocolResponseSchema,
  cfProtocolErrorSchema,
]);
export type CfProtocolMessage = z.infer<typeof cfProtocolMessageSchema>;

export const cfProtocolNotifications = {
  storageStartup: "startup/storageState",
  providerRuntimeHeadersCancelled: "interaction/providerRuntimeHeadersCancelled",
  mcpTelemetry: "process/mcpTelemetry",
  mcpResourceSamples: "process/mcpResourceSamples",
  toolExecResource: "process/toolExecResource",
  pluginOperationProgress: "plugins/operationProgress",
  processResourceSample: "process/resourceSample",
  processNetworkRequests: "process/networkRequests",
} as const;

export const cfStorageStartupStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    attemptId: z.string().min(1).max(128),
    sequence: z.number().int().positive(),
    databaseId: z.string().min(1).max(128),
    databaseKind: z.enum(["session", "tasks-index"]),
    phase: z.enum(["checking", "waiting_for_lock", "migrating", "committing", "ready", "failed"]),
    migration: databaseMigrationFactsSchema.optional(),
    elapsedMs: z.number().nonnegative().finite(),
    completed: z.number().int().nonnegative().optional(),
    total: z.number().int().nonnegative().optional(),
    errorCode: databaseStartupErrorCodeSchema.optional(),
    ...databaseStartupErrorDetailsSchema.shape,
  })
  .strict()
  .superRefine((state, context) => {
    if (state.phase === "failed" && !state.errorCode)
      context.addIssue({ code: "custom", message: "failed requires errorCode" });
  });
export type CfStorageStartupState = z.infer<typeof cfStorageStartupStateSchema>;

const cfMcpTelemetryPlatformSchema = z.enum([
  "aix",
  "android",
  "darwin",
  "freebsd",
  "haiku",
  "linux",
  "netbsd",
  "openbsd",
  "sunos",
  "win32",
  "cygwin",
]);
const cfMcpTelemetryArchSchema = z.enum([
  "arm",
  "arm64",
  "ia32",
  "loong64",
  "mips",
  "mipsel",
  "ppc",
  "ppc64",
  "riscv64",
  "s390",
  "s390x",
  "x64",
]);
const cfMcpTelemetryBaseSchema = z
  .object({
    arch: cfMcpTelemetryArchSchema,
    occurredAt: z.number().int().nonnegative(),
    platform: cfMcpTelemetryPlatformSchema,
  })
  .strict();
const cfMcpProcessTelemetryBaseShape = {
  mcpId: z
    .string()
    .regex(
      /^(?:builtin:(?:[A-Za-z0-9._~-]|%[0-9A-F]{2})+(?::(?:[A-Za-z0-9._~-]|%[0-9A-F]{2})+)*|(?:plugin|custom):[a-f0-9]{12})$/,
    ),
  mcpInstanceId: nonEmptyString,
  mcpIsolation: z.enum(["session", "workspace"]),
  mcpSource: z.enum(["builtin", "plugin", "custom"]),
} as const;

export const cfMcpTelemetryEventSchema = z.discriminatedUnion("kind", [
  cfMcpTelemetryBaseSchema
    .extend({
      kind: z.literal("process_start"),
      ...cfMcpProcessTelemetryBaseShape,
    })
    .strict(),
  cfMcpTelemetryBaseSchema
    .extend({
      kind: z.literal("process_crash"),
      ...cfMcpProcessTelemetryBaseShape,
      affectedSessionCount: z.number().int().nonnegative().max(10_000),
      exitCode: z.number().int().nullable(),
      signal: nonEmptyString.nullable(),
      uptimeMs: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER),
    })
    .strict(),
  cfMcpTelemetryBaseSchema
    .extend({
      kind: z.literal("session_startup"),
      configuredCount: z.number().int().nonnegative().max(10_000),
      connectedCount: z.number().int().nonnegative().max(10_000),
      failedCount: z.number().int().nonnegative().max(10_000),
      processCount: z.number().int().nonnegative().max(10_000),
      sessionId: nonEmptyString,
    })
    .strict(),
  cfMcpTelemetryBaseSchema
    .extend({
      kind: z.literal("memory"),
      ...cfMcpProcessTelemetryBaseShape,
      memoryKb: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER),
      memoryScope: z.enum(["process_tree", "direct_process"]),
      orphanSuspected: z.boolean(),
      ownerSessionCount: z.number().int().nonnegative().max(10_000),
      unownedSeconds: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER),
    })
    .strict(),
]);
export type CfMcpTelemetryEvent = z.infer<typeof cfMcpTelemetryEventSchema>;

export const CF_MCP_RESOURCE_SAMPLE_INTERVAL_MS = 5 * 60_000;

export const cfMcpResourceSampleSchema = z
  .object({
    mcpId: cfMcpProcessTelemetryBaseShape.mcpId,
    instanceToken: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
    sampledAt: z.number().int().nonnegative(),
    intervalMs: z.number().finite().positive(),
    processCount: z.number().int().positive().max(100_000),
    rssKbTotal: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER),
    rssKbMaxProcess: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER),
    cpuTimeMsDelta: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER),
    uptimeMinutes: z.number().int().nonnegative(),
    platform: cfMcpTelemetryPlatformSchema,
    arch: cfMcpTelemetryArchSchema,
    logicalCpuCount: z.number().int().positive().max(4_096),
    totalMemoryGb: z.number().int().nonnegative().max(1_048_576),
  })
  .strict();
export type CfMcpResourceSample = z.infer<typeof cfMcpResourceSampleSchema>;
export const cfMcpResourceSamplesSchema = z.array(cfMcpResourceSampleSchema).max(1_024);

export const BASH_RESOURCE_SAMPLE_INTERVAL_MS = 15_000;
export const BASH_RESOURCE_MAX_SAMPLES = 20;

export const cfToolExecResourceSchema = z
  .object({
    completionToken: z.string().uuid().optional(),
    platform: cfMcpTelemetryPlatformSchema,
    toolName: z.literal("bash"),
    durationMs: z.number().finite().min(BASH_RESOURCE_SAMPLE_INTERVAL_MS),
    exitKind: z.enum(["completed", "timeout", "killed", "error"]),
    treeRssKbPeak: z.number().finite().nonnegative().optional(),
    treeCpuTimeMs: z.number().finite().nonnegative().optional(),
    sampleCount: z.number().int().nonnegative().max(BASH_RESOURCE_MAX_SAMPLES),
    cliRssKb: z.number().finite().nonnegative(),
    systemFreeMemoryKb: z.number().finite().nonnegative(),
  })
  .strict();
export type CfToolExecResource = z.infer<typeof cfToolExecResourceSchema>;

export const cfProcessResourceSampleSchema = z
  .object({
    platform: z.enum([
      "aix",
      "android",
      "darwin",
      "freebsd",
      "haiku",
      "linux",
      "netbsd",
      "openbsd",
      "sunos",
      "win32",
      "cygwin",
    ]),
    arch: z.enum([
      "arm",
      "arm64",
      "ia32",
      "loong64",
      "mips",
      "mipsel",
      "ppc",
      "ppc64",
      "riscv64",
      "s390",
      "s390x",
      "x64",
    ]),
    logicalCpuCount: z.number().int().positive().max(4_096),
    intervalMs: z
      .number()
      .int()
      .positive()
      .max(7 * 24 * 60 * 60 * 1_000),
    cpuCores: z.number().finite().nonnegative().max(4_096),
    cpuPercent: z.number().finite().nonnegative().max(100_000),
    rssKb: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER),
    
    heapUsedKb: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    uptimeMinutes: z
      .number()
      .int()
      .nonnegative()
      .max(10 * 365 * 24 * 60)
      .optional(),
    totalMemoryGb: z.number().int().nonnegative().max(1_048_576).optional(),
    
    instanceToken: z
      .string()
      .regex(/^[A-Za-z0-9_-]{8,64}$/)
      .optional(),
  })
  .strict();
export type CfProcessResourceSample = z.infer<typeof cfProcessResourceSampleSchema>;

export const cfProcessChildProcessesParamsSchema = z.object({}).strict();
export const cfProcessChildProcessSchema = z
  .object({
    pid: z.number().int().positive(),
    serverName: nonEmptyString,
    mcpSource: z.enum(["builtin", "plugin", "custom"]),
    
    pluginName: nonEmptyString.optional(),
  })
  .strict();
export const cfProcessChildProcessesResultSchema = z
  .object({
    processes: z.array(cfProcessChildProcessSchema).max(10_000),
  })
  .strict();
export type CfProcessChildProcess = z.infer<typeof cfProcessChildProcessSchema>;
export type CfProcessChildProcessesResult = z.infer<
  typeof cfProcessChildProcessesResultSchema
>;

export type CfDeliveryKind = z.infer<typeof cfDeliveryKindSchema>;
const cfTurnInputSourceSchema = legacyCfSyntheticUserMessageSourceSchema;
export const cfSessionPersistenceSchema = z.enum(["immediate", "deferred"]);
export type CfSessionPersistence = z.infer<typeof cfSessionPersistenceSchema>;
export type CfWorkspaceRef = z.infer<typeof cfWorkspaceRefSchema>;
export const cfPermissionOptionSchema = z
  .object({
    optionId: nonEmptyString,
    kind: nonEmptyString,
    name: nonEmptyString,
    description: z.string().optional(),
    response: cfPermissionResponseSchema,
  })
  .strict();

const cfProtocolMcpEntrySchema = z
  .object({
    name: nonEmptyString,
    value: z.string(),
  })
  .strict();

const cfProtocolMcpOAuthSchema = z.union([
  z
    .object({
      type: z.literal("client_credentials"),
      clientId: nonEmptyString,
      clientSecret: nonEmptyString,
      clientName: nonEmptyString.optional(),
      scope: z.string().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("authorization_code"),
      clientId: nonEmptyString.optional(),
      clientSecret: nonEmptyString.optional(),
      clientName: nonEmptyString.optional(),
      redirectPath: nonEmptyString.optional(),
      scope: z.string().optional(),
    })
    .strict(),
]);

export const cfProtocolMcpServerSchema = z.union([
  z
    .object({
      name: nonEmptyString,
      command: nonEmptyString,
      args: z.array(z.string()),
      env: z.array(cfProtocolMcpEntrySchema),
      isolation: z.enum(["session", "workspace"]).optional(),
      protocolVersion: z.enum(["legacy", "auto", "2026-07-28"]).optional(),
      alwaysLoad: z.boolean().optional(),
      timeoutMs: z.number().int().positive().optional(),
    })
    .strict(),
  z
    .object({
      name: nonEmptyString,
      type: z.enum(["http", "sse"]),
      url: nonEmptyString,
      headers: z.array(cfProtocolMcpEntrySchema),
      oauth: cfProtocolMcpOAuthSchema.optional(),
      isolation: z.enum(["session", "workspace"]).optional(),
      protocolVersion: z.enum(["legacy", "auto", "2026-07-28"]).optional(),
      alwaysLoad: z.boolean().optional(),
      timeoutMs: z.number().int().positive().optional(),
    })
    .strict(),
]);
export type CfProtocolMcpServer = z.infer<typeof cfProtocolMcpServerSchema>;

export const cfMcpServerStatusKindSchema = z.enum([
  "connecting",
  "connected",
  "disabled",
  "disconnected",
  "failed",
  "untrusted",
]);
export const MCP_SERVER_FAILURE_KINDS = [
  "config_invalid",
  "runtime_unavailable",
  "process_start_failed",
  "network_unreachable",
  "connection_timeout",
  "protocol_negotiation_failed",
  "tool_list_failed",
  "unexpected_disconnect",
  "oauth_authorization_failed",
  "official_origin_untrusted",
  "not_authenticated",
  "coding_plan_required",
  "server_not_found",
  "server_unavailable",
  "rate_limited",
  "server_internal_error",
  "protocol_error",
  "status_unavailable",
  "connection_failed",
] as const;
export const mcpServerFailureKindSchema = z.enum(MCP_SERVER_FAILURE_KINDS);
export type McpServerFailureKind = z.infer<typeof mcpServerFailureKindSchema>;
export const cfMcpServerStatusSnapshotSchema = z
  .object({
    status: cfMcpServerStatusKindSchema,
    transport: z.enum(["stdio", "http", "sse"]),
    toolCount: z.number().int().nonnegative(),
    updatedAt: nonEmptyString,
    error: z.string().optional(),
    failureKind: mcpServerFailureKindSchema.optional(),
    serverRequestId: nonEmptyString.optional(),
    protocolEra: z.enum(["legacy", "modern"]).optional(),
    authorization: z
      .object({
        type: z.literal("oauth_authorization_code"),
        authorizationUrl: nonEmptyString,
        startedAt: nonEmptyString,
      })
      .strict()
      .optional(),
  })
  .strict();
export type CfMcpServerStatusSnapshot = z.infer<typeof cfMcpServerStatusSnapshotSchema>;

export const cfMcpListModeSchema = z.enum(["connect", "status"]);
export type CfMcpListMode = z.infer<typeof cfMcpListModeSchema>;

export const cfMcpListParamsSchema = z
  .object({
    workspace: cfWorkspaceRefSchema,
    mcpServers: z.array(cfProtocolMcpServerSchema).optional(),
    mode: cfMcpListModeSchema.default("connect"),
  })
  .strict();
export const cfMcpListResultSchema = z
  .object({
    statuses: z.record(z.string(), cfMcpServerStatusSnapshotSchema),
  })
  .strict();
export type CfMcpListResult = z.infer<typeof cfMcpListResultSchema>;

export const cfMcpUiOpenInstanceParamsSchema = z
  .object({
    accountContext: z.string().max(256).optional(),
    workspace: cfWorkspaceRefSchema,
    sessionId: nonEmptyString,
    pluginId: nonEmptyString,
    serverName: nonEmptyString,
    scopeId: nonEmptyString.max(4096),
    resourceUri: nonEmptyString.max(2048),
    ownerWebContentsId: z.number().int().positive(),
  })
  .strict();
export const cfMcpUiOpenInstanceResultSchema = mcpAppInstanceSchema;
export type CfMcpUiOpenInstanceParams = z.infer<typeof cfMcpUiOpenInstanceParamsSchema>;
const cfMcpUiPluginScopeShape = {
  instance: mcpAppInstanceSchema,

  workspace: cfWorkspaceRefSchema,
  sessionId: nonEmptyString,
  pluginId: nonEmptyString,
  serverName: nonEmptyString,
};
export const cfMcpUiCloseInstanceParamsSchema = z
  .object({ ...cfMcpUiPluginScopeShape, onlyIfIdle: z.boolean().optional() })
  .strict();
export const cfMcpUiCloseInstanceResultSchema = z.object({ closed: z.boolean() }).strict();
export const cfMcpReadResourceParamsSchema = z
  .object({ ...cfMcpUiPluginScopeShape, uri: nonEmptyString.max(2048) })
  .strict();
export type CfMcpReadResourceParams = z.infer<typeof cfMcpReadResourceParamsSchema>;
export const cfMcpResourceContentSchema = z
  .object({
    uri: z.string(),
    mimeType: z.string().optional(),
    text: z.string().optional(),
    blob: z.string().optional(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export const cfMcpReadResourceResultSchema = z
  .object({ contents: z.array(cfMcpResourceContentSchema) })
  .strict();
export type CfMcpReadResourceResult = z.infer<typeof cfMcpReadResourceResultSchema>;

export const cfMcpUiReadResourceParamsSchema = cfMcpReadResourceParamsSchema;
export type CfMcpUiReadResourceParams = z.infer<typeof cfMcpUiReadResourceParamsSchema>;
export const cfMcpUiResourceContentSchema = z
  .object({
    uri: z.string(),
    mimeType: z.string().optional(),
    text: z.string().optional(),
    blob: z.string().optional(),
  })
  .strict();
export const cfMcpUiReadResourceResultSchema = z
  .object({ contents: z.array(cfMcpUiResourceContentSchema) })
  .strict();
export type CfMcpUiReadResourceResult = z.infer<typeof cfMcpUiReadResourceResultSchema>;

export const cfMcpUiSamplingParamsSchema = z
  .object({
    ...cfMcpUiPluginScopeShape,
    operationId: nonEmptyString.max(128),
    request: mcpAppsSamplingParamsSchema,
  })
  .strict();
export const cfMcpUiCancelSamplingParamsSchema = z
  .object({ ...cfMcpUiPluginScopeShape, operationId: nonEmptyString.max(128) })
  .strict();
export const cfMcpUiSamplingResultSchema = mcpAppsSamplingResultSchema;
export type CfMcpUiSamplingParams = z.infer<typeof cfMcpUiSamplingParamsSchema>;
export type CfMcpUiCancelSamplingParams = z.infer<typeof cfMcpUiCancelSamplingParamsSchema>;

export const cfMcpUiCallToolParamsSchema = z
  .object({
    ...cfMcpUiPluginScopeShape,
    toolName: nonEmptyString,
    arguments: z.record(z.string(), z.unknown()).optional(),
    
    callId: nonEmptyString.max(128),
  })
  .strict();
export type CfMcpUiCallToolParams = z.infer<typeof cfMcpUiCallToolParamsSchema>;

export const cfMcpUiCancelCallParamsSchema = z
  .object({ ...cfMcpUiPluginScopeShape, callId: nonEmptyString.max(128) })
  .strict();
export type CfMcpUiCancelCallParams = z.infer<typeof cfMcpUiCancelCallParamsSchema>;
export const cfMcpUiCancelCallResultSchema = z.object({ cancelled: z.boolean() }).strict();
export type CfMcpUiCancelCallResult = z.infer<typeof cfMcpUiCancelCallResultSchema>;

export const cfMcpUiListResourcesParamsSchema = z
  .object({ ...cfMcpUiPluginScopeShape, cursor: nonEmptyString.max(2048).optional() })
  .strict();
export type CfMcpUiListResourcesParams = z.infer<typeof cfMcpUiListResourcesParamsSchema>;
const cfMcpUiResourceDescriptorSchema = z
  .object({
    uri: z.string(),
    name: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    mimeType: z.string().optional(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export const cfMcpUiListResourcesResultSchema = z
  .object({
    resources: z.array(cfMcpUiResourceDescriptorSchema),
    nextCursor: z.string().optional(),
  })
  .strict();
export type CfMcpUiListResourcesResult = z.infer<typeof cfMcpUiListResourcesResultSchema>;
export const cfMcpUiListResourceTemplatesResultSchema = z
  .object({
    resourceTemplates: z.array(
      z
        .object({
          uriTemplate: z.string(),
          name: z.string().optional(),
          title: z.string().optional(),
          description: z.string().optional(),
          mimeType: z.string().optional(),
        })
        .strict(),
    ),
    nextCursor: z.string().optional(),
  })
  .strict();
export type CfMcpUiListResourceTemplatesResult = z.infer<
  typeof cfMcpUiListResourceTemplatesResultSchema
>;

export const cfMcpUiResourceSubscriptionParamsSchema = z
  .object({
    ...cfMcpUiPluginScopeShape,
    scopeId: nonEmptyString.max(256),
    generation: z.number().int().nonnegative(),
    uri: nonEmptyString.max(2048),
  })
  .strict();
export type CfMcpUiResourceSubscriptionParams = z.infer<
  typeof cfMcpUiResourceSubscriptionParamsSchema
>;
export const cfMcpUiResourceSubscriptionResultSchema = z.object({}).strict();

const cfMcpUiAppToolInstanceShape = {
  ...cfMcpUiPluginScopeShape,
  scopeId: nonEmptyString.max(256),
  generation: z.number().int().nonnegative(),
};
export const cfMcpUiRegisterAppToolsParamsSchema = z
  .object({
    ...cfMcpUiAppToolInstanceShape,
    tools: z.array(mcpAppsAppToolDescriptorSchema).max(MCP_APPS_APP_TOOLS_MAX_PER_INSTANCE),
  })
  .strict();
export type CfMcpUiRegisterAppToolsParams = z.infer<
  typeof cfMcpUiRegisterAppToolsParamsSchema
>;
export const cfMcpUiRegisterAppToolsResultSchema = z
  .object({ tools: z.array(z.object({ name: z.string(), modelName: z.string() }).strict()) })
  .strict();
export type CfMcpUiRegisterAppToolsResult = z.infer<
  typeof cfMcpUiRegisterAppToolsResultSchema
>;
export const cfMcpUiUnregisterAppToolsParamsSchema = z
  .object(cfMcpUiAppToolInstanceShape)
  .strict();
export type CfMcpUiUnregisterAppToolsParams = z.infer<
  typeof cfMcpUiUnregisterAppToolsParamsSchema
>;
export const cfMcpUiUnregisterAppToolsResultSchema = z
  .object({ removed: z.number().int().nonnegative() })
  .strict();
export type CfMcpUiUnregisterAppToolsResult = z.infer<
  typeof cfMcpUiUnregisterAppToolsResultSchema
>;
export const cfMcpUiClaimAppToolCallParamsSchema = z
  .object({
    ...cfMcpUiAppToolInstanceShape,
    callId: nonEmptyString.max(MCP_APPS_APP_TOOL_CALL_ID_MAX_CHARS),
  })
  .strict();
export type CfMcpUiClaimAppToolCallParams = z.infer<
  typeof cfMcpUiClaimAppToolCallParamsSchema
>;
export const cfMcpUiAppToolAcceptedResultSchema = z.object({ accepted: z.boolean() }).strict();
export type CfMcpUiAppToolAcceptedResult = z.infer<typeof cfMcpUiAppToolAcceptedResultSchema>;
export const cfMcpUiResolveAppToolCallParamsSchema = z
  .object({
    ...cfMcpUiAppToolInstanceShape,
    callId: nonEmptyString.max(MCP_APPS_APP_TOOL_CALL_ID_MAX_CHARS),
    result: mcpAppsAppToolCallResultSchema.optional(),
    error: z
      .object({ message: z.string().max(MCP_APPS_APP_TOOL_ERROR_MESSAGE_MAX_CHARS) })
      .strict()
      .optional(),
  })
  .strict()
  .refine((value) => (value.result === undefined) !== (value.error === undefined), {
    message: "exactly one of result or error is required",
  });
export type CfMcpUiResolveAppToolCallParams = z.infer<
  typeof cfMcpUiResolveAppToolCallParamsSchema
>;
export const cfMcpUiCallToolResultSchema = z
  .object({
    content: z.array(z.record(z.string(), z.unknown())),
    structuredContent: z.unknown().optional(),
    isError: z.boolean().optional(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type CfMcpUiCallToolResult = z.infer<typeof cfMcpUiCallToolResultSchema>;

export const cfSessionImportMessageSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string(),
    timestamp: timestampMsSchema.optional(),
  })
  .strict();
export type CfSessionImportMessage = z.infer<typeof cfSessionImportMessageSchema>;

export const cfSessionImportHistorySchema = z.discriminatedUnion("source", [
  z
    .object({
      source: z.literal("claudeCode"),
      title: z.string().optional(),
      createdAt: timestampMsSchema.optional(),
      updatedAt: timestampMsSchema.optional(),
      messages: z.array(cfSessionImportMessageSchema).min(1),
    })
    .strict(),
  z
    .object({
      source: z.literal("sharedContext"),
      title: z.string().trim().min(1),
      createdAt: timestampMsSchema.optional(),
      markdown: z.string().min(1),
      provenance: z
        .object({
          shareId: z.string().trim().min(1),
          contextId: z.string().trim().min(1).optional(),
          shareUrl: z.string().url().optional(),
          status: z.enum(["pending", "reserved", "attached", "discarded"]).optional(),
          projectionSha256: z.string().regex(/^[0-9a-f]{64}$/u),
          artifactSetSha256: z.string().regex(/^[0-9a-f]{64}$/u),
          formatterVersion: z.literal(1),
          markdownSha256: z.string().regex(/^[0-9a-f]{64}$/u),
          installedArtifacts: z.array(
            z
              .object({
                artifactId: z.string().trim().min(1),
                workspaceRelativePath: z.string().trim().min(1),
              })
              .strict(),
          ),
        })
        .strict(),
    })
    .strict(),
]);
export type CfSessionImportHistory = z.infer<typeof cfSessionImportHistorySchema>;

export const cfThoughtLevelOptionSchema = z
  .object({
    value: nonEmptyString,
    label: nonEmptyString,
    description: z.string().optional(),
  })
  .strict();
export const cfModelReasoningOptionsSchema = z
  .object({
    levels: z.array(cfThoughtLevelOptionSchema),
    defaultLevel: nonEmptyString.optional(),
  })
  .strict();
export type CfModelReasoningOptions = z.infer<typeof cfModelReasoningOptionsSchema>;

export const cfModelFormatPropertiesSchema = completeModelPropertiesDataSchema.pick({
  inputFormat: true,
  outputFormat: true,
});
export type CfModelFormatProperties = z.infer<typeof cfModelFormatPropertiesSchema>;

export const cfModelOptionSchema = z
  .object({
    ref: modelSelectionSchema,
    label: nonEmptyString,
    providerLabel: nonEmptyString.optional(),
    description: z.string().optional(),
    contextWindow: z.number().int().positive().optional(),
    maxOutputTokens: z.number().int().positive().optional(),
    reasoning: cfModelReasoningOptionsSchema.optional(),
    properties: cfModelFormatPropertiesSchema,
    disabledReason: z.string().optional(),
  })
  .strict();
export type CfModelOption = z.infer<typeof cfModelOptionSchema>;

export const cfAccountAccessSchema = z.discriminatedUnion("planKind", [
  z
    .object({
      type: z.literal("zhipu-account"),
      family: z.enum(["zai", "bigmodel"]),
      planKind: z.literal("start-plan"),
    })
    .strict(),
  z
    .object({
      type: z.literal("zhipu-account"),
      family: z.enum(["zai", "bigmodel"]),
      planKind: z.literal("individual-coding-plan"),
    })
    .strict(),
  z
    .object({
      type: z.literal("zhipu-account"),
      family: z.enum(["zai", "bigmodel"]),
      planKind: z.literal("team-coding-plan"),
      productId: nonEmptyString,
      organizationId: nonEmptyString,
      projectId: nonEmptyString,
    })
    .strict(),
]);
export type CfAccountAccess = z.infer<typeof cfAccountAccessSchema>;

export const cfProviderAccountAccessSchema = z
  .object({
    type: z.literal("zhipu-account"),
    accountType: z.enum(["zai", "bigmodel"]),
    mode: z.enum([
      "start-plan",
      "individual-coding-plan",
      "team-coding-plan",
      "off-peak",
      "highspeed",
    ]),
    entitled: z.boolean(),
  })
  .strict();
export type CfProviderAccountAccess = z.infer<typeof cfProviderAccountAccessSchema>;

export type CfSessionMode = z.infer<typeof cfSessionModeSchema>;
export type CfSessionKind = z.infer<typeof cfSessionKindSchema>;
export type CfSessionGoal = z.infer<typeof cfSessionGoalSchema>;

export const cfSessionTodoItemSchema = z
  .object({
    content: nonEmptyString,
    status: z.enum(["pending", "in_progress", "completed"]),
    priority: z.enum(["high", "medium", "low"]),
  })
  .strict();
export const cfSessionGoalStatsSchema = z
  .object({
    timeUsedSeconds: z.number().int().nonnegative(),
    tokensUsed: z.number().int().nonnegative(),
    tokenBudget: z.number().int().positive().nullable(),
    contextUsed: z.number().int().nonnegative(),
    contextWindow: z.number().int().nonnegative(),
    toolCallCount: z.number().int().nonnegative(),
    iterationCount: z.number().int().nonnegative(),
  })
  .strict();
export type CfSessionGoalStats = z.infer<typeof cfSessionGoalStatsSchema>;
export type CfSessionGoalVerification = z.infer<typeof cfSessionGoalVerificationSchema>;
export type CfSessionGoalVerificationTimeline = z.infer<
  typeof cfSessionGoalVerificationTimelineSchema
>;

export const cfSessionTodoGroupSchema = z
  .object({
    id: nonEmptyString,
    source: z.enum(["goal_iteration", "session"]),
    goalIteration: z.number().int().positive().optional(),
    targetId: nonEmptyString.optional(),
    startedAt: timestampMsSchema.optional(),
    updatedAt: timestampMsSchema.optional(),
    todos: z.array(cfSessionTodoItemSchema),
  })
  .strict();
export type CfSessionTodoGroup = z.infer<typeof cfSessionTodoGroupSchema>;

export const cfSessionSettingsStateSchema = z
  .object({
    model: z
      .object({
        current: modelSelectionSchema.optional(),
        available: z.array(cfModelOptionSchema),
        lastUsed: modelSelectionSchema.optional(),
      })
      .strict(),
    thoughtLevel: z
      .object({
        enabled: z.boolean(),
        current: nonEmptyString.optional(),
        defaultLevel: nonEmptyString.optional(),
        available: z.array(cfThoughtLevelOptionSchema),
      })
      .strict(),
    mode: z
      .object({
        current: cfSessionModeSchema,
      })
      .strict(),
    permission: z
      .object({
        mode: cfSessionModeSchema.optional(),
        rulesRevision: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type CfSessionSettingsState = z.infer<typeof cfSessionSettingsStateSchema>;
export const cfPendingPermissionSchema = z
  .object({
    requestId: nonEmptyString,
    toolCallId: nonEmptyString,
    toolName: nonEmptyString,
    reason: z.string(),
    riskLevel: z.enum(["low", "medium", "high", "critical"]),
    input: z.unknown().optional(),
    origin: cfInteractionRequestOriginSchema.optional(),
    options: z.array(cfPermissionOptionSchema).min(1),
    requestedAt: timestampMsSchema,
  })
  .strict();
export type CfPendingPermission = z.infer<typeof cfPendingPermissionSchema>;

export const cfActiveToolCallSchema = z
  .object({
    toolCallId: nonEmptyString,
    toolName: nonEmptyString,
    status: z.enum(["pending", "running", "completed", "failed", "denied"]),
    startedAt: timestampMsSchema.optional(),
  })
  .strict();
export type CfActiveToolCall = z.infer<typeof cfActiveToolCallSchema>;

export const cfSessionProjectionSchema = z
  .object({
    sessionId: nonEmptyString,
    status: cfSessionStatusSchema,
    mode: cfSessionModeSchema,
    turnCount: z.number().int().nonnegative(),
    totalTokenCount: z.number().int().nonnegative(),
    contextUsed: z.number().int().nonnegative(),
    contextWindow: z.number().int().nonnegative(),
    currentTurnId: nonEmptyString.optional(),
    pendingPermissions: z.array(cfPendingPermissionSchema),
    activeToolCalls: z.array(cfActiveToolCallSchema),
    backgroundJobs: z.array(jsonObjectSchema),
    target: cfSessionGoalSchema.nullable().optional(),
    lastError: z
      .object({
        type: nonEmptyString,
        code: nonEmptyString.optional(),
        message: nonEmptyString,
        detail: z.string().optional(),
        attribution: errorAttributionSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type CfSessionProjection = z.infer<typeof cfSessionProjectionSchema>;
export type CfToolState = z.infer<typeof cfToolStateSchema>;
export const cfSlashCommandSchema = z
  .object({
    name: nonEmptyString,
    description: z.string(),
    inputHint: z.string().optional(),
    source: z.enum(["builtin", "custom"]).optional(),
  })
  .strict();
export type CfSessionApiRetryStatus = z.infer<typeof cfSessionApiRetryStatusSchema>;
export type CfSessionContextUsage = z.infer<typeof cfSessionContextUsageSchema>;
export const cfModelStreamingKindSchema = z.enum([
  "start",
  "finish",
  "error",
  "text_start",
  "text_delta",
  "text_end",
  "reasoning_start",
  "reasoning_delta",
  "reasoning_end",
  "tool_input_start",
  "tool_input_delta",
  "tool_input_end",
  "tool_call",
]);
export const cfModelStreamingEventPayloadSchema = z
  .object({
    assistantMessageId: z.string().optional(),
    delta: z.string().optional(),
    done: z.boolean().optional(),
    input: z.unknown().optional(),
    kind: cfModelStreamingKindSchema,
    partId: z.string().optional(),
    providerExecuted: z.boolean().optional(),
    toolCallId: z.string().optional(),
    toolName: z.string().optional(),
  })
  .strict();
export const cfSessionStateSnapshotSchema = z
  .object({
    protocol: z
      .object({
        name: z.literal(CF_PROTOCOL_NAME),
        version: z.literal(CF_PROTOCOL_VERSION),
      })
      .strict(),
    session: cfSessionInfoSchema,
    settings: cfSessionSettingsStateSchema,
    projection: cfSessionProjectionSchema,
    runtime: cfSessionRuntimeStateSchema,
    messages: z.array(cfMessageWithPartsSchema),
    goalStats: cfSessionGoalStatsSchema.optional(),
    todos: z.array(cfSessionTodoItemSchema).optional(),
    todoGroups: z.array(cfSessionTodoGroupSchema).optional(),
    slashCommands: z.array(cfSlashCommandSchema).optional(),
  })
  .strict();
export type CfSessionStateSnapshot = z.infer<typeof cfSessionStateSnapshotSchema>;

export const cfEventEnvelopeSchema = z
  .object({
    eventId: nonEmptyString,
    sessionId: nonEmptyString,
    turnId: nonEmptyString.optional(),
    seq: z.number().int().nonnegative(),
    traceId: nonEmptyString.optional(),
    timestamp: timestampMsSchema,
    deliveryKind: cfDeliveryKindSchema.optional(),
  })
  .strict();

const cfComputerUseOperationEventBaseSchema = z
  .object({
    eventId: nonEmptyString,
    sequenceNumber: z.number().int().nonnegative(),
    sessionId: nonEmptyString,
    timestamp: timestampMsSchema,
  })
  .strict();

const cfComputerUseTurnStartedEventSchema = cfComputerUseOperationEventBaseSchema.extend({
  kind: z.literal("turn-started"),
  turnId: nonEmptyString,
});
const cfComputerUseTurnCompletedEventSchema = cfComputerUseOperationEventBaseSchema.extend({
  kind: z.literal("turn-completed"),
  turnId: nonEmptyString,
});
const cfComputerUseTurnFailedEventSchema = cfComputerUseOperationEventBaseSchema.extend({
  kind: z.literal("turn-failed"),
  turnId: nonEmptyString,
});
const cfComputerUseToolScheduledEventSchema = cfComputerUseOperationEventBaseSchema.extend({
  kind: z.literal("tool-scheduled"),
  turnId: nonEmptyString,
  toolCallId: nonEmptyString,
  toolName: nonEmptyString,
  computerUse: z.literal(true).optional(),
});
const cfComputerUseToolStartedEventSchema = cfComputerUseOperationEventBaseSchema.extend({
  kind: z.literal("tool-started"),
  turnId: nonEmptyString.optional(),
  toolCallId: nonEmptyString,
  toolName: nonEmptyString.optional(),
});
const cfComputerUseSessionClosedEventSchema = cfComputerUseOperationEventBaseSchema.extend({
  kind: z.literal("session-closed"),
});

export const cfComputerUseOperationEventSchema = z.discriminatedUnion("kind", [
  cfComputerUseTurnStartedEventSchema,
  cfComputerUseTurnCompletedEventSchema,
  cfComputerUseTurnFailedEventSchema,
  cfComputerUseToolScheduledEventSchema,
  cfComputerUseToolStartedEventSchema,
  cfComputerUseSessionClosedEventSchema,
]);
export type CfComputerUseOperationEvent = z.infer<typeof cfComputerUseOperationEventSchema>;

export const cfSessionEventTypeSchema = z.enum([
  "session.created",
  "session.resumed",
  "session.updated",
  "session.titleUpdated",
  "session.closed",
  "turn.started",
  "turn.steerQueued",
  "turn.steerDrained",
  "turn.completed",
  "turn.failed",
  "message.upserted",
  "message.removed",
  "part.started",
  "part.delta",
  "part.upserted",
  "part.removed",
  "model.streaming",
  "tool.updated",
  "permission.requested",
  "permission.resolved",
  "userInput.requested",
  "userInput.resolved",
  "checkpoint.created",
  "rewind.triggered",
  "streamRecovery.updated",
]);
export type CfSessionEventType = z.infer<typeof cfSessionEventTypeSchema>;

export const cfProtocolErrorDetailSchema = z
  .object({
    type: nonEmptyString,
    message: nonEmptyString,
    stack: z.string().optional(),
    code: z.string().optional(),
    detail: z.string().optional(),
    underlyingErrorMessage: z.string().optional(),
    underlyingErrorDetail: z.string().optional(),
    attribution: errorAttributionSchema.optional(),
    retryable: z.boolean().optional(),
    data: z.unknown().optional(),
  })
  .strict();
export const cfSessionCreatedEventPayloadSchema = z
  .object({
    mode: cfSessionModeSchema,
    contextWindow: z.number().int().nonnegative(),
  })
  .strict();
export const cfSessionResumedEventPayloadSchema = z
  .object({
    directory: nonEmptyString,
    interruptedToolCount: z.number().int().nonnegative(),
    messageCount: z.number().int().nonnegative(),
    partCount: z.number().int().nonnegative(),
    recoveredCompactTimelineCount: z.number().int().nonnegative().optional(),
    recoveredSteerInputCount: z.number().int().nonnegative().optional(),
    resumedTodoCount: z.number().int().nonnegative().optional(),
  })
  .strict();
export const cfSessionTitleUpdatedEventPayloadSchema = z
  .object({
    messageID: nonEmptyString.optional(),
    previousTitle: z.string(),
    source: z.enum(["default", "first_input", "generated", "custom"]),
    title: z.string(),
  })
  .strict();
export const cfTurnStartedEventPayloadSchema = z
  .object({
    executionStartedAt: z.number().nonnegative().optional(),
    turnNumber: z.number().int().nonnegative(),
    input: z.string(),
    inputId: nonEmptyString.optional(),
    queryId: nonEmptyString.optional(),
    inputSource: cfTurnInputSourceSchema.optional(),
    inputVisibility: cfMessageVisibilitySchema.optional(),
    executionKind: z.enum(["agent", "controlOnly"]).optional(),
    targetId: nonEmptyString.optional(),
    messageId: nonEmptyString.optional(),
    foregroundExecutionId: nonEmptyString.optional(),
    intent: jsonObjectSchema.optional(),
    originMeta: jsonObjectSchema.optional(),
    backgroundSource: z.enum(["bash", "subagent"]).optional(),
    attachments: z.array(jsonObjectSchema).optional(),
  })
  .strict();
const cfTurnSteerSourceSchema = z.enum(["plan_approval_feedback", "workflow_refine_feedback"]);
const cfTurnSteerCommandKindSchema = z.enum(["sendText", "sendGoalCommand", "compact"]);
const cfTurnSteerDeliverySchema = z.enum(["queue", "guide"]);

export const cfTurnSteerQueuedEventPayloadSchema = z
  .object({
    pendingInputId: nonEmptyString,
    inputId: nonEmptyString.optional(),
    queryId: nonEmptyString.optional(),
    input: z.string(),
    inputPreview: z.string(),
    inputSize: z.number().int().nonnegative(),
    commandKind: cfTurnSteerCommandKindSchema.optional(),
    source: cfTurnSteerSourceSchema.optional(),
    toolDisallowlist: z.array(nonEmptyString).optional(),
    delivery: cfTurnSteerDeliverySchema.optional(),
    targetTurnId: nonEmptyString,
    queueLength: z.number().int().nonnegative(),
    intent: jsonObjectSchema.optional(),
  })
  .strict();
export const cfTurnSteerDrainedEventPayloadSchema = z
  .object({
    pendingInputIds: z.array(nonEmptyString),
    queryIds: z.array(nonEmptyString).optional(),
    targetTurnId: nonEmptyString,
    injectedMessageIds: z.array(nonEmptyString),
    drainedInputs: z
      .array(
        z
          .object({
            pendingInputId: nonEmptyString,
            messageId: nonEmptyString,
            text: z.string(),
            delivery: cfTurnSteerDeliverySchema.optional(),
            intent: jsonObjectSchema.optional(),
            toolDisallowlist: z.array(nonEmptyString).optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();
export const cfTurnCompletedEventPayloadSchema = z
  .object({
    response: z.string(),
    tokenCount: z.number().int().nonnegative(),
    usage: z.unknown().optional(),
    toolCallCount: z.number().int().nonnegative(),
    historyRoundCount: z.number().int().nonnegative().optional(),
    duration: z.number().nonnegative(),
    cacheStats: z
      .object({
        totalMessages: z.number().int().nonnegative(),
        cachedMessages: z.number().int().nonnegative(),
        lastCacheHit: z.boolean(),
        cacheReadTokens: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
    inputId: nonEmptyString.optional(),
    resultType: z.enum([
      "success",
      "cancelled",
      "error_max_turns",
      "error_max_budget",
      "error_during_execution",
      "error_max_tool_calls",
    ]),
    backgroundSubagentResultConsumed: z.boolean().optional(),
  })
  .strict();
export const cfTurnFailedEventPayloadSchema = z
  .object({
    error: cfProtocolErrorDetailSchema,
    turnPhase: z.string(),
    inputId: nonEmptyString.optional(),
    backgroundSubagentResultConsumed: z.boolean().optional(),
  })
  .strict();
export const cfMessageUpsertedEventPayloadSchema = z
  .object({
    content: z.string(),
    attachments: z.array(z.unknown()).optional(),
    toolCalls: z.array(z.unknown()).optional(),
    type: z.string().optional(),
    compactBoundary: z.unknown().optional(),
  })
  .strict();
export const cfMessageRemovedEventPayloadSchema = z
  .object({
    messageId: nonEmptyString,
    reason: z.string().optional(),
  })
  .strict();
export const cfMessagePartDeltaEventPayloadSchema = z
  .object({
    messageId: nonEmptyString,
    partId: nonEmptyString,
    field: z.enum(["text", "reasoning", "input", "output"]).optional(),
    delta: z.string(),
  })
  .strict();
export const cfMessagePartUpsertedEventPayloadSchema = z
  .object({
    part: cfMessagePartSchema,
  })
  .strict();
export const cfMessagePartRemovedEventPayloadSchema = z
  .object({
    messageId: nonEmptyString,
    partId: nonEmptyString,
    reason: z.string().optional(),
  })
  .strict();
const cfToolCallBasePayloadSchema = z
  .object({
    toolCallId: nonEmptyString,
    toolName: z.string().optional(),
    parentToolCallId: nonEmptyString.optional(),
    source: z.enum(["subagent"]).optional(),
    agentId: nonEmptyString.optional(),
    agentType: nonEmptyString.optional(),
    background: z.boolean().optional(),
    childSessionId: nonEmptyString.optional(),
    childToolCallId: nonEmptyString.optional(),
    description: z.string().optional(),
  })
  .strict();

export const cfToolUpdatedEventPayloadSchema = z.discriminatedUnion("kind", [
  cfToolCallBasePayloadSchema
    .extend({
      kind: z.literal("scheduled"),
      assistantMessageId: nonEmptyString.optional(),
      toolName: nonEmptyString,
      input: z.unknown().optional(),
      inputByteLength: z.number().int().nonnegative().optional(),
      inputOmitted: z.boolean().optional(),
      inputRef: z.literal("model_stream").optional(),
      dependencies: z.array(nonEmptyString).optional(),
      parallelGroupIndex: z.number().int().nonnegative().optional(),
      canRunParallel: z.boolean().optional(),
      schedule: jsonObjectSchema.optional(),
    })
    .strict(),
  cfToolCallBasePayloadSchema
    .extend({
      kind: z.literal("started"),
      startedAt: protocolInstantSchema,
    })
    .strict(),
  cfToolCallBasePayloadSchema
    .extend({
      kind: z.literal("progress"),
      elapsedMs: z.number().nonnegative().optional(),
      pid: z.number().int().optional(),
      stdoutBytes: z.number().int().nonnegative().optional(),
      stderrBytes: z.number().int().nonnegative().optional(),
      outputBytes: z.number().int().nonnegative().optional(),
      outputPreview: executionOutputPreviewSchema.optional(),
      stdoutTail: z.string().optional(),
      stderrTail: z.string().optional(),
    })
    .strict(),
  cfToolCallBasePayloadSchema
    .extend({
      kind: z.literal("result"),
      result: cfToolResultObjectSchema,
      duration: z.number().nonnegative(),
    })
    .strict(),
  cfToolCallBasePayloadSchema
    .extend({
      kind: z.literal("error"),
      error: cfProtocolErrorDetailSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("batch"),
      toolCallIds: z.array(nonEmptyString),
      successCount: z.number().int().nonnegative(),
      errorCount: z.number().int().nonnegative(),
    })
    .strict(),
  cfToolCallBasePayloadSchema
    .extend({
      kind: z.literal("raw"),
      payload: jsonObjectSchema,
    })
    .strict(),
]);
export const cfPermissionRequestedEventPayloadSchema = z
  .object({
    requestId: nonEmptyString.optional(),
    toolCallId: nonEmptyString,
    toolName: nonEmptyString,
    riskLevel: z.enum(["low", "medium", "high", "critical"]),
    reason: z.string(),
    input: z.unknown(),
    suggestedPermissionUpdates: z.array(cfPermissionUpdateSchema).optional(),
    approvalMode: z.literal("user-once").optional(),
    origin: cfInteractionRequestOriginSchema.optional(),
    options: z.array(cfPermissionOptionSchema).min(1),
    childSessionId: nonEmptyString.optional(),
    background: z.boolean().optional(),
  })
  .strict();
export const cfPermissionResolvedEventPayloadSchema = z
  .object({
    requestId: nonEmptyString.optional(),
    toolCallId: nonEmptyString,
    toolName: nonEmptyString.optional(),
    decision: cfPermissionDecisionSchema.optional(),
    reason: z.string().optional(),
    modifiedInput: z.unknown().optional(),
    inputSummary: z.unknown().optional(),
    childSessionId: nonEmptyString.optional(),
    background: z.boolean().optional(),
  })
  .strict();
export const cfUserInputRequestedEventPayloadSchema = z
  .object({
    requestId: nonEmptyString,
    prompt: z.string(),
    inputType: z.enum(["text", "choice", "confirm"]).optional(),
    choices: z.array(z.string()).optional(),
  })
  .strict();
export const cfUserInputResolvedEventPayloadSchema = z
  .object({
    requestId: nonEmptyString,
    value: z.unknown().optional(),
    cancelled: z.boolean().optional(),
  })
  .strict();
export const cfSessionClosedEventPayloadSchema = z
  .object({
    reason: z.string().optional(),
  })
  .strict();

function cfSessionEventEnvelopeFor<T extends CfSessionEventType>(
  type: T,
  payload: z.ZodTypeAny,
) {
  return cfEventEnvelopeSchema.extend({
    type: z.literal(type),
    payload: payload.optional(),
  });
}

export const cfSessionEventSchema = z.discriminatedUnion("type", [
  cfSessionEventEnvelopeFor("session.created", cfSessionCreatedEventPayloadSchema),
  cfSessionEventEnvelopeFor("session.resumed", cfSessionResumedEventPayloadSchema),
  cfSessionEventEnvelopeFor("session.updated", jsonObjectSchema),
  cfSessionEventEnvelopeFor("session.titleUpdated", cfSessionTitleUpdatedEventPayloadSchema),
  cfSessionEventEnvelopeFor("session.closed", cfSessionClosedEventPayloadSchema),
  cfSessionEventEnvelopeFor("turn.started", cfTurnStartedEventPayloadSchema),
  cfSessionEventEnvelopeFor("turn.steerQueued", cfTurnSteerQueuedEventPayloadSchema),
  cfSessionEventEnvelopeFor("turn.steerDrained", cfTurnSteerDrainedEventPayloadSchema),
  cfSessionEventEnvelopeFor("turn.completed", cfTurnCompletedEventPayloadSchema),
  cfSessionEventEnvelopeFor("turn.failed", cfTurnFailedEventPayloadSchema),
  cfSessionEventEnvelopeFor("message.upserted", cfMessageUpsertedEventPayloadSchema),
  cfSessionEventEnvelopeFor("message.removed", cfMessageRemovedEventPayloadSchema),
  cfSessionEventEnvelopeFor("part.started", cfMessagePartUpsertedEventPayloadSchema),
  cfSessionEventEnvelopeFor("part.delta", cfMessagePartDeltaEventPayloadSchema),
  cfSessionEventEnvelopeFor("part.upserted", cfMessagePartUpsertedEventPayloadSchema),
  cfSessionEventEnvelopeFor("part.removed", cfMessagePartRemovedEventPayloadSchema),
  cfSessionEventEnvelopeFor("model.streaming", cfModelStreamingEventPayloadSchema),
  cfSessionEventEnvelopeFor("tool.updated", cfToolUpdatedEventPayloadSchema),
  cfSessionEventEnvelopeFor("permission.requested", cfPermissionRequestedEventPayloadSchema),
  cfSessionEventEnvelopeFor("permission.resolved", cfPermissionResolvedEventPayloadSchema),
  cfSessionEventEnvelopeFor("userInput.requested", cfUserInputRequestedEventPayloadSchema),
  cfSessionEventEnvelopeFor("userInput.resolved", cfUserInputResolvedEventPayloadSchema),
  cfSessionEventEnvelopeFor("checkpoint.created", jsonObjectSchema),
  cfSessionEventEnvelopeFor("rewind.triggered", jsonObjectSchema),
  cfSessionEventEnvelopeFor("streamRecovery.updated", jsonObjectSchema),
]);
export type CfSessionEvent = z.infer<typeof cfSessionEventSchema>;

export const cfSessionEventsResultSchema = z
  .object({
    events: z.array(cfSessionEventSchema),
  })
  .strict();
export const cfSessionMessagesResultSchema = z
  .object({
    messages: z.array(cfMessageWithPartsSchema),
  })
  .strict();
export const cfStateUpdatedNotificationSchema = z
  .object({
    type: z.literal("state.updated"),
    scope: z.enum(["server", "workspace", "session"]),
    workspace: cfWorkspaceRefSchema.optional(),
    sessionId: nonEmptyString.optional(),
    revision: z.number().int().nonnegative(),
    reason: z.string().optional(),
    patch: z.unknown(),
  })
  .strict();
export type CfStateUpdatedNotification = z.infer<typeof cfStateUpdatedNotificationSchema>;

export const cfSessionSubscribeParamsSchema = z
  .object({
    sessionId: nonEmptyString,
    deliveryKind: cfDeliveryKindSchema,
    afterSeq: z.number().int().nonnegative().optional(),
    includeSnapshot: z.boolean().default(false),
  })
  .strict();
export type CfSessionSubscribeParams = z.infer<typeof cfSessionSubscribeParamsSchema>;

export const cfSessionSubscribeResultSchema = z
  .object({
    sessionId: nonEmptyString,
    eventSeq: z.number().int().nonnegative(),
    events: z.array(cfSessionEventSchema),
    snapshot: cfSessionStateSnapshotSchema.optional(),
  })
  .strict();
export const cfSessionListResultSchema = z
  .object({
    sessions: z.array(cfSessionInfoSchema),
  })
  .strict();

const cfSessionSubagentBaseSchema = z
  .object({
    childSessionId: nonEmptyString,
    agentId: nonEmptyString.optional(),
    toolCallId: nonEmptyString.optional(),
    subagentType: nonEmptyString,
    title: nonEmptyString,
    summary: z.string().optional(),
    startedAt: z.number().int().nonnegative().optional(),
    endedAt: z.number().int().nonnegative().optional(),
  })
  .strict();

export const cfSessionRunningSubagentSchema = cfSessionSubagentBaseSchema.extend({
  status: z.enum(["running", "waiting", "blocked"]),
});
export type CfSessionRunningSubagent = z.infer<typeof cfSessionRunningSubagentSchema>;

export const cfSessionEndedSubagentSchema = cfSessionSubagentBaseSchema.extend({
  status: z.enum(["success", "failed", "cancelled", "lost"]),
});
export type CfSessionEndedSubagent = z.infer<typeof cfSessionEndedSubagentSchema>;

export const cfSessionSubagentsResultSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    childSessionIds: z.array(nonEmptyString),
    running: z.array(cfSessionRunningSubagentSchema),
    ended: z
      .object({
        total: z.number().int().nonnegative(),
        items: z.array(cfSessionEndedSubagentSchema),
        nextCursor: nonEmptyString.optional(),
      })
      .strict(),
  })
  .strict();
export type CfSessionSubagentsResult = z.infer<typeof cfSessionSubagentsResultSchema>;

export const cfDynamicWorkflowModeSchema = z.enum(DYNAMIC_WORKFLOW_MODES);

export const cfSessionCreateParamsSchema = z
  .object({
    additionalDirectories: z.array(nonEmptyString).max(256).optional(),
    sessionId: nonEmptyString.optional(),
    workspace: cfWorkspaceRefSchema,
    parentSessionId: nonEmptyString.optional(),
    mode: cfSessionModeSchema.optional(),
    model: modelSelectionSchema.optional(),
    persistence: cfSessionPersistenceSchema.optional(),
    thoughtLevel: nonEmptyString.optional(),
    titleGenerationEnabled: z.boolean().optional(),
    mcpServers: z.array(cfProtocolMcpServerSchema).optional(),
    toolAllowlist: z.array(nonEmptyString).optional(),
    toolDenylist: z.array(nonEmptyString).optional(),
    importedHistory: cfSessionImportHistorySchema.optional(),
    offPeakToolEnabled: z.boolean().optional(),
    dynamicWorkflowEnabled: z.boolean().optional(),
    dynamicWorkflowMode: cfDynamicWorkflowModeSchema.optional(),
  })
  .strict();
export type CfSessionCreateParams = z.infer<typeof cfSessionCreateParamsSchema>;

export const cfSessionResumeParamsSchema = z
  .object({
    additionalDirectories: z.array(nonEmptyString).max(256).optional(),
    sessionId: nonEmptyString,
    workspace: cfWorkspaceRefSchema.optional(),
    thoughtLevel: nonEmptyString.optional(),
    mcpServers: z.array(cfProtocolMcpServerSchema).optional(),
    toolAllowlist: z.array(nonEmptyString).optional(),
    toolDenylist: z.array(nonEmptyString).optional(),
    offPeakToolEnabled: z.boolean().optional(),
    dynamicWorkflowEnabled: z.boolean().optional(),
    dynamicWorkflowMode: cfDynamicWorkflowModeSchema.optional(),
  })
  .strict();
export type CfSessionResumeParams = z.infer<typeof cfSessionResumeParamsSchema>;

export const cfSessionListParamsSchema = z
  .object({
    workspace: cfWorkspaceRefSchema.optional(),
    sessionIds: z.array(nonEmptyString).min(1).max(64).optional(),
    limit: z.number().int().positive().optional(),
  })
  .strict();
export type CfSessionListParams = z.infer<typeof cfSessionListParamsSchema>;

export const cfSessionSubagentsParamsSchema = z
  .object({
    sessionId: nonEmptyString,
    endedCursor: nonEmptyString.optional(),
    endedLimit: z.number().int().positive().max(100).default(20),
  })
  .strict();
export type CfSessionSubagentsParams = z.infer<typeof cfSessionSubagentsParamsSchema>;

export const cfUsageStatsParamsSchema = z
  .object({
    range: z.enum(APP_USAGE_RANGES),
    timeZone: z.string().optional(),
  })
  .strict();
export const cfUsageStatsResultSchema = appUsageSnapshotSchema;
export const cfTaskTokenUsageParamsSchema = z
  .object({
    sessionId: nonEmptyString,
  })
  .strict();
export const cfTaskTokenUsageResultSchema = z
  .object({
    sessionId: nonEmptyString,
    totalTokens: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    reasoningTokens: z.number().int().nonnegative(),
    cacheCreationTokens: z.number().int().nonnegative(),
    cacheReadTokens: z.number().int().nonnegative(),
    modelRequestCount: z.number().int().nonnegative(),
    modelErrorCount: z.number().int().nonnegative(),
    inputBaselineBySource: z.record(z.string(), z.number().int().nonnegative()),
  })
  .strict();
export type CfTaskTokenUsageResult = z.infer<typeof cfTaskTokenUsageResultSchema>;

export const cfSessionReadParamsSchema = z
  .object({
    sessionId: nonEmptyString,
    deliveryKind: cfDeliveryKindSchema.optional(),
    messageLimit: z.number().int().positive().optional(),
    afterSeq: z.number().int().nonnegative().optional(),
    contentProfile: z.enum(["full", "index"]).optional(),
  })
  .strict();
export type CfSessionReadParams = z.infer<typeof cfSessionReadParamsSchema>;

export const cfSessionMessagesParamsSchema = z
  .object({
    sessionId: nonEmptyString,
    afterMessageId: nonEmptyString.optional(),
    limit: z.number().int().positive().optional(),
  })
  .strict();
export type CfSessionMessagesParams = z.infer<typeof cfSessionMessagesParamsSchema>;

export const cfSessionEventsParamsSchema = z
  .object({
    sessionId: nonEmptyString,
    afterSeq: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive().optional(),
  })
  .strict();
export type CfSessionEventsParams = z.infer<typeof cfSessionEventsParamsSchema>;

export const cfSessionRuntimePreferencesScopeSchema = z.enum([
  "runtime-materialization",
  "user-execution",
]);
export type CfSessionRuntimePreferencesScope = z.infer<
  typeof cfSessionRuntimePreferencesScopeSchema
>;

export {
  subagentRuntimeConfigSchema,
  type SubagentRuntimeConfig,
} from "../subagent-runtime-config.js";
export const cfSubagentsReadRuntimeConfigParamsSchema = z
  .object({ sessionId: nonEmptyString })
  .strict();

export const CF_SESSION_RUNTIME_PREFERENCES_REQUEST_TIMEOUT_MS = 15_000;

export const cfSessionRequestRuntimePreferencesParamsSchema = z
  .object({
    sessionId: nonEmptyString,
    scope: cfSessionRuntimePreferencesScopeSchema,
  })
  .strict();
export type CfSessionRequestRuntimePreferencesParams = z.infer<
  typeof cfSessionRequestRuntimePreferencesParamsSchema
>;

export const DEFAULT_CF_MODEL_CONTEXT_BUDGET_STRATEGY = "preflight-v1" as const;

export const cfModelContextBudgetStrategySchema = z.enum(["legacy", "preflight-v1"]);
export type CfModelContextBudgetStrategy = z.infer<typeof cfModelContextBudgetStrategySchema>;

export const cfSessionRuntimePreferencesResultSchema = z
  .object({
    additionalDirectories: z.array(nonEmptyString).max(256).optional(),
    nativeSearchEnhancementsEnabled: z.boolean(),
    toolSearchMode: appToolSearchModeSchema.default("off"),
    subagentRuntimeConfigEnabled: z.boolean().optional(),
    memoryEnabled: z.boolean().default(false),
    askUserQuestionAutoResolutionEnabled: z.boolean().default(true),
    integratedTerminalShell: integratedTerminalShellSelectionSchema.optional(),
    modelContextBudgetStrategy: cfModelContextBudgetStrategySchema.default(
      DEFAULT_CF_MODEL_CONTEXT_BUDGET_STRATEGY,
    ),
  })
  .strict();
export type CfSessionRuntimePreferencesResult = z.infer<
  typeof cfSessionRuntimePreferencesResultSchema
>;

export const cfBrowserAmbientContextSchema = z
  .object({
    tabCount: z.number().int().positive().max(100),
    currentUrl: z.string().trim().min(1).max(4096).optional(),
  })
  .strict();
export type CfBrowserAmbientContext = z.infer<typeof cfBrowserAmbientContextSchema>;

export const cfSessionSendParamsSchema = z
  .object({
    sessionId: nonEmptyString,
    modelSelection: modelSelectionSchema.optional(),
    modelExecution: modelExecutionSchema.optional(),
    inputId: nonEmptyString.optional(),
    queryId: nonEmptyString.optional(),
    content: z.string(),
    attachments: z.array(jsonObjectSchema).optional(),
    browserAmbientContext: cfBrowserAmbientContextSchema.optional(),
    expectedRevision: z.number().int().nonnegative().optional(),
    expectedProviderRevision: nonEmptyString.optional(),
    automationId: nonEmptyString.optional(),
    offPeakTaskId: nonEmptyString.optional(),
    offPeakRunType: z.enum(["init", "resume"]).optional(),
    botDeliveryTarget: cfAutomationBotDeliveryTargetSchema.optional(),
    toolDenylist: z.array(nonEmptyString).optional(),
  })
  .strict()
  .superRefine((payload, context) => {
    if (payload.automationId && payload.offPeakTaskId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "automationId and offPeakTaskId are mutually exclusive",
      });
    }
    if (payload.offPeakRunType && !payload.offPeakTaskId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "offPeakRunType requires offPeakTaskId",
        path: ["offPeakRunType"],
      });
    }
    if (payload.modelExecution && !payload.modelSelection) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "modelExecution requires modelSelection",
        path: ["modelExecution"],
      });
    }
  });
export const cfSessionSendResultSchema = z
  .object({
    sessionId: nonEmptyString,
    accepted: z.literal(true),
    stateRevision: z.number().int().nonnegative(),
  })
  .strict();
export type CfSessionSendResult = z.infer<typeof cfSessionSendResultSchema>;

export const cfSessionHistoryTargetSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("turn"),
      turnIndex: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("message"),
      messageId: nonEmptyString,
    })
    .strict(),
  z
    .object({
      kind: z.literal("checkpoint"),
      checkpointId: nonEmptyString,
    })
    .strict(),
  z
    .object({
      kind: z.literal("latestCheckpoint"),
    })
    .strict(),
]);
export type CfSessionHistoryTarget = z.infer<typeof cfSessionHistoryTargetSchema>;

export const cfSessionForkParamsSchema = z
  .object({
    sessionId: nonEmptyString,
    target: cfSessionHistoryTargetSchema.default({
      kind: "latestCheckpoint",
    }),
    expectedRevision: z.number().int().nonnegative().optional(),
  })
  .strict();
export type CfSessionForkParams = z.infer<typeof cfSessionForkParamsSchema>;

export const cfSessionForkResultSchema = z
  .object({
    forkedSessionId: nonEmptyString,
    parentSessionId: nonEmptyString.optional(),
    targetMessageId: nonEmptyString.optional(),
    targetCheckpointId: nonEmptyString.optional(),
    response: z.string(),
    snapshot: cfSessionStateSnapshotSchema,
  })
  .strict();
export type CfSessionForkResult = z.infer<typeof cfSessionForkResultSchema>;

export const cfSessionCompactParamsSchema = z
  .object({
    sessionId: nonEmptyString,
    inputId: nonEmptyString.optional(),
    instructions: z.string().optional(),
    expectedRevision: z.number().int().nonnegative().optional(),
  })
  .strict();
export type CfSessionCompactParams = z.infer<typeof cfSessionCompactParamsSchema>;

export const cfSessionCompactResultSchema = z
  .object({
    response: z.string(),
    snapshot: cfSessionStateSnapshotSchema,
    compact: z
      .object({
        state: z.enum(["accepted", "already_running"]),
        inputId: nonEmptyString.optional(),
        operationId: nonEmptyString.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type CfSessionCompactResult = z.infer<typeof cfSessionCompactResultSchema>;

export const cfSessionGoalActionSchema = z.enum([
  "show",
  "set",
  "replace",
  "pause",
  "resume",
  "clear",
]);
export type CfSessionGoalAction = z.infer<typeof cfSessionGoalActionSchema>;

export const cfSessionGoalParamsSchema = z
  .object({
    sessionId: nonEmptyString,
    inputId: nonEmptyString.optional(),
    action: cfSessionGoalActionSchema,
    objective: z.string().optional(),
    expectedRevision: z.number().int().nonnegative().optional(),
  })
  .strict();
export type CfSessionGoalParams = z.infer<typeof cfSessionGoalParamsSchema>;

export const cfSessionGoalResultSchema = z
  .object({
    response: z.string(),
    snapshot: cfSessionStateSnapshotSchema,
    startedTurn: z.boolean().optional(),
  })
  .strict();
export type CfSessionGoalResult = z.infer<typeof cfSessionGoalResultSchema>;

export const cfSessionStopParamsSchema = z
  .object({
    sessionId: nonEmptyString,
  })
  .strict();
const cfBackgroundTaskInfoStatusSchema = z.enum([
  "running",
  "completed",
  "failed",
  "timed_out",
  "cancelled",
  "spawn_error",
  "lost",
]);

export const cfBackgroundTaskInfoSchema = z
  .object({
    taskId: nonEmptyString,
    toolCallId: nonEmptyString.optional(),
    toolName: nonEmptyString.optional(),
    taskKind: z.enum(["bash", "subagent"]).optional(),
    blocked: z.boolean().optional(),
    blockedReason: z.string().optional(),
    cancellable: z.boolean().optional(),
    cancelRequestedAt: protocolInstantSchema.optional(),
    command: z.string().optional(),
    description: z.string().optional(),
    status: cfBackgroundTaskInfoStatusSchema,
    pid: z.number().int().positive().optional(),
    startedAt: protocolInstantSchema.optional(),
    completedAt: protocolInstantSchema.optional(),
    outputPath: z.string().optional(),
    stderrPersistedOutputPath: z.string().optional(),
    stdoutPersistedOutputPath: z.string().optional(),
    outputBytes: z.number().int().nonnegative().optional(),
    outputTruncated: z.boolean().optional(),
    outputTail: z.string().optional(),
    stderrBytes: z.number().int().nonnegative().optional(),
    stderrTail: z.string().optional(),
    stdoutBytes: z.number().int().nonnegative().optional(),
    stdoutTail: z.string().optional(),
    terminalId: nonEmptyString.optional(),
  })
  .strict();
export const cfSessionCancelBackgroundTaskParamsSchema = z
  .object({
    sessionId: nonEmptyString,
    taskId: nonEmptyString,
  })
  .strict();
export type CfSessionCancelBackgroundTaskParams = z.infer<
  typeof cfSessionCancelBackgroundTaskParamsSchema
>;

export const cfSessionCancelBackgroundTaskResultSchema = z
  .object({
    cancelled: z.boolean(),
    reason: z.string().optional(),
    snapshot: cfBackgroundTaskInfoSchema.optional(),
    status: cfBackgroundTaskInfoStatusSchema,
    taskId: nonEmptyString,
  })
  .strict();
export type CfSessionCancelBackgroundTaskResult = z.infer<
  typeof cfSessionCancelBackgroundTaskResultSchema
>;

export const cfSessionSetModelParamsSchema = z
  .object({
    sessionId: nonEmptyString,
    model: modelSelectionSchema,
    expectedRevision: z.number().int().nonnegative().optional(),
    persistAsWorkspaceLastUsed: z.boolean().default(true),
  })
  .strict();
export type CfSessionSetModelParams = z.infer<typeof cfSessionSetModelParamsSchema>;

export const cfSessionSetThoughtLevelParamsSchema = z
  .object({
    sessionId: nonEmptyString,
    thoughtLevel: nonEmptyString.optional(),
    expectedRevision: z.number().int().nonnegative().optional(),
    persistAsWorkspaceLastUsed: z.boolean().default(true),
  })
  .strict();
export type CfSessionSetThoughtLevelParams = z.infer<
  typeof cfSessionSetThoughtLevelParamsSchema
>;

export const cfSessionSetModeParamsSchema = z
  .object({
    sessionId: nonEmptyString,
    mode: cfSessionModeSchema,
    expectedRevision: z.number().int().nonnegative().optional(),
  })
  .strict();
export type CfSessionSetModeParams = z.infer<typeof cfSessionSetModeParamsSchema>;

export const cfSessionCloseParamsSchema = z
  .object({
    sessionId: nonEmptyString,
    expectedPersistence: cfSessionPersistenceSchema.optional(),
  })
  .strict();
export type CfSessionCloseParams = z.infer<typeof cfSessionCloseParamsSchema>;
export const cfSessionCloseResultSchema = z
  .object({
    closed: z.boolean().optional(),
  })
  .strict();
export type CfSessionCloseResult = z.infer<typeof cfSessionCloseResultSchema>;
export const cfWorkspaceReadPresentationParamsSchema = z
  .object({ workspace: cfWorkspaceRefSchema })
  .strict();
export const cfWorkspacePresentationSchema = z
  .object({
    workspace: cfWorkspaceRefSchema,
    mode: cfSessionModeSchema,
    slashCommands: z.array(cfSlashCommandSchema),
  })
  .strict();
export type CfWorkspacePresentation = z.infer<typeof cfWorkspacePresentationSchema>;
const workspaceHookSha256DigestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const cfWorkspaceHookTrustGrantParamsSchema = z
  .object({
    workspace: cfWorkspaceRefSchema,
    bundleDigest: workspaceHookSha256DigestSchema,
    hookDeclarationDigest: workspaceHookSha256DigestSchema,
  })
  .strict();
export type CfWorkspaceHookTrustGrantParams = z.infer<
  typeof cfWorkspaceHookTrustGrantParamsSchema
>;
export const cfWorkspaceHookTrustGrantReasonCodeSchema = z.enum([
  "workspace_hooks_blocked_by_policy",
  "workspace_hooks_bundle_changed",
  "workspace_hooks_snapshot_mismatch",
  "workspace_hooks_policy_requires_pretrust",
  "workspace_hooks_trust_store_corrupt",
  "workspace_hooks_config_unreadable",
]);
export type CfWorkspaceHookTrustGrantReasonCode = z.infer<
  typeof cfWorkspaceHookTrustGrantReasonCodeSchema
>;
export const cfWorkspaceHookTrustGrantResultSchema = z
  .object({
    accepted: z.boolean(),
    reasonCode: cfWorkspaceHookTrustGrantReasonCodeSchema.optional(),
  })
  .strict();
export type CfWorkspaceHookTrustGrantResult = z.infer<
  typeof cfWorkspaceHookTrustGrantResultSchema
>;
const cfWorkspaceModelToolCallSchema = z
  .object({
    id: nonEmptyString,
    name: nonEmptyString,
    input: z.unknown(),
  })
  .strict();
const cfWorkspaceModelMessageSchema = z.discriminatedUnion("role", [
  z.object({ role: z.literal("system"), content: z.string() }).strict(),
  z.object({ role: z.literal("user"), content: z.string() }).strict(),
  z
    .object({
      role: z.literal("assistant"),
      content: z.string(),
      toolCalls: z.array(cfWorkspaceModelToolCallSchema).optional(),
    })
    .strict(),
  z
    .object({
      role: z.literal("tool"),
      content: z.string(),
      toolCallId: nonEmptyString,
      toolName: nonEmptyString,
      isError: z.boolean().optional(),
    })
    .strict(),
]);
const cfWorkspaceModelToolSchema = z
  .object({
    name: nonEmptyString,
    description: z.string().optional(),
    inputSchema: z.record(z.string(), z.unknown()),
  })
  .strict();

export const cfWorkspaceGenerateTextParamsSchema = z
  .object({
    workspace: cfWorkspaceRefSchema,
    selection: modelSelectionSchema,
    prompt: nonEmptyString.optional(),
    messages: z.array(cfWorkspaceModelMessageSchema).min(1).optional(),
    tools: z.array(cfWorkspaceModelToolSchema).optional(),
    querySource: nonEmptyString,
    maxOutputTokens: z.number().int().positive().optional(),
    operationId: nonEmptyString.optional(),
  })
  .strict()
  .refine((value) => value.prompt !== undefined || value.messages !== undefined, {
    message: "prompt 或 messages 至少需要提供一个",
  });
export const cfWorkspaceGenerateTextResultSchema = z
  .object({
    text: z.string(),
    selection: modelSelectionSchema,
    toolCalls: z.array(cfWorkspaceModelToolCallSchema).optional(),
    finishReason: z.string().optional(),
    usage: z
      .object({
        inputTokens: z.number().nonnegative().optional(),
        outputTokens: z.number().nonnegative().optional(),
        totalTokens: z.number().nonnegative().optional(),
        cacheReadTokens: z.number().nonnegative().optional(),
        cacheWriteTokens: z.number().nonnegative().optional(),
        reasoningTokens: z.number().nonnegative().optional(),
        serverToolUse: z
          .object({
            webSearchRequests: z.number().nonnegative().optional(),
            webFetchRequests: z.number().nonnegative().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type CfWorkspaceGenerateTextParams = z.infer<
  typeof cfWorkspaceGenerateTextParamsSchema
>;
export type CfWorkspaceModelMessage = z.infer<typeof cfWorkspaceModelMessageSchema>;
export type CfWorkspaceModelTool = z.infer<typeof cfWorkspaceModelToolSchema>;
export type CfWorkspaceGenerateTextResult = z.infer<
  typeof cfWorkspaceGenerateTextResultSchema
>;
export const cfWorkspaceCancelGenerateTextParamsSchema = z
  .object({ operationId: nonEmptyString })
  .strict();
export const cfWorkspaceCancelGenerateTextResultSchema = z
  .object({ operationId: nonEmptyString, cancelled: z.boolean() })
  .strict();

export const cfProviderTestModelConnectivityParamsSchema = z
  .object({
    workspace: cfWorkspaceRefSchema,
    selection: modelSelectionSchema,
  })
  .strict();
export const cfProviderTestModelConnectivityResultSchema = z
  .object({ success: z.literal(true) })
  .strict();
export type CfProviderTestModelConnectivityParams = z.infer<
  typeof cfProviderTestModelConnectivityParamsSchema
>;
export type CfProviderTestModelConnectivityResult = z.infer<
  typeof cfProviderTestModelConnectivityResultSchema
>;

export const cfProviderUpdateAccountConfigParamsSchema = z
  .object({
    revision: nonEmptyString,
    basedOnCfBuiltinRevision: nonEmptyString,
    providers: z.record(z.string(), z.unknown()),
    states: z.record(
      z.string(),
      z
        .object({
          availability: z.enum(["available", "pending", "unavailable", "unknown"]),
          entitled: z.boolean(),
          unavailableReason: accountProviderUnavailableReasonSchema.optional(),
          current: z.boolean().optional(),
          connectionKey: z.string().optional(),
          effectiveAt: z.number().finite().optional(),
        })
        .strict(),
    ),
  })
  .strict();
export const cfProviderUpdateAccountConfigResultSchema = z
  .object({
    receivedRevision: nonEmptyString,
    providerCount: z.number().int().nonnegative(),
    status: z.enum(["received", "unchanged"]),
  })
  .strict();
export type CfProviderUpdateAccountConfigResult = z.infer<
  typeof cfProviderUpdateAccountConfigResultSchema
>;

export const cfProviderRefreshRegistryParamsSchema = z
  .object({
    reason: nonEmptyString,
  })
  .strict();
export const cfProviderRefreshRegistryResultSchema = z
  .object({
    refreshed: z.literal(true),
  })
  .strict();
export type CfProviderRefreshRegistryParams = z.infer<
  typeof cfProviderRefreshRegistryParamsSchema
>;
export type CfProviderRefreshRegistryResult = z.infer<
  typeof cfProviderRefreshRegistryResultSchema
>;
export const cfInteractionPreferencesSchema = z
  .object({
    askUserQuestionAutoResolutionEnabled: z.boolean(),
  })
  .strict();
export type CfInteractionPreferences = z.infer<typeof cfInteractionPreferencesSchema>;

export const cfWorkspaceUpdateInteractionPreferencesParamsSchema = z
  .object({
    workspace: cfWorkspaceRefSchema,
    preferences: cfInteractionPreferencesSchema,
  })
  .strict();
export type CfWorkspaceUpdateInteractionPreferencesParams = z.infer<
  typeof cfWorkspaceUpdateInteractionPreferencesParamsSchema
>;

export const cfWorkspaceUpdateInteractionPreferencesResultSchema = z
  .object({
    workspace: cfWorkspaceRefSchema,
    askUserQuestionAutoResolutionEnabled: z.boolean(),
    snoozedInteractionCount: z.number().int().nonnegative(),
  })
  .strict();
export type CfWorkspaceUpdateInteractionPreferencesResult = z.infer<
  typeof cfWorkspaceUpdateInteractionPreferencesResultSchema
>;

export const cfModelIoPreferencesSchema = z
  .object({
    fullRetentionEnabled: z.boolean(),
  })
  .strict();
export type CfModelIoPreferences = z.infer<typeof cfModelIoPreferencesSchema>;

export const cfWorkspaceUpdateModelIoPreferencesParamsSchema = z
  .object({
    workspace: cfWorkspaceRefSchema,
    preferences: cfModelIoPreferencesSchema,
  })
  .strict();
export type CfWorkspaceUpdateModelIoPreferencesParams = z.infer<
  typeof cfWorkspaceUpdateModelIoPreferencesParamsSchema
>;

export const cfWorkspaceUpdateModelIoPreferencesResultSchema = z
  .object({
    workspace: cfWorkspaceRefSchema,
    fullRetentionEnabled: z.boolean(),
    updatedSessionCount: z.number().int().nonnegative(),
  })
  .strict();
export type CfWorkspaceUpdateModelIoPreferencesResult = z.infer<
  typeof cfWorkspaceUpdateModelIoPreferencesResultSchema
>;

export const cfWorkspaceUpdateOffPeakToolPolicyParamsSchema = z
  .object({
    workspace: cfWorkspaceRefSchema,
    enabled: z.boolean(),
  })
  .strict();
export type CfWorkspaceUpdateOffPeakToolPolicyParams = z.infer<
  typeof cfWorkspaceUpdateOffPeakToolPolicyParamsSchema
>;

export const cfWorkspaceUpdateOffPeakToolPolicyResultSchema = z
  .object({
    workspace: cfWorkspaceRefSchema,
    enabled: z.boolean(),
  })
  .strict();
export type CfWorkspaceUpdateOffPeakToolPolicyResult = z.infer<
  typeof cfWorkspaceUpdateOffPeakToolPolicyResultSchema
>;

export const cfWorkspaceUpdateDynamicWorkflowPolicyParamsSchema = z
  .object({
    workspace: cfWorkspaceRefSchema,
    enabled: z.boolean(),
    mode: cfDynamicWorkflowModeSchema.optional(),
  })
  .strict();
export type CfWorkspaceUpdateDynamicWorkflowPolicyParams = z.infer<
  typeof cfWorkspaceUpdateDynamicWorkflowPolicyParamsSchema
>;

export const cfWorkspaceUpdateDynamicWorkflowPolicyResultSchema = z
  .object({
    workspace: cfWorkspaceRefSchema,
    enabled: z.boolean(),
  })
  .strict();
export type CfWorkspaceUpdateDynamicWorkflowPolicyResult = z.infer<
  typeof cfWorkspaceUpdateDynamicWorkflowPolicyResultSchema
>;

export const cfPermissionRequestParamsSchema = z
  .object({
    requestId: nonEmptyString,
    sessionId: nonEmptyString,
    turnId: nonEmptyString.optional(),
    toolCallId: nonEmptyString,
    toolName: nonEmptyString,
    reason: z.string(),
    riskLevel: z.enum(["low", "medium", "high", "critical"]),
    input: z.unknown(),
    origin: cfInteractionRequestOriginSchema.optional(),
    options: z.array(cfPermissionOptionSchema).min(1),
  })
  .strict();
export type CfPermissionRequestParams = z.infer<typeof cfPermissionRequestParamsSchema>;

export const cfBrowserListParamsSchema = z
  .object({
    requestId: nonEmptyString,
    sessionId: nonEmptyString,
    turnId: nonEmptyString.optional(),
    workspaceKey: nonEmptyString,
    workspacePath: nonEmptyString,
    workspaceIdentity: nonEmptyString.optional(),
    remoteSessionId: nonEmptyString.optional(),
    clientMode: browserClientModeSchema,
    sessionContext: browserSessionContextKindSchema,
  })
  .strict();
export type CfBrowserListParams = z.infer<typeof cfBrowserListParamsSchema>;

export const cfBrowserListResultSchema = browserBackendListResultSchema;
export type CfBrowserListResult = z.infer<typeof cfBrowserListResultSchema>;

export const cfBrowserExecuteParamsSchema = z
  .object({
    requestId: nonEmptyString,
    sessionId: nonEmptyString,
    turnId: nonEmptyString.optional(),
    browserId: nonEmptyString.optional(),
    browserGeneration: z.number().int().nonnegative().optional(),
    workspaceKey: nonEmptyString.optional(),
    workspacePath: nonEmptyString.optional(),
    workspaceIdentity: nonEmptyString.optional(),
    remoteSessionId: nonEmptyString.optional(),
    clientMode: browserClientModeSchema.optional(),
    sessionContext: browserSessionContextKindSchema.optional(),
    command: browserCommandSchema,
  })
  .strict();
export type CfBrowserExecuteParams = z.infer<typeof cfBrowserExecuteParamsSchema>;

export const cfBrowserExecuteResultSchema = browserCommandResultSchema;
export type CfBrowserExecuteResult = z.infer<typeof cfBrowserExecuteResultSchema>;

export const cfUserInputOptionSchema = z
  .object({
    value: nonEmptyString,
    label: nonEmptyString,
    description: z.string().optional(),
    preview: z.string().optional(),
  })
  .strict();
export const cfUserInputQuestionSchema = z
  .object({
    question: nonEmptyString,
    header: nonEmptyString,
    options: z.array(cfUserInputOptionSchema).min(1),
    multiSelect: z.boolean().optional(),
  })
  .strict();
export type CfUserInputQuestion = z.infer<typeof cfUserInputQuestionSchema>;

export const cfUserInputRequestParamsSchema = z
  .object({
    requestId: nonEmptyString,
    sessionId: nonEmptyString,
    turnId: nonEmptyString.optional(),
    toolCallId: nonEmptyString.optional(),
    toolName: nonEmptyString.optional(),
    prompt: z.string().optional(),
    questions: z.array(cfUserInputQuestionSchema).min(1).optional(),
    input: z.unknown().optional(),
    origin: cfInteractionRequestOriginSchema.optional(),
    schema: z.unknown().optional(),
  })
  .strict();
export type CfUserInputRequestParams = z.infer<typeof cfUserInputRequestParamsSchema>;

export const cfUserInputResponseSchema = z
  .object({
    action: z.enum(["accept", "decline", "cancel"]),
    content: jsonObjectSchema.optional(),
    reason: z.string().optional(),
  })
  .strict();
export type CfUserInputResponse = z.infer<typeof cfUserInputResponseSchema>;

export const cfProviderRuntimeHeadersRequestReasonSchema = z.enum(requestVerificationReasons);
export const cfProviderRuntimeHeadersRequestParamsSchema = z
  .object({
    requestId: nonEmptyString,
    sessionId: nonEmptyString,
    turnId: nonEmptyString.optional(),
    workspace: cfWorkspaceRefSchema,
    modelSelection: modelSelectionSchema,
    providerId: nonEmptyString,
    accountAccess: cfProviderAccountAccessSchema.optional(),
    expectedAccountScope: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    rejectedProjectTokenFingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    reason: cfProviderRuntimeHeadersRequestReasonSchema,
  })
  .strict();
export type CfProviderRuntimeHeadersRequestParams = z.infer<
  typeof cfProviderRuntimeHeadersRequestParamsSchema
>;

export const cfProviderRuntimeHeadersCancelledSchema = z
  .object({
    requestId: nonEmptyString,
    sessionId: nonEmptyString,
    workspace: cfWorkspaceRefSchema,
  })
  .strict();
export type CfProviderRuntimeHeadersCancelled = z.infer<
  typeof cfProviderRuntimeHeadersCancelledSchema
>;

export const cfProviderRuntimeHeadersResponseSchema = z.discriminatedUnion("headersApplied", [
  z
    .object({
      headersApplied: z.literal(true),
      requestAuth: z
        .object({
          apiKey: nonEmptyString.optional(),
          apiKeyId: z.string().trim().min(1).optional(),
          accountScope: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .optional(),
          headers: z.record(nonEmptyString, nonEmptyString).optional(),
        })
        .strict(),
      errorMessage: nonEmptyString.optional(),
    })
    .strict(),
  z
    .object({
      headersApplied: z.literal(false),
      errorMessage: nonEmptyString.optional(),
    })
    .strict(),
]);
export type CfProviderRuntimeHeadersResponse = z.infer<
  typeof cfProviderRuntimeHeadersResponseSchema
>;

export const cfOfficialMcpAuthHeadersRequestParamsSchema = z
  .object({
    requestId: nonEmptyString,
    workspace: cfWorkspaceRefSchema,
    pluginId: nonEmptyString,
    mcpKey: nonEmptyString,
    targetOrigin: nonEmptyString,
  })
  .strict();
export type CfOfficialMcpAuthHeadersRequestParams = z.infer<
  typeof cfOfficialMcpAuthHeadersRequestParamsSchema
>;

export const cfOfficialMcpAuthFailureReasonSchema = z.enum(
  OFFICIAL_MCP_AUTH_PORT_FAILURE_REASONS,
);

export const cfOfficialMcpAuthHeadersResponseSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      headers: z.record(z.string(), z.string()),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      reason: cfOfficialMcpAuthFailureReasonSchema,
    })
    .strict(),
]);
export type CfOfficialMcpAuthHeadersResponse = z.infer<
  typeof cfOfficialMcpAuthHeadersResponseSchema
>;

// ── Plugin management (list + enable/disable) ──
export const cfPluginOptionValueSchema = z.union([z.string(), z.number(), z.boolean()]);
export type CfPluginOptionValue = z.infer<typeof cfPluginOptionValueSchema>;
export const cfPluginScopeSchema = z.enum(["user", "workspace"]);
export type CfPluginScope = z.infer<typeof cfPluginScopeSchema>;
export const cfPluginHookDetailSchema = z
  .object({
    event: nonEmptyString,
    matcher: z.string().optional(),
    type: z.enum(["command", "process"]),
    command: nonEmptyString,
    args: z.array(z.string()).optional(),
    async: z.boolean().optional(),
    shell: z.union([z.literal(true), z.string()]).optional(),
    timeout: z.number().positive().optional(),
    timeoutMs: z.number().int().positive().optional(),
    statusMessage: z.string().optional(),
    sourcePath: z.string(),
    runnable: z.boolean(),
  })
  .strict();
export const cfPluginUserConfigOptionSchema = z
  .object({
    default: cfPluginOptionValueSchema.optional(),
    description: z.string().optional(),
    required: z.boolean().optional(),
    sensitive: z.boolean().optional(),
    title: z.string().optional(),
    type: z.enum(["string", "number", "boolean", "directory", "file"]).optional(),
  })
  .strict();
export type CfPluginUserConfigOption = z.infer<typeof cfPluginUserConfigOptionSchema>;

export const cfPluginComponentKindSchema = z.enum(["agent", "command", "skill", "hook", "mcp"]);
export type CfPluginComponentKind = z.infer<typeof cfPluginComponentKindSchema>;

export const cfPluginComponentItemSchema = z
  .object({
    name: nonEmptyString,
    description: z.string().optional(),
  })
  .strict();
export const cfPluginComponentGroupSchema = z
  .object({
    kind: cfPluginComponentKindSchema,
    items: z.array(cfPluginComponentItemSchema),
  })
  .strict();
export type CfPluginComponentGroup = z.infer<typeof cfPluginComponentGroupSchema>;

export const cfPluginUiSurfaceSchema = z
  .object({
    pluginId: nonEmptyString,
    pluginName: nonEmptyString,
    id: nonEmptyString.max(128),
    title: z.union([nonEmptyString, z.record(z.string(), z.string())]),
    icon: z.string().optional(),
    server: nonEmptyString,
    resourceUri: nonEmptyString.max(2048),
    availability: z.literal("session"),
  })
  .strict();
export type CfPluginUiSurface = z.infer<typeof cfPluginUiSurfaceSchema>;

export const cfPluginInfoSchema = z
  .object({
    id: nonEmptyString,
    name: nonEmptyString,
    description: z.string().optional(),
    version: z.string().optional(),
    enabled: z.boolean(),
    source: nonEmptyString,
    marketplace: nonEmptyString,
    author: z.string().optional(),
    authorUrl: z.string().optional(),
    homepage: z.string().optional(),
    skillCount: z.number().int().nonnegative().optional(),
    skillRootCount: z.number().int().nonnegative(),
    commandRootCount: z.number().int().nonnegative(),
    components: z.array(cfPluginComponentGroupSchema).optional(),
    uiSurfaces: z.array(cfPluginUiSurfaceSchema).optional(),
    declaredMcpServerNames: z.array(z.string()).optional(),
    hostMcpServerNames: z.array(z.string()).optional(),
    mcpServerNames: z.array(z.string()),
    hookDetails: z.array(cfPluginHookDetailSchema).optional(),
    rootPath: z.string(),
    userConfig: z.record(z.string(), cfPluginUserConfigOptionSchema).optional(),
    configuredOptions: z.record(z.string(), cfPluginOptionValueSchema).optional(),
    packageStatus: z.literal("missing").optional(),
    rootSource: cfPluginScopeSchema.optional(),
    enabledSource: cfPluginScopeSchema.optional(),
    optionSources: z.record(z.string(), cfPluginScopeSchema).optional(),
  })
  .strict();
export type CfPluginInfo = z.infer<typeof cfPluginInfoSchema>;

export const cfPluginDiagnosticSchema = z
  .object({
    code: z.string(),
    message: z.string(),
    severity: z.enum(["warning", "error"]).optional(),
    pluginId: z.string().optional(),
  })
  .strict();
export type CfPluginDiagnostic = z.infer<typeof cfPluginDiagnosticSchema>;

export const cfPluginsListParamsSchema = z
  .object({
    workspace: cfWorkspaceRefSchema,
    configScope: cfPluginScopeSchema.optional(),
  })
  .strict();
export const cfPluginsListResultSchema = z
  .object({
    plugins: z.array(cfPluginInfoSchema),
    diagnostics: z.array(cfPluginDiagnosticSchema),
  })
  .strict();
export type CfPluginsListResult = z.infer<typeof cfPluginsListResultSchema>;

export const cfPluginsListUiSurfacesParamsSchema = z
  .object({ workspace: cfWorkspaceRefSchema })
  .strict();
export type CfPluginsListUiSurfacesParams = z.infer<
  typeof cfPluginsListUiSurfacesParamsSchema
>;
export const cfPluginsListUiSurfacesResultSchema = z
  .object({ surfaces: z.array(cfPluginUiSurfaceSchema) })
  .strict();
export type CfPluginsListUiSurfacesResult = z.infer<
  typeof cfPluginsListUiSurfacesResultSchema
>;

export const cfPluginReferenceCatalogEntrySchema = z
  .object({
    category: nonEmptyString.optional(),
    pluginId: nonEmptyString,
    name: nonEmptyString,
    marketplace: nonEmptyString,
    icon: z.string().optional(),
    displayName: z.string().optional(),
    displayNameI18n: z.record(z.string(), z.string()).optional(),
    description: z.string().optional(),
    descriptionI18n: z.record(z.string(), z.string()).optional(),
    enabled: z.boolean(),
    conflictingPluginIds: z.array(nonEmptyString),
    skillQualifiedNames: z.array(nonEmptyString),
    mcpServerNames: z.array(nonEmptyString),
    subagentNames: z.array(nonEmptyString).default([]),
  })
  .strict();
export type CfPluginReferenceCatalogEntry = z.infer<
  typeof cfPluginReferenceCatalogEntrySchema
>;

export const cfPluginsReferenceCatalogParamsSchema = z
  .object({
    workspace: cfWorkspaceRefSchema,
    sessionId: nonEmptyString.optional(),
  })
  .strict();
export type CfPluginsReferenceCatalogParams = z.infer<
  typeof cfPluginsReferenceCatalogParamsSchema
>;
export const cfPluginsReferenceCatalogResultSchema = z
  .object({
    authority: z.enum(["session", "workspace"]),
    plugins: z.array(cfPluginReferenceCatalogEntrySchema),
  })
  .strict();
export type CfPluginsReferenceCatalogResult = z.infer<
  typeof cfPluginsReferenceCatalogResultSchema
>;

export const cfSkillReferenceCatalogEntrySchema = z
  .object({
    id: nonEmptyString,
    name: nonEmptyString,
    description: z.string(),
    path: nonEmptyString,
    scope: z.enum(["workspace", "user", "plugin"]),
    enabled: z.literal(true),
    pluginName: nonEmptyString.optional(),
  })
  .strict();
export type CfSkillReferenceCatalogEntry = z.infer<typeof cfSkillReferenceCatalogEntrySchema>;

export const cfSkillsReferenceCatalogParamsSchema = z
  .object({
    workspace: cfWorkspaceRefSchema,
    sessionId: nonEmptyString.optional(),
  })
  .strict();
export type CfSkillsReferenceCatalogParams = z.infer<
  typeof cfSkillsReferenceCatalogParamsSchema
>;
export const cfSkillsReferenceCatalogResultSchema = z
  .object({
    authority: z.enum(["session", "workspace"]),
    skills: z.array(cfSkillReferenceCatalogEntrySchema),
  })
  .strict();
export type CfSkillsReferenceCatalogResult = z.infer<
  typeof cfSkillsReferenceCatalogResultSchema
>;

export const cfSavedWorkflowArgTypeSchema = z.enum(["string", "number", "boolean", "json"]);
export type CfSavedWorkflowArgType = z.infer<typeof cfSavedWorkflowArgTypeSchema>;
export const cfSavedWorkflowArgDeclarationSchema = z
  .object({
    type: cfSavedWorkflowArgTypeSchema,
    description: z.string().optional(),
    required: z.boolean().optional(),
    default: z.unknown().optional(),
  })
  .strict();
export type CfSavedWorkflowArgDeclaration = z.infer<
  typeof cfSavedWorkflowArgDeclarationSchema
>;
export const cfSavedWorkflowArgsDeclarationSchema = z.record(
  z.string(),
  cfSavedWorkflowArgDeclarationSchema,
);
export type CfSavedWorkflowArgsDeclaration = z.infer<
  typeof cfSavedWorkflowArgsDeclarationSchema
>;
export const cfSavedWorkflowMetaSchema = z
  .object({
    description: nonEmptyString,
    whenToUse: nonEmptyString.optional(),
    args: cfSavedWorkflowArgsDeclarationSchema.optional(),
  })
  .strict();
export type CfSavedWorkflowMeta = z.infer<typeof cfSavedWorkflowMetaSchema>;
export const cfSavedWorkflowScopeSchema = z.enum(["project", "global"]);
export type CfSavedWorkflowScope = z.infer<typeof cfSavedWorkflowScopeSchema>;
export const cfSavedWorkflowEntrySchema = z
  .object({
    name: nonEmptyString,
    description: z.string(),
    whenToUse: z.string().optional(),
    args: cfSavedWorkflowArgsDeclarationSchema.optional(),
    scope: cfSavedWorkflowScopeSchema,
    path: nonEmptyString,
  })
  .strict();
export type CfSavedWorkflowEntry = z.infer<typeof cfSavedWorkflowEntrySchema>;
export const cfSavedWorkflowInvalidEntrySchema = z
  .object({ path: nonEmptyString, reason: nonEmptyString })
  .strict();
export type CfSavedWorkflowInvalidEntry = z.infer<typeof cfSavedWorkflowInvalidEntrySchema>;

export const cfSavedWorkflowFailureReasonSchema = z.enum([
  "invalid_name",
  "not_found",
  "parse_error",
  "read_error",
]);
export type CfSavedWorkflowFailureReason = z.infer<typeof cfSavedWorkflowFailureReasonSchema>;
const cfSavedWorkflowFailureSchema = z
  .object({
    ok: z.literal(false),
    reason: cfSavedWorkflowFailureReasonSchema,
    detail: z.string().optional(),
  })
  .strict();

export const cfWorkflowsListParamsSchema = z
  .object({
    workspace: cfWorkspaceRefSchema,
    scope: cfSavedWorkflowScopeSchema.optional(),
  })
  .strict();
export type CfWorkflowsListParams = z.infer<typeof cfWorkflowsListParamsSchema>;
export const cfWorkflowsListResultSchema = z
  .object({
    workflows: z.array(cfSavedWorkflowEntrySchema),
    invalid: z.array(cfSavedWorkflowInvalidEntrySchema),
    dir: nonEmptyString,
  })
  .strict();
export type CfWorkflowsListResult = z.infer<typeof cfWorkflowsListResultSchema>;

export const cfWorkflowsGetParamsSchema = z
  .object({
    workspace: cfWorkspaceRefSchema,
    name: nonEmptyString,
    scope: cfSavedWorkflowScopeSchema.optional(),
  })
  .strict();
export type CfWorkflowsGetParams = z.infer<typeof cfWorkflowsGetParamsSchema>;
export const cfWorkflowsGetResultSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      name: nonEmptyString,
      path: nonEmptyString,
      scope: cfSavedWorkflowScopeSchema,
      meta: cfSavedWorkflowMetaSchema,
      
      script: z.string(),
    })
    .strict(),
  cfSavedWorkflowFailureSchema,
]);
export type CfWorkflowsGetResult = z.infer<typeof cfWorkflowsGetResultSchema>;

export const cfWorkflowsUpdateMetaParamsSchema = z
  .object({
    workspace: cfWorkspaceRefSchema,
    name: nonEmptyString,
    meta: cfSavedWorkflowMetaSchema,
    scope: cfSavedWorkflowScopeSchema.optional(),
  })
  .strict();
export type CfWorkflowsUpdateMetaParams = z.infer<typeof cfWorkflowsUpdateMetaParamsSchema>;
export const cfWorkflowsUpdateMetaResultSchema = z.union([
  z.object({ ok: z.literal(true), path: nonEmptyString }).strict(),
  cfSavedWorkflowFailureSchema,
]);
export type CfWorkflowsUpdateMetaResult = z.infer<typeof cfWorkflowsUpdateMetaResultSchema>;

export const cfWorkflowsDeleteParamsSchema = z
  .object({
    workspace: cfWorkspaceRefSchema,
    name: nonEmptyString,
    scope: cfSavedWorkflowScopeSchema.optional(),
  })
  .strict();
export type CfWorkflowsDeleteParams = z.infer<typeof cfWorkflowsDeleteParamsSchema>;
export const cfWorkflowsDeleteResultSchema = z.union([
  z.object({ ok: z.literal(true), path: nonEmptyString }).strict(),
  cfSavedWorkflowFailureSchema,
]);
export type CfWorkflowsDeleteResult = z.infer<typeof cfWorkflowsDeleteResultSchema>;

export const CF_WORKFLOWS_RUNS_MAX_LIMIT = 50;
export const cfWorkflowsRunsParamsSchema = z
  .object({
    workspace: cfWorkspaceRefSchema,
    
    name: nonEmptyString.optional(),
    limit: z.number().int().min(1).max(CF_WORKFLOWS_RUNS_MAX_LIMIT),
    scope: cfSavedWorkflowScopeSchema.optional(),
  })
  .strict();
export type CfWorkflowsRunsParams = z.infer<typeof cfWorkflowsRunsParamsSchema>;
export const cfSavedWorkflowRunStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "errored",
  "stopped",
]);
export type CfSavedWorkflowRunStatus = z.infer<typeof cfSavedWorkflowRunStatusSchema>;
export const cfSavedWorkflowRunStopReasonSchema = z.enum([
  "user",
  "model",
  "provider",
  "interrupted",
  "superseded",
]);
export const cfSavedWorkflowRunSchema = z
  .object({
    runId: nonEmptyString,
    name: z.string().optional(),
    status: cfSavedWorkflowRunStatusSchema,
    stopReason: cfSavedWorkflowRunStopReasonSchema.optional(),
    createdAt: z.number(),
    updatedAt: z.number(),
    spentTokens: z.number(),
    
    parentSessionId: z.string().optional(),
    toolCallId: z.string().optional(),
    args: z.record(z.string(), z.unknown()).optional(),
    cwd: z.string().optional(),
    artifacts: z
      .array(
        z
          .object({
            id: nonEmptyString,
            kind: z.enum(["file", "markdown", "chart", "table", "metrics", "board"]),
            title: z.string().optional(),
            version: z.number(),
            contentType: z.string().optional(),
          })
          .strict(),
      )
      .max(8)
      .optional(),
  })
  .strict();
export type CfSavedWorkflowRun = z.infer<typeof cfSavedWorkflowRunSchema>;
export const cfWorkflowsRunsResultSchema = z
  .object({
    runs: z.array(cfSavedWorkflowRunSchema),
    
    truncated: z.literal(true).optional(),
  })
  .strict();
export type CfWorkflowsRunsResult = z.infer<typeof cfWorkflowsRunsResultSchema>;

export const cfWorkflowsMoveParamsSchema = z
  .object({
    workspace: cfWorkspaceRefSchema,
    name: nonEmptyString,
  })
  .strict();
export type CfWorkflowsMoveParams = z.infer<typeof cfWorkflowsMoveParamsSchema>;
export const cfWorkflowsMoveResultSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      
      from: nonEmptyString,
      
      to: nonEmptyString,
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      reason: z.enum(["invalid_name", "not_found", "target_exists", "read_error", "write_error"]),
      path: z.string().optional(),
      detail: z.string().optional(),
    })
    .strict(),
]);
export type CfWorkflowsMoveResult = z.infer<typeof cfWorkflowsMoveResultSchema>;

// run, and running it again」）──

export const cfSavedWorkflowShadowingSchema = z.enum(["hides_global", "hidden_by_project"]);
export type CfSavedWorkflowShadowing = z.infer<typeof cfSavedWorkflowShadowingSchema>;

export const cfWorkflowsSaveParamsSchema = z
  .object({
    workspace: cfWorkspaceRefSchema,
    runId: nonEmptyString,
    name: nonEmptyString,
    meta: cfSavedWorkflowMetaSchema,
    scope: cfSavedWorkflowScopeSchema.optional(),
    overwrite: z.boolean().optional(),
  })
  .strict();
export type CfWorkflowsSaveParams = z.infer<typeof cfWorkflowsSaveParamsSchema>;
export const cfWorkflowsSaveResultSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      name: nonEmptyString,
      scope: cfSavedWorkflowScopeSchema,
      path: nonEmptyString,
      
      overwritten: z.boolean(),
      shadowing: cfSavedWorkflowShadowingSchema.optional(),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      reason: z.enum([
        "invalid_name",
        "run_not_found",
        "script_missing",
        "target_exists",
        "compile_failed",
        "write_error",
      ]),
      path: z.string().optional(),
      detail: z.string().optional(),
    })
    .strict(),
]);
export type CfWorkflowsSaveResult = z.infer<typeof cfWorkflowsSaveResultSchema>;

export const cfWorkflowsForRunCandidateSchema = z
  .object({ name: nonEmptyString, scope: cfSavedWorkflowScopeSchema.optional() })
  .strict();
export type CfWorkflowsForRunCandidate = z.infer<typeof cfWorkflowsForRunCandidateSchema>;

export const CF_WORKFLOWS_FOR_RUN_MAX_CANDIDATES = 8;
export const cfWorkflowsForRunParamsSchema = z
  .object({
    workspace: cfWorkspaceRefSchema,
    runId: nonEmptyString,
    candidates: z
      .array(cfWorkflowsForRunCandidateSchema)
      .max(CF_WORKFLOWS_FOR_RUN_MAX_CANDIDATES)
      .optional(),
  })
  .strict();
export type CfWorkflowsForRunParams = z.infer<typeof cfWorkflowsForRunParamsSchema>;
export const cfWorkflowsForRunResultSchema = z
  .object({
    
    entry: cfSavedWorkflowEntrySchema.optional(),
    
    match: z.enum(["candidate", "script", "name"]).optional(),
    
    runArgs: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type CfWorkflowsForRunResult = z.infer<typeof cfWorkflowsForRunResultSchema>;

export const cfPluginSuggestedReferenceStatusSchema = z.enum([
  "ready",
  "disabled",
  "missing",
  "conflict",
  "unavailable",
]);
export type CfPluginSuggestedReferenceStatus = z.infer<
  typeof cfPluginSuggestedReferenceStatusSchema
>;
export const cfPluginOperationStateSchema = z.enum([
  "checking",
  "refreshing",
  "installing",
  "enabling",
  "cancelling",
  "cancelled",
  "complete",
  "failed",
]);
export type CfPluginOperationState = z.infer<typeof cfPluginOperationStateSchema>;
export const cfPluginOperationProgressNotificationSchema = z
  .object({
    operationId: nonEmptyString,
    state: z.literal("refreshing"),
  })
  .strict();
export type CfPluginOperationProgressNotification = z.infer<
  typeof cfPluginOperationProgressNotificationSchema
>;
export const cfPluginsResolveSuggestedReferenceParamsSchema = z
  .object({
    workspace: cfWorkspaceRefSchema,
    stableId: nonEmptyString,
    operationId: nonEmptyString,
    clientMode: cfDeliveryKindSchema,
    deliveryKind: cfDeliveryKindSchema,
  })
  .strict();
export type CfPluginsResolveSuggestedReferenceParams = z.infer<
  typeof cfPluginsResolveSuggestedReferenceParamsSchema
>;
export const cfPluginsSetEnabledParamsSchema = z
  .object({
    workspace: cfWorkspaceRefSchema,
    pluginId: nonEmptyString,
    enabled: z.boolean(),
    operationId: nonEmptyString.optional(),
    scope: cfPluginScopeSchema.optional(),
  })
  .strict();
export const cfPluginsSetEnabledResultSchema = z
  .object({
    plugin: cfPluginInfoSchema,
    enabled: z.boolean(),
  })
  .strict();
export type CfPluginsSetEnabledResult = z.infer<typeof cfPluginsSetEnabledResultSchema>;

export const cfPluginStoreListingSchema = z
  .object({
    displayName: z.string().optional(),
    displayNameI18n: z.record(z.string(), z.string()).optional(),
    descriptionI18n: z.record(z.string(), z.string()).optional(),
    icon: z.string().optional(),
    category: z.string().optional(),
    publisherType: z.enum(["official", "community"]).optional(),
    author: z.string().optional(),
    authorUrl: z.string().optional(),
    homepage: z.string().optional(),
    privacyPolicy: z.string().optional(),
    termsOfService: z.string().optional(),
    heroImage: z.string().optional(),
    examplePrompts: z.array(z.string()).optional(),
    examplePromptsI18n: z.record(z.string(), z.array(z.string())).optional(),
    
    requiresPaidPlan: z.boolean().optional(),
  })
  .strict();
export type CfPluginStoreListing = z.infer<typeof cfPluginStoreListingSchema>;

export const cfPluginsResolveSuggestedReferenceResultSchema = z
  .object({
    stableId: nonEmptyString,
    status: cfPluginSuggestedReferenceStatusSchema,
    marketplace: nonEmptyString.optional(),
    pluginName: nonEmptyString.optional(),
    sourceTrust: z.literal("official").optional(),
    icon: z.string().optional(),
    listing: cfPluginStoreListingSchema.optional(),
    diagnostics: z.array(cfPluginDiagnosticSchema),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status !== "ready" && value.status !== "disabled" && value.status !== "missing") {
      return;
    }
    if (!value.marketplace || !value.pluginName || value.sourceTrust !== "official") {
      context.addIssue({
        code: "custom",
        message: "actionable suggested Plugin results require trusted install identity",
      });
    }
  });
export type CfPluginsResolveSuggestedReferenceResult = z.infer<
  typeof cfPluginsResolveSuggestedReferenceResultSchema
>;

export const cfPluginMarketplaceSummarySchema = z
  .object({
    id: nonEmptyString,
    name: nonEmptyString,
    source: jsonObjectSchema,
    description: z.string().optional(),
    lastUpdated: z.string().optional(),
    pluginCount: z.number().int().nonnegative(),
    isOfficial: z.boolean().optional(),
    featured: z.array(z.string()).optional(),
    refreshFailure: z
      .object({
        code: z.string(),
        failedAt: z.string(),
        message: z.string(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type CfPluginMarketplaceSummary = z.infer<typeof cfPluginMarketplaceSummarySchema>;

export const cfAvailablePluginSummarySchema = z
  .object({
    id: nonEmptyString,
    name: nonEmptyString,
    marketplace: nonEmptyString,
    description: z.string().optional(),
    version: z.string().optional(),
    installed: z.boolean(),
    componentTypes: z.array(z.string()).optional(),
    listing: cfPluginStoreListingSchema.optional(),
  })
  .strict();
export type CfAvailablePluginSummary = z.infer<typeof cfAvailablePluginSummarySchema>;

export const cfInstalledPluginSummarySchema = z
  .object({
    id: nonEmptyString,
    name: nonEmptyString,
    marketplace: nonEmptyString,
    description: z.string().optional(),
    version: z.string().optional(),
    enabled: z.boolean(),
    scope: cfPluginScopeSchema,
    installPath: z.string().optional(),
    installedAt: z.string().optional(),
    componentTypes: z.array(z.string()).optional(),
    hookDetails: z.array(cfPluginHookDetailSchema).optional(),
    updateStatus: z.enum(["none", "update-available", "version-changed"]).optional(),
    latestVersion: z.string().optional(),
    listing: cfPluginStoreListingSchema.optional(),
  })
  .strict();
export type CfInstalledPluginSummary = z.infer<typeof cfInstalledPluginSummarySchema>;

export const cfPluginsOverviewParamsSchema = z
  .object({
    workspace: cfWorkspaceRefSchema,
    configScope: cfPluginScopeSchema.optional(),
  })
  .strict();
export const cfPluginsOverviewResultSchema = z
  .object({
    marketplaces: z.array(cfPluginMarketplaceSummarySchema),
    availablePlugins: z.array(cfAvailablePluginSummarySchema),
    installedPlugins: z.array(cfInstalledPluginSummarySchema),
    restorableBuiltins: z.array(cfAvailablePluginSummarySchema),
    diagnostics: z.array(cfPluginDiagnosticSchema),
    capability: z
      .object({
        supported: z.boolean(),
        reason: z.string().optional(),
      })
      .strict(),
  })
  .strict();
export type CfPluginsOverviewResult = z.infer<typeof cfPluginsOverviewResultSchema>;

export const cfPluginsMarketplaceAddParamsSchema = z
  .object({
    workspace: cfWorkspaceRefSchema,
    source: nonEmptyString,
    dryRun: z.boolean().optional(),
    operationId: nonEmptyString.optional(),
  })
  .strict();
export const cfPluginsMarketplaceRemoveParamsSchema = z
  .object({
    workspace: cfWorkspaceRefSchema,
    marketplace: nonEmptyString,
  })
  .strict();
export const cfPluginsMarketplaceUpdateParamsSchema = z
  .object({
    workspace: cfWorkspaceRefSchema,
    marketplace: nonEmptyString.optional(),
    operationId: nonEmptyString.optional(),
  })
  .strict();
export const cfPluginsMarketplaceMutationResultSchema = z
  .object({
    marketplace: cfPluginMarketplaceSummarySchema.optional(),
    marketplaces: z.array(cfPluginMarketplaceSummarySchema).optional(),
    diagnostics: z.array(cfPluginDiagnosticSchema).optional(),
  })
  .strict();
export type CfPluginsMarketplaceMutationResult = z.infer<
  typeof cfPluginsMarketplaceMutationResultSchema
>;

export const cfPluginsInstallParamsSchema = z
  .object({
    workspace: cfWorkspaceRefSchema,
    pluginName: nonEmptyString,
    marketplace: nonEmptyString,
    scope: cfPluginScopeSchema.optional(),
    dryRun: z.boolean().optional(),
    operationId: nonEmptyString.optional(),
  })
  .strict();
export const cfPluginsCancelOperationParamsSchema = z
  .object({
    operationId: nonEmptyString,
  })
  .strict();
export type CfPluginsCancelOperationParams = z.infer<
  typeof cfPluginsCancelOperationParamsSchema
>;

export const cfPluginsCancelOperationResultSchema = z
  .object({
    operationId: nonEmptyString,
    cancelled: z.boolean(),
  })
  .strict();
export type CfPluginsCancelOperationResult = z.infer<
  typeof cfPluginsCancelOperationResultSchema
>;
export const cfPluginsUninstallParamsSchema = z
  .object({
    workspace: cfWorkspaceRefSchema,
    pluginId: nonEmptyString.optional(),
    pluginName: nonEmptyString.optional(),
    marketplace: nonEmptyString.optional(),
    removeCache: z.boolean().optional(),
  })
  .strict();
export const cfPluginsInstallResultSchema = z
  .object({
    installedPlugins: z.array(cfInstalledPluginSummarySchema),
    dependencyClosure: z.array(z.string()),
    diagnostics: z.array(cfPluginDiagnosticSchema),
  })
  .strict();
export type CfPluginsInstallResult = z.infer<typeof cfPluginsInstallResultSchema>;

export const cfPluginsUninstallResultSchema = z
  .object({
    removedPlugin: cfInstalledPluginSummarySchema.optional(),
    diagnostics: z.array(cfPluginDiagnosticSchema),
  })
  .strict();
export type CfPluginsUninstallResult = z.infer<typeof cfPluginsUninstallResultSchema>;

export const cfPluginsUpdateParamsSchema = z
  .object({
    workspace: cfWorkspaceRefSchema,
    pluginId: nonEmptyString.optional(),
    marketplace: nonEmptyString.optional(),
  })
  .strict();
export const cfPluginsRestoreBuiltinParamsSchema = z
  .object({
    workspace: cfWorkspaceRefSchema,
    pluginId: nonEmptyString,
  })
  .strict();
export const cfPluginsRestoreBuiltinResultSchema = z
  .object({
    pluginId: nonEmptyString,
    diagnostics: z.array(cfPluginDiagnosticSchema),
  })
  .strict();
export type CfPluginsRestoreBuiltinResult = z.infer<
  typeof cfPluginsRestoreBuiltinResultSchema
>;

export const cfPluginsConfigureParamsSchema = z
  .object({
    workspace: cfWorkspaceRefSchema,
    pluginId: nonEmptyString,
    options: jsonObjectSchema,
    clearOptionKeys: z.array(nonEmptyString).optional(),
    scope: cfPluginScopeSchema.optional(),
    dryRun: z.boolean().optional(),
  })
  .strict();
export const cfPluginsConfigureResultSchema = z
  .object({
    pluginId: nonEmptyString,
    diagnostics: z.array(cfPluginDiagnosticSchema),
  })
  .strict();
export type CfPluginsConfigureResult = z.infer<typeof cfPluginsConfigureResultSchema>;

export const cfPluginsResetConfigParamsSchema = z
  .object({
    workspace: cfWorkspaceRefSchema,
    pluginId: nonEmptyString,
    scope: cfPluginScopeSchema.optional(),
  })
  .strict();
export type CfPluginsResetConfigParams = z.infer<typeof cfPluginsResetConfigParamsSchema>;

export const cfPluginsValidateParamsSchema = z
  .object({
    workspace: cfWorkspaceRefSchema,
    pluginName: nonEmptyString.optional(),
    marketplace: nonEmptyString.optional(),
    source: nonEmptyString.optional(),
  })
  .strict();
export const cfPluginsValidateResultSchema = z
  .object({
    ok: z.boolean(),
    diagnostics: z.array(cfPluginDiagnosticSchema),
    compatibility: z
      .object({
        runnable: z.array(z.string()),
        diagnosticOnly: z.array(z.string()),
        unsupported: z.array(z.string()),
      })
      .strict(),
  })
  .strict();
export type CfPluginsValidateResult = z.infer<typeof cfPluginsValidateResultSchema>;

export const cfPluginsDescribeParamsSchema = z
  .object({
    workspace: cfWorkspaceRefSchema,
    pluginName: nonEmptyString,
    marketplace: nonEmptyString,
  })
  .strict();
export const cfPluginsDescribeResultSchema = z
  .object({
    components: z.array(cfPluginComponentGroupSchema),
    diagnostics: z.array(cfPluginDiagnosticSchema).optional(),
    metadata: z
      .object({
        author: z.string().optional(),
        authorUrl: z.string().optional(),
        homepage: z.string().optional(),
        version: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type CfPluginsDescribeResult = z.infer<typeof cfPluginsDescribeResultSchema>;

export const cfAutomationScheduleRuleSchema = z
  .object({
    unit: z.enum(["minute", "hourly", "daily", "weekly", "monthly", "yearly"]),
    interval: z.number().int().positive(),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59),
    anchorAt: z.number().int(),
    weekdays: z.array(z.number().int().min(0).max(6)).optional(),
    monthDays: z.array(z.number().int().min(1).max(31)).optional(),
    
    months: z.array(z.number().int().min(1).max(12)).optional(),
    monthlyMode: z.enum(["date", "weekday"]).optional(),
  })
  .strict();
export type CfAutomationScheduleRuleProtocol = z.infer<typeof cfAutomationScheduleRuleSchema>;

export const cfAutomationIntervalUnitSchema = z.enum([
  "minute",
  "hourly",
  "daily",
  "weekly",
  "monthly",
  "yearly",
]);

export const cfAutomationProtocolSchema = z
  .object({
    automationId: nonEmptyString,
    title: z.string(),
    cronExpr: nonEmptyString,
    prompt: nonEmptyString,
    modelSelection: modelSelectionSchema.optional(),
    mode: cfTaskModeSchema.optional(),
    targetTaskId: nonEmptyString.optional(),
    enabled: z.boolean(),
    lifecycleStatus: z.enum(["active", "completed", "failed", "paused"]),
    nextRunAt: timestampMsSchema.optional(),
    lastRunAt: timestampMsSchema.optional(),
    runCount: z.number().int().nonnegative(),
    recurring: z.boolean(),
    maxRuns: z.number().int().positive().optional(),
    scheduleRule: cfAutomationScheduleRuleSchema.optional(),
  })
  .strict();
export type CfAutomationProtocol = z.infer<typeof cfAutomationProtocolSchema>;

export const cfAutomationCreateParamsSchema = z
  .object({
    title: z.string().optional(),
    cronExpr: nonEmptyString,
    relativeDelayMinutes: z.number().int().positive().max(525_600).optional(),
    prompt: nonEmptyString,
    modelSelection: modelSelectionSchema.optional(),
    mode: cfTaskModeSchema.optional(),
    targetTaskId: nonEmptyString.optional(),
    botDeliveryTarget: cfAutomationBotDeliveryTargetSchema.optional(),
    recurring: z.boolean().optional(),
    maxRuns: z.number().int().positive().optional(),
    intervalUnit: cfAutomationIntervalUnitSchema.optional(),
    interval: z.number().int().min(1).max(200).optional(),
  })
  .strict()
  .refine((input) => (input.intervalUnit === undefined) === (input.interval === undefined), {
    message: "intervalUnit and interval must be set together",
    path: ["interval"],
  })
  .refine((input) => input.intervalUnit === undefined || input.relativeDelayMinutes === undefined, {
    message: "intervalUnit cannot combine with a relative delayMinutes",
    path: ["intervalUnit"],
  })
  .refine((input) => input.intervalUnit === undefined || input.recurring !== false, {
    message: "intervalUnit is a recurring carrier and cannot combine with recurring=false",
    path: ["recurring"],
  })
  .refine((input) => input.intervalUnit === undefined || input.maxRuns === undefined, {
    message: "intervalUnit is a recurring carrier and cannot combine with maxRuns",
    path: ["maxRuns"],
  });
export type CfAutomationCreateProtocolParams = z.infer<typeof cfAutomationCreateParamsSchema>;

export const cfAutomationCreateResultSchema = z
  .object({ automation: cfAutomationProtocolSchema })
  .strict();
export type CfAutomationCreateProtocolResult = z.infer<typeof cfAutomationCreateResultSchema>;

export const cfAutomationUpdateParamsSchema = z
  .object({
    automationId: nonEmptyString,
    title: nonEmptyString.optional(),
    cronExpr: nonEmptyString.optional(),
    prompt: nonEmptyString.optional(),
    recurring: z.boolean().optional(),
    maxRuns: z.number().int().positive().nullable().optional(),
    intervalUnit: cfAutomationIntervalUnitSchema.optional(),
    interval: z.number().int().min(1).max(200).optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.title !== undefined ||
      input.cronExpr !== undefined ||
      input.prompt !== undefined ||
      input.recurring !== undefined ||
      input.maxRuns !== undefined ||
      input.intervalUnit !== undefined,
    { message: "automation update requires at least one field" },
  )
  .refine((input) => input.maxRuns !== null || input.recurring === true, {
    message: "clearing maxRuns requires recurring=true",
    path: ["maxRuns"],
  })
  .refine((input) => input.recurring !== true || typeof input.maxRuns !== "number", {
    message: "recurring=true cannot be combined with a numeric maxRuns",
    path: ["maxRuns"],
  })
  .refine((input) => (input.intervalUnit === undefined) === (input.interval === undefined), {
    message: "intervalUnit and interval must be set together",
    path: ["interval"],
  })
  .refine((input) => input.intervalUnit === undefined || input.recurring !== false, {
    message: "intervalUnit is a recurring carrier and cannot combine with recurring=false",
    path: ["recurring"],
  })
  .refine(
    (input) =>
      input.intervalUnit === undefined ||
      input.maxRuns === undefined ||
      (input.maxRuns === null && input.recurring === true),
    {
      message:
        "intervalUnit is a recurring carrier and only allows maxRuns=null with recurring=true",
      path: ["maxRuns"],
    },
  );
export type CfAutomationUpdateProtocolParams = z.infer<typeof cfAutomationUpdateParamsSchema>;
export const cfAutomationUpdateResultSchema = z
  .object({ automation: cfAutomationProtocolSchema })
  .strict();
export type CfAutomationUpdateProtocolResult = z.infer<typeof cfAutomationUpdateResultSchema>;

export const cfAutomationListParamsSchema = z.object({}).strict();
export type CfAutomationListProtocolParams = z.infer<typeof cfAutomationListParamsSchema>;
export const cfAutomationListResultSchema = z
  .object({ automations: z.array(cfAutomationProtocolSchema) })
  .strict();
export type CfAutomationListProtocolResult = z.infer<typeof cfAutomationListResultSchema>;

export const cfAutomationCheckTaskBindingParamsSchema = z
  .object({ targetTaskId: nonEmptyString })
  .strict();
export type CfAutomationCheckTaskBindingProtocolParams = z.infer<
  typeof cfAutomationCheckTaskBindingParamsSchema
>;
export const cfAutomationCheckTaskBindingResultSchema = z
  .object({ bound: z.boolean() })
  .strict();
export type CfAutomationCheckTaskBindingProtocolResult = z.infer<
  typeof cfAutomationCheckTaskBindingResultSchema
>;

export const cfAutomationDeleteParamsSchema = z
  .object({ automationId: nonEmptyString })
  .strict();
export type CfAutomationDeleteProtocolParams = z.infer<typeof cfAutomationDeleteParamsSchema>;
export const cfAutomationDeleteResultSchema = z.object({ deleted: z.boolean() }).strict();
export type CfAutomationDeleteProtocolResult = z.infer<typeof cfAutomationDeleteResultSchema>;

export const cfOffPeakPermissionModeSchema = z.enum([
  "build",
  "edit",
  "plan",
  "yolo",
  "guarded",
]);
export type CfOffPeakProtocolPermissionMode = z.infer<typeof cfOffPeakPermissionModeSchema>;

export const cfOffPeakCreateParamsSchema = z
  .object({
    title: nonEmptyString,
    prompt: nonEmptyString,
    permissionMode: cfOffPeakPermissionModeSchema.optional(),
    model: nonEmptyString.optional(),
    thoughtLevel: nonEmptyString.optional(),
    boundSessionId: nonEmptyString.optional(),
  })
  .strict();
export type CfOffPeakCreateProtocolParams = z.infer<typeof cfOffPeakCreateParamsSchema>;

export const cfOffPeakTaskSnapshotSchema = z
  .object({
    offPeakTaskId: nonEmptyString,
    title: z.string(),
    status: z.enum(["queued", "paused", "running", "completed", "failed", "cancelled"]),
    queuePosition: z.number().int().positive().optional(),
    sessionId: nonEmptyString.optional(),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();
export type CfOffPeakTaskProtocolSnapshot = z.infer<typeof cfOffPeakTaskSnapshotSchema>;

export const cfOffPeakCreateResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), task: cfOffPeakTaskSnapshotSchema }).strict(),
  z
    .object({
      ok: z.literal(false),
      failureStage: z.enum(["client_validation", "ticket_request", "local_persist"]),
      errorCategory: z.enum([
        "client_validation",
        "eligibility_3101",
        "quota_3103",
        "network",
        "invalid_response",
        "local_persist",
        "unknown",
      ]),
      errorCode: z.string(),
    })
    .strict(),
]);
export type CfOffPeakCreateProtocolResult = z.infer<typeof cfOffPeakCreateResultSchema>;

export const cfOffPeakListParamsSchema = z.object({}).strict();
export type CfOffPeakListProtocolParams = z.infer<typeof cfOffPeakListParamsSchema>;
export const cfOffPeakListResultSchema = z
  .object({ tasks: z.array(cfOffPeakTaskSnapshotSchema) })
  .strict();
export type CfOffPeakListProtocolResult = z.infer<typeof cfOffPeakListResultSchema>;

export const cfProtocolMethods = {
  runtimeCapabilities: "runtime/capabilities",
  computerUseOperationEvent: "computer-use/operation-event",
  sessionCreate: "session/create",
  sessionResume: "session/resume",
  sessionList: "session/list",
  sessionSubagents: "session/subagents",
  sessionRequestRuntimePreferences: "session/requestRuntimePreferences",
  subagentsReadRuntimeConfig: "subagents/readRuntimeConfig",
  sessionRead: "session/read",
  sessionMessages: "session/messages",
  sessionEvents: "session/events",
  sessionDebug: "session/debug",
  sessionSubscribe: "session/subscribe",
  sessionSend: "session/send",
  sessionStop: "session/stop",
  sessionCancelBackgroundTask: "session/cancelBackgroundTask",
  sessionFork: "session/fork",
  sessionCompact: "session/compact",
  sessionGoal: "session/goal",
  sessionClose: "session/close",
  sessionSetModel: "session/setModel",
  sessionSetThoughtLevel: "session/setThoughtLevel",
  sessionSetMode: "session/setMode",
  workspaceReadPresentation: "workspace/readPresentation",
  workspaceHookTrustGrant: "workspace/hooks/trustGrant",
  providerUpdateAccountConfig: "provider/updateAccountConfig",
  providerRefreshRegistry: "provider/refreshRegistry",
  workspaceUpdateInteractionPreferences: "workspace/updateInteractionPreferences",
  workspaceUpdateModelIoPreferences: "workspace/updateModelIoPreferences",
  workspaceUpdateOffPeakToolPolicy: "workspace/updateOffPeakToolPolicy",
  workspaceUpdateDynamicWorkflowPolicy: "workspace/updateDynamicWorkflowPolicy",
  workspaceGenerateText: "workspace/generateText",
  workspaceCancelGenerateText: "workspace/cancelGenerateText",
  providerTestModelConnectivity: "provider/testModelConnectivity",
  mcpList: "mcp/list",
  mcpReadResource: "mcp/readResource",
  mcpUiOpenInstance: "mcp/uiOpenInstance",
  mcpUiCloseInstance: "mcp/uiCloseInstance",
  mcpUiValidateInstance: "mcp/uiValidateInstance",
  mcpUiSampling: "mcp/uiSampling",
  mcpUiCancelSampling: "mcp/uiCancelSampling",
  mcpUiCallTool: "mcp/uiCallTool",
  mcpUiCancelCall: "mcp/uiCancelCall",
  mcpUiReadResource: "mcp/uiReadResource",
  mcpUiListResources: "mcp/uiListResources",
  mcpUiListResourceTemplates: "mcp/uiListResourceTemplates",
  mcpUiSubscribeResource: "mcp/uiSubscribeResource",
  mcpUiUnsubscribeResource: "mcp/uiUnsubscribeResource",
  mcpUiRegisterAppTools: "mcp/uiRegisterAppTools",
  mcpUiUnregisterAppTools: "mcp/uiUnregisterAppTools",
  mcpUiClaimAppToolCall: "mcp/uiClaimAppToolCall",
  mcpUiResolveAppToolCall: "mcp/uiResolveAppToolCall",
  pluginsList: "plugins/list",
  pluginsReferenceCatalog: "plugins/referenceCatalog",
  pluginsListUiSurfaces: "plugins/listUiSurfaces",
  pluginsReferenceCatalogWithCategory: "plugins/referenceCatalogWithCategory",
  skillsReferenceCatalog: "skills/referenceCatalog",
  workflowsList: "workflows/list",
  workflowsGet: "workflows/get",
  workflowsUpdateMeta: "workflows/updateMeta",
  workflowsDelete: "workflows/delete",
  workflowsRuns: "workflows/runs",
  workflowsMove: "workflows/move",
  workflowsSave: "workflows/save",
  workflowsForRun: "workflows/forRun",
  pluginsResolveSuggestedReference: "plugins/resolveSuggestedReference",
  pluginsSetEnabled: "plugins/setEnabled",
  pluginsOverview: "plugins/overview",
  pluginsMarketplaceAdd: "plugins/marketplace/add",
  pluginsMarketplaceRemove: "plugins/marketplace/remove",
  pluginsMarketplaceUpdate: "plugins/marketplace/update",
  pluginsInstall: "plugins/install",
  pluginsCancelOperation: "plugins/cancelOperation",
  pluginsUninstall: "plugins/uninstall",
  pluginsUpdate: "plugins/update",
  pluginsRestoreBuiltin: "plugins/restoreBuiltin",
  pluginsConfigure: "plugins/configure",
  pluginsResetConfig: "plugins/resetConfig",
  pluginsValidate: "plugins/validate",
  pluginsDescribe: "plugins/describe",
  automationCreate: "automation/create",
  topicResourceRead: "topic/resource/read",
  channelReply: "bot/channel/reply",
  topicResourceCancel: "topic/resource/cancel",
  automationUpdate: "automation/update",
  automationCheckTaskBinding: "automation/checkTaskBinding",
  automationList: "automation/list",
  automationDelete: "automation/delete",
  offPeakCreate: "offPeak/create",
  offPeakList: "offPeak/list",
  usageStats: "usage/stats",
  sessionUsage: "session/usage",
  processChildProcesses: "process/childProcesses",
  processNetworkCapture: "process/networkCapture",
  interactionRequestPermission: "interaction/requestPermission",
  interactionRequestUserInput: "interaction/requestUserInput",
  interactionRequestProviderRuntimeHeaders: "interaction/requestProviderRuntimeHeaders",
  interactionRequestOfficialMcpAuthHeaders: "interaction/requestOfficialMcpAuthHeaders",
  interactionBrowserList: "interaction/browserList",
  interactionBrowserExecute: "interaction/browserExecute",
} as const;

export type CfProtocolMethod = (typeof cfProtocolMethods)[keyof typeof cfProtocolMethods];

export const cfProtocolEmptyResultSchema = z.object({}).strict();

export const cfProtocolSessionMethodContracts = {
  [cfProtocolMethods.mcpUiOpenInstance]: {
    params: cfMcpUiOpenInstanceParamsSchema,
    result: cfMcpUiOpenInstanceResultSchema,
  },
  [cfProtocolMethods.mcpUiCloseInstance]: {
    params: cfMcpUiCloseInstanceParamsSchema,
    result: cfMcpUiCloseInstanceResultSchema,
  },
  [cfProtocolMethods.mcpUiValidateInstance]: {
    params: cfMcpUiCloseInstanceParamsSchema,
    result: cfMcpUiResourceSubscriptionResultSchema,
  },
  [cfProtocolMethods.workspaceHookTrustGrant]: {
    params: cfWorkspaceHookTrustGrantParamsSchema,
    result: cfWorkspaceHookTrustGrantResultSchema,
  },
  [cfProtocolMethods.mcpList]: {
    params: cfMcpListParamsSchema,
    result: cfMcpListResultSchema,
  },
  [cfProtocolMethods.mcpReadResource]: {
    params: cfMcpReadResourceParamsSchema,
    result: cfMcpReadResourceResultSchema,
  },
  [cfProtocolMethods.mcpUiSampling]: {
    params: cfMcpUiSamplingParamsSchema,
    result: cfMcpUiSamplingResultSchema,
  },
  [cfProtocolMethods.mcpUiCancelSampling]: {
    params: cfMcpUiCancelSamplingParamsSchema,
    result: cfMcpUiCancelCallResultSchema,
  },
  [cfProtocolMethods.mcpUiCallTool]: {
    params: cfMcpUiCallToolParamsSchema,
    result: cfMcpUiCallToolResultSchema,
  },
  [cfProtocolMethods.mcpUiCancelCall]: {
    params: cfMcpUiCancelCallParamsSchema,
    result: cfMcpUiCancelCallResultSchema,
  },
  [cfProtocolMethods.mcpUiReadResource]: {
    params: cfMcpUiReadResourceParamsSchema,
    result: cfMcpUiReadResourceResultSchema,
  },
  [cfProtocolMethods.mcpUiListResources]: {
    params: cfMcpUiListResourcesParamsSchema,
    result: cfMcpUiListResourcesResultSchema,
  },
  [cfProtocolMethods.mcpUiListResourceTemplates]: {
    params: cfMcpUiListResourcesParamsSchema,
    result: cfMcpUiListResourceTemplatesResultSchema,
  },
  [cfProtocolMethods.mcpUiSubscribeResource]: {
    params: cfMcpUiResourceSubscriptionParamsSchema,
    result: cfMcpUiResourceSubscriptionResultSchema,
  },
  [cfProtocolMethods.mcpUiUnsubscribeResource]: {
    params: cfMcpUiResourceSubscriptionParamsSchema,
    result: cfMcpUiResourceSubscriptionResultSchema,
  },
  [cfProtocolMethods.mcpUiRegisterAppTools]: {
    params: cfMcpUiRegisterAppToolsParamsSchema,
    result: cfMcpUiRegisterAppToolsResultSchema,
  },
  [cfProtocolMethods.mcpUiUnregisterAppTools]: {
    params: cfMcpUiUnregisterAppToolsParamsSchema,
    result: cfMcpUiUnregisterAppToolsResultSchema,
  },
  [cfProtocolMethods.mcpUiClaimAppToolCall]: {
    params: cfMcpUiClaimAppToolCallParamsSchema,
    result: cfMcpUiAppToolAcceptedResultSchema,
  },
  [cfProtocolMethods.mcpUiResolveAppToolCall]: {
    params: cfMcpUiResolveAppToolCallParamsSchema,
    result: cfMcpUiAppToolAcceptedResultSchema,
  },
  [cfProtocolMethods.interactionBrowserList]: {
    params: cfBrowserListParamsSchema,
    result: cfBrowserListResultSchema,
  },
  [cfProtocolMethods.interactionBrowserExecute]: {
    params: cfBrowserExecuteParamsSchema,
    result: cfBrowserExecuteResultSchema,
  },
} as const satisfies Partial<
  Record<CfProtocolMethod, { params: z.ZodTypeAny; result: z.ZodTypeAny }>
>;

export type CfProtocolSessionMethodContract =
  (typeof cfProtocolSessionMethodContracts)[keyof typeof cfProtocolSessionMethodContracts];

export {
  STORAGE_MIGRATION_COMMAND,
  storageMigrationReportSchema,
} from "../sqlite-migrations/contract.js";

export const cfStoragePreparationFrameSchema = z.discriminatedUnion("method", [
  z
    .object({
      method: z.literal("startup/storagePath"),
      params: z.object({ path: z.string().min(1).max(32768) }).strict(),
    })
    .strict(),
  z
    .object({ method: z.literal("startup/storagePrepared"), params: z.object({}).strict() })
    .strict(),
  z
    .object({ method: z.literal("startup/storageState"), params: cfStorageStartupStateSchema })
    .strict(),
]);
export const cfStoragePathReadySchema = z
  .object({ method: z.literal("startup/storagePathReady"), reuse: z.boolean().optional() })
  .strict();

export { localTtftFactsSchema } from "../localTtft.js";
export {
  botIdentitySchema,
  botTopicInputMessageSchema,
  botGroupInputSourceSchema,
  type BotGroupInputSource,
} from "../bots.js";
export {
  botTopicContextSchema,
  botTopicMessageSchema,
  type BotTopicHistoryBatch,
  type BotTopicMessage,
} from "../bots.js";
