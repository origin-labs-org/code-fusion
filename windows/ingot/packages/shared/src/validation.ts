import { mobilePluginDiscoveryTelemetrySchema } from "./telemetry.js";
import { databaseStartupControlSchema, databaseStartupStateSchema } from "./database-startup.js";
import { mcpAppInstanceSchema } from "./mcp-apps/instance.js";
import {
  automationSessionCreateTelemetrySchema,
  sessionCreateTelemetrySchema,
} from "./sessionCreateTelemetry.js";

import { z } from "zod";
import { networkCaptureControlSchema, networkCaptureBatchSchema } from "./networkCapture.js";
import { browserCommandSchema } from "./browser-use/commands.js";
import { browserCommandResultSchema } from "./browser-use/result.js";
import { modelSelectionSchema } from "./model-selection.js";
import { localeSchema } from "./validationAppSettings.js";
import { cfProcessDiagnosticSchema } from "./process-diagnostic.js";
import { PROCESS_RESOURCE_CLI_LANES } from "./processResourceTelemetry.js";
import {
  providerProvisioningErrorCodeSchema,
  providerProvisioningTriggerSchema,
} from "./provider-provisioning.js";
import { cfProviderSchema } from "./providers.js";
import { REMOTE_ASSET_INSTALL_MODES } from "./remoteAssetInstallMode.js";
import { isKnownRemoteResourcePackageId } from "./remoteResourcePackages.js";
import type { WebRemoteControlAppPayload } from "./web-remote-control.js";
import { PROTOCOL_V4_LIMITS } from "./cf-protocol-v4/core.js";
import { sourceServerArtifactPolicySchema } from "./source-server/release.js";
import { sessionWorkflowActivitySchema } from "./cf-protocol-v4/sessions-index-workflow-activity.js";
import {
  webRemoteControlRpcTransportAckSchema,
  webRemoteControlRpcTransportFrameSchema,
} from "./web-remote-control-rpc-transport.js";
import {
  taskOwnerCommandDeliverySchema,
  taskOwnerCommandRequestSchema,
  taskOwnerCommandResultSchema,
  taskRealtimeDeliveredEventSchema,
  taskRealtimeEventSchema,
  taskRealtimeHostDeliveryKindSchema,
  taskRunLeaseAcquireRequestSchema,
  taskRunLeaseResultSchema,
  taskRunLeaseTargetSchema,
  taskStreamMirrorPublishOpSchema,
  taskStreamMirrorTargetSchema,
} from "./task-realtime-core.js";
import { wslUserSchema } from "./wslUserValidation.js";
import { legacyCfProviderSchema } from "./cf-agent-policy.js";
import { errorAttributionSchema } from "./cf-protocol-v4/snapshot.js";
import {
  cfMcpResourceSamplesSchema,
  cfMcpTelemetryEventSchema,
  cfProcessResourceSampleSchema,
  cfToolExecResourceSchema,
} from "./cf-protocol/index.js";
import { cfTaskModeSchema } from "./cf-task-mode-schema.js";

export {
  appSettingsOccupationEnum,
  appSettingsPatchSchema,
  appSettingsSchema,
  localeSchema,
  postUpdateReleaseNotesPayloadSchema,
} from "./validationAppSettings.js";
export { isValidWslUser, WSL_USER_MAX_LENGTH, wslUserSchema } from "./wslUserValidation.js";
export { cfTaskModeSchema } from "./cf-task-mode-schema.js";

export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

export const nonEmptyStringSchema = z.string().trim().min(1);
export const stringArraySchema = z.array(z.string());
const webRemoteControlTransportIdSchema = nonEmptyStringSchema
  .max(PROTOCOL_V4_LIMITS.transportEnvelopeIdMaxChars)
  .regex(/^[A-Za-z0-9._~-]+$/u);

export const webRemoteControlWorkspaceTargetSchema = z.object({
  workspacePath: nonEmptyStringSchema,
  workspaceIdentity: nonEmptyStringSchema.optional(),
  remoteSessionId: nonEmptyStringSchema.optional(),
  label: nonEmptyStringSchema,
  workspacePurpose: z.enum(["project", "conversation"]).optional(),
  kind: z.enum(["local", "remote"]),
  connectionState: z.enum(["connected", "disconnected", "reconnecting"]).optional(),
  lastConnectionError: z.string().optional(),
});

export const webRemoteControlWorkspaceTargetsSchema = z.array(
  webRemoteControlWorkspaceTargetSchema,
);

export const webRemoteControlReconnectWorkspaceRequestSchema = z.object({
  requestId: nonEmptyStringSchema,
  workspaceKey: nonEmptyStringSchema,
});

export const webRemoteControlReconnectWorkspaceResultSchema = z.union([
  z.object({
    requestId: nonEmptyStringSchema,
    workspaceKey: nonEmptyStringSchema,
    success: z.literal(true),
  }),
  z.object({
    requestId: nonEmptyStringSchema,
    workspaceKey: nonEmptyStringSchema,
    success: z.literal(false),
    error: z.string(),
  }),
]);

export const webRemoteControlFailureReasonSchema = z.enum([
  "session-not-found",
  "session-expired",
  "session-conflict",
  "workspace-closed",
  "desktop-disconnected",
  "invalid-mobile-connection",
  "desktop-bootstrap-timeout",
  "connection-recovery-timeout",
  "relay-unavailable",
  "unsupported-action",
  "unexpected-error",
]);

export const webRemoteControlExternalWorkspaceBridgeSchema = z.discriminatedUnion("kind", [
  z.object({
    bridgeSessionId: webRemoteControlTransportIdSchema,
    bridgeGeneration: z.number().int().nonnegative().optional(),
    recoveryId: webRemoteControlTransportIdSchema.optional(),
    kind: z.literal("local"),
    workspaceKey: nonEmptyStringSchema,
    workspacePath: nonEmptyStringSchema,
    initialTaskId: nonEmptyStringSchema.optional(),
  }),
  z.object({
    bridgeSessionId: webRemoteControlTransportIdSchema,
    bridgeGeneration: z.number().int().nonnegative().optional(),
    recoveryId: webRemoteControlTransportIdSchema.optional(),
    kind: z.literal("remote"),
    workspaceKey: nonEmptyStringSchema,
    workspacePath: nonEmptyStringSchema,
    workspaceIdentity: nonEmptyStringSchema,
    workspacePurpose: z.enum(["project", "conversation"]).optional(),
    remoteSessionId: nonEmptyStringSchema,
    initialTaskId: nonEmptyStringSchema.optional(),
    capabilities: z.object({ windowProjectDirectory: z.literal(true).optional() }).optional(),
  }),
]);

export const webRemoteControlMobileViewStateSchema = z.object({
  activeWorkspaceKey: nonEmptyStringSchema.optional(),
  activeTaskId: nonEmptyStringSchema.optional(),
  updatedAt: z.number().finite(),
});

export const webRemoteControlMobileTaskViewSchema = z
  .object({
    workspacePath: nonEmptyStringSchema,
    workspaceIdentity: nonEmptyStringSchema.optional(),
    taskId: nonEmptyStringSchema,
  })
  .strict();

export const webRemoteControlMobileDeviceInfoSchema = z.object({
  platform: nonEmptyStringSchema,
  version: nonEmptyStringSchema,
  name: nonEmptyStringSchema,
  userAgent: z.string().optional(),
  language: z.string().optional(),
  languages: z.array(z.string()).optional(),
  browserPlatform: z.string().optional(),
  viewport: z
    .object({
      width: z.number().finite(),
      height: z.number().finite(),
      devicePixelRatio: z.number().finite(),
    })
    .optional(),
  screen: z
    .object({
      width: z.number().finite(),
      height: z.number().finite(),
    })
    .optional(),
  timezone: z.string().optional(),
  online: z.boolean().optional(),
  updatedAt: z.number().finite(),
});

export const webRemoteControlWindowBootstrapResultSchema = z.object({
  windowControlSessionId: nonEmptyStringSchema,
  desktopAppVersion: nonEmptyStringSchema.optional(),
  workspaces: webRemoteControlWorkspaceTargetsSchema,
  initialViewState: webRemoteControlMobileViewStateSchema.optional(),
  mobileViewState: webRemoteControlMobileViewStateSchema.optional(),
  mobileTaskViewEpoch: webRemoteControlTransportIdSchema.optional(),
});

export const webRemoteControlWorkspaceListResultSchema = z.object({
  workspaces: webRemoteControlWorkspaceTargetsSchema,
  activeWorkspaceKey: nonEmptyStringSchema.optional(),
  activeTaskId: nonEmptyStringSchema.optional(),
});

export const webRemoteControlPlatformMethodSchema = z.enum([
  "isDockerAvailable",
  "listWSLDistros",
  "listDockerContainers",
  "listSSHConfigAliases",
  "loadMcpFromUserDirectory",
  "saveMcpToUserDirectory",
  "migrateLegacyCommonMcp",
]);

const webRemoteControlAppPayloadSchemas = [
  z
    .object({
      cf_type: z.literal("telemetry-report"),
      event: z.union([sessionCreateTelemetrySchema, mobilePluginDiscoveryTelemetrySchema]),
    })
    .strict(),
  z.object({
    cf_type: z.literal("bootstrap-request"),
    requestId: nonEmptyStringSchema,
  }),
  z.object({
    cf_type: z.literal("bootstrap-response"),
    requestId: nonEmptyStringSchema,
    success: z.literal(true),
    result: webRemoteControlWindowBootstrapResultSchema,
  }),
  z.object({
    cf_type: z.literal("workspace-list-request"),
    requestId: nonEmptyStringSchema,
  }),
  z.object({
    cf_type: z.literal("workspace-list-response"),
    requestId: nonEmptyStringSchema,
    success: z.literal(true),
    result: webRemoteControlWorkspaceListResultSchema,
  }),
  z.object({
    cf_type: z.literal("workspace-list-updated"),
    result: webRemoteControlWorkspaceListResultSchema,
  }),
  z
    .object({
      cf_type: z.literal("workspace-bridge-open"),
      requestId: nonEmptyStringSchema,
      bridgeSessionId: webRemoteControlTransportIdSchema,
      bridgeGeneration: z.number().int().nonnegative().optional(),
      recoveryId: webRemoteControlTransportIdSchema.optional(),
      workspaceKey: nonEmptyStringSchema,
      taskId: nonEmptyStringSchema.optional(),
      taskHostId: nonEmptyStringSchema.optional(),
      fileTreeTaskId: nonEmptyStringSchema.optional(),
      project: z
        .object({
          projectId: nonEmptyStringSchema.nullable(),
          hostId: nonEmptyStringSchema.optional(),
          draftId: z.string().uuid().optional(),
          reuseDraft: z.boolean().optional(),
        })
        .strict()
        .refine(
          (intent) =>
            (!intent.draftId || intent.projectId === null) &&
            (!intent.reuseDraft || Boolean(intent.draftId)),
          "Only an unclassified draft can reuse its directory",
        )
        .optional(),
    })
    .refine(
      (request) =>
        (!request.project || (!request.taskId && !request.fileTreeTaskId)) &&
        !(request.taskId && request.fileTreeTaskId) &&
        (!request.fileTreeTaskId || Boolean(request.taskHostId)) &&
        (!request.taskHostId || Boolean(request.taskId || request.fileTreeTaskId)),
      "Project draft cannot target an existing task",
    ),
  z.object({
    cf_type: z.literal("workspace-bridge-ready"),
    requestId: nonEmptyStringSchema,
    bridgeSessionId: webRemoteControlTransportIdSchema,
    bridgeGeneration: z.number().int().nonnegative().optional(),
    recoveryId: webRemoteControlTransportIdSchema.optional(),
    bridge: webRemoteControlExternalWorkspaceBridgeSchema,
  }),
  z.object({
    cf_type: z.literal("workspace-bridge-error"),
    requestId: nonEmptyStringSchema,
    bridgeSessionId: webRemoteControlTransportIdSchema.optional(),
    bridgeGeneration: z.number().int().nonnegative().optional(),
    recoveryId: webRemoteControlTransportIdSchema.optional(),
    reason: webRemoteControlFailureReasonSchema,
    error: z.string(),
  }),
  z.object({
    cf_type: z.literal("workspace-reconnect-request"),
    requestId: nonEmptyStringSchema,
    workspaceKey: nonEmptyStringSchema,
  }),
  z.object({
    cf_type: z.literal("workspace-reconnect-response"),
    requestId: nonEmptyStringSchema,
    workspaceKey: nonEmptyStringSchema,
    success: z.literal(true),
  }),
  z.object({
    cf_type: z.literal("workspace-reconnect-response"),
    requestId: nonEmptyStringSchema,
    workspaceKey: nonEmptyStringSchema,
    success: z.literal(false),
    error: z.string(),
  }),
  z.object({
    cf_type: z.literal("mobile-view-state-update"),
    viewState: webRemoteControlMobileViewStateSchema,
    deviceInfo: webRemoteControlMobileDeviceInfoSchema.optional(),
  }),
  z
    .object({
      cf_type: z.literal("mobile-task-view-update"),
      epoch: webRemoteControlTransportIdSchema,
      seq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      bridgeSessionId: webRemoteControlTransportIdSchema,
      bridgeGeneration: z.number().int().nonnegative().optional(),
      view: webRemoteControlMobileTaskViewSchema.nullable(),
    })
    .strict(),
  z
    .object({
      cf_type: z.literal("mobile-task-view-request"),
      epoch: webRemoteControlTransportIdSchema,
    })
    .strict(),
  z.object({
    cf_type: z.literal("platform-request"),
    requestId: nonEmptyStringSchema,
    method: webRemoteControlPlatformMethodSchema,
    args: z.unknown().optional(),
  }),
  z.object({
    cf_type: z.literal("platform-response"),
    requestId: nonEmptyStringSchema,
    method: webRemoteControlPlatformMethodSchema,
    success: z.literal(true),
    result: z.unknown(),
  }),
  z.object({
    cf_type: z.literal("platform-response"),
    requestId: nonEmptyStringSchema,
    method: webRemoteControlPlatformMethodSchema,
    success: z.literal(false),
    error: z.string(),
  }),
  webRemoteControlRpcTransportFrameSchema,
  webRemoteControlRpcTransportAckSchema,
  z.object({
    cf_type: z.literal("bridge-degraded"),
    bridgeSessionId: webRemoteControlTransportIdSchema,
    bridgeGeneration: z.number().int().nonnegative().optional(),
    recoveryId: webRemoteControlTransportIdSchema.optional(),
    reason: z.enum([
      "rpc-transport-fault",
      "rpc-frame-gap",
      "buffer-overflow",
      "buffer-timeout",
      "source-session-replaced",
    ]),
    seq: z.number().int().nonnegative().optional(),
    expectedSeq: z.number().int().nonnegative().optional(),
    droppedCount: z.number().int().nonnegative().optional(),
  }),
  z.object({
    cf_type: z.literal("app-error"),
    requestId: nonEmptyStringSchema.optional(),
    bridgeSessionId: webRemoteControlTransportIdSchema.optional(),
    reason: webRemoteControlFailureReasonSchema,
    error: z.string(),
  }),
  z.object({
    cf_type: z.literal("mobile-diagnostic"),
    event: z.enum([
      "state-transition",
      "socket-close",
      "socket-error",
      "recover-start",
      "recover-scheduled",
      "pair-status",
      "failure",
    ]),
    timestamp: z.number().int().nonnegative(),
    state: z.string().optional(),
    previousState: z.string().optional(),
    pairStatus: z.enum(["waiting", "matched"]).optional(),
    closeCode: z.number().int().optional(),
    closeReason: z.string().optional(),
    wasClean: z.boolean().optional(),
    wasPaired: z.boolean().optional(),
    failureReason: webRemoteControlFailureReasonSchema.optional(),
    failureMessage: z.string().optional(),
    visibilityState: z.string().optional(),
    online: z.boolean().optional(),
    hiddenDurationMs: z.number().int().nonnegative().optional(),
  }),
] as const;

export const webRemoteControlAppPayloadSchema = z.union(webRemoteControlAppPayloadSchemas);

export function parseWebRemoteControlAppPayload(
  payload: unknown,
): WebRemoteControlAppPayload | null {
  const result = webRemoteControlAppPayloadSchema.safeParse(payload);
  return result.success ? (result.data as WebRemoteControlAppPayload) : null;
}

export const credentialRecordSchema = z.record(z.string(), z.string());
export const credentialKeySchema = nonEmptyStringSchema;
export const credentialValueSchema = z.string();

export const sshConnectOptionsSchema = z.object({
  kind: z.literal("ssh"),
  host: nonEmptyStringSchema,
  port: z.number().int().positive().max(65535).optional(),
  username: nonEmptyStringSchema,
  sshConfigAlias: nonEmptyStringSchema.optional(),
  password: z.string().optional(),
  privateKeyPath: z.string().optional(),
  privateKeyPassphrase: z.string().optional(),
  assetInstallMode: z.enum(REMOTE_ASSET_INSTALL_MODES).optional(),
  resourcePackages: z
    .object({
      selectedPackageIds: z.array(z.string().refine(isKnownRemoteResourcePackageId)).optional(),
    })
    .optional(),
});

export const wslConnectOptionsSchema = z.object({
  kind: z.literal("wsl"),
  distro: z.string().optional(),
  user: wslUserSchema.optional(),
});

export const dockerConnectOptionsSchema = z.object({
  kind: z.literal("docker"),
  container: nonEmptyStringSchema,
});

export const serverConnectOptionsSchema = z.object({
  kind: z.literal("server"),
  url: z.string().url(),
  name: nonEmptyStringSchema.optional(),
  token: z.string().optional(),
  workspacePath: z.string().optional(),
  serverId: nonEmptyStringSchema.optional(),
});

export const remoteTargetSchema = z.discriminatedUnion("kind", [
  sshConnectOptionsSchema,
  wslConnectOptionsSchema,
  dockerConnectOptionsSchema,
  serverConnectOptionsSchema,
]);

export const helloMessageSchema = z.object({
  type: z.literal("cf-hello"),
  version: z.string(),
  platform: z.string(),
  arch: z.string(),
  pid: z.number().int(),
});

export const helloAckMessageSchema = z.object({
  type: z.literal("cf-hello-ack"),
  version: z.string(),
  clientId: nonEmptyStringSchema,
});

export const rendererLogPayloadSchema = z.object({
  level: z.enum(["info", "warn", "error"]),
  args: z.array(z.unknown()),
});

export const taskNotificationPayloadSchema = z.object({
  taskId: nonEmptyStringSchema,
  status: z.enum([
    "completed",
    "failed",
    "permission_request",
    "elicitation_request",
    "feedback_update",
  ]),
  requestId: nonEmptyStringSchema.optional(),
  title: z.string(),
  body: z.string(),
});

export const telemetryRendererContextSchema = z.object({
  clientTimezone: nonEmptyStringSchema,
  clientLanguage: nonEmptyStringSchema,
  screenResolution: nonEmptyStringSchema,
});

export const rendererTelemetryEventPayloadSchema = z.object({
  context: telemetryRendererContextSchema,
  elementName: nonEmptyStringSchema,
  eventRegion: nonEmptyStringSchema,
  eventType: nonEmptyStringSchema,
  eventText: z.string().optional(),
  eventExtraDetail: z.record(z.string(), z.string()),
  userId: z.string().optional(),
  talkId: z.string().optional(),
  messageId: z.string().optional(),
});

export const armsCustomEventPayloadSchema = z.object({
  name: nonEmptyStringSchema,
  group: nonEmptyStringSchema,
  value: z.number().finite().optional(),
  properties: z
    .record(z.string(), z.union([z.string(), z.number().finite(), z.boolean(), z.undefined()]))
    .optional(),
});

export const broadcastMessageSchema = z.object({
  channel: nonEmptyStringSchema,
  payload: z.unknown(),
  sourceWindowId: z.number().int().optional(),
});

export const remoteAssetDirsSchema = z.object({
  mockCdnDir: z.string().optional(),
  remoteCdnBaseUrl: z.string().optional(),
  remoteCdnBaseUrls: z.array(z.string()).optional(),
  remoteCacheDir: z.string().optional(),
  sourceServerArtifactPolicy: sourceServerArtifactPolicySchema.optional(),
});

const hostAgentWarmupTargetSchema = z.object({
  workspacePath: nonEmptyStringSchema,
  workspaceIdentity: nonEmptyStringSchema.optional(),
});

export const hostInitLocalMessageSchema = z.object({
  type: z.literal("init-local"),
  databaseStartupId: z.string().min(1).max(128).optional(),
  hostId: nonEmptyStringSchema.optional(),
  deliveryKind: taskRealtimeHostDeliveryKindSchema.optional(),
  deviceMid: z.string().optional(),
  feedbackApiBase: z.string().url().optional(),
  workspacePath: nonEmptyStringSchema.optional(),
  workspaceIdentity: nonEmptyStringSchema.optional(),
  agentWarmupTargets: z.array(hostAgentWarmupTargetSchema).max(1).optional(),
  agentSpawnFallbackCwd: nonEmptyStringSchema.optional(),
  remoteAssets: remoteAssetDirsSchema.optional(),
  
  locale: localeSchema.optional(),
  cfBuiltinProviderConfigFilePath: nonEmptyStringSchema,
  runtimeProcessEnvPatch: z
    .record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string())
    .optional(),
});

export const windowHostRemoteWorkspaceDescriptorSchema = z
  .object({
    
    reusedConnectionTarget: remoteTargetSchema.optional(),
    sourceServerId: nonEmptyStringSchema.optional(),
    remoteSessionId: nonEmptyStringSchema,
    target: remoteTargetSchema,
    workspacePath: nonEmptyStringSchema.optional(),
    workspaceIdentity: nonEmptyStringSchema.optional(),
    workspacePurpose: z.enum(["project", "conversation"]).optional(),
    generation: z.number().int().positive(),
  })
  .strict();
export type WindowHostRemoteWorkspaceDescriptor = z.infer<
  typeof windowHostRemoteWorkspaceDescriptorSchema
>;

export const scopedServicePortPayloadSchema = windowHostRemoteWorkspaceDescriptorSchema
  .pick({
    sourceServerId: true,
    target: true,
    workspacePurpose: true,
  })
  .extend({
    attachmentId: nonEmptyStringSchema,
    sessionId: nonEmptyStringSchema,
    workspacePath: nonEmptyStringSchema,
    workspaceIdentity: nonEmptyStringSchema,
  })
  .strict();
export type ScopedServicePortPayload = z.infer<typeof scopedServicePortPayloadSchema>;

export const windowHostAttachmentScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("local") }).strict(),
  z
    .object({
      kind: z.literal("source-settings"),
      sourceServerId: nonEmptyStringSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("remote"),
      sourceServerId: nonEmptyStringSchema.optional(),
      remoteSessionId: nonEmptyStringSchema,
      workspacePath: nonEmptyStringSchema,
      workspaceIdentity: nonEmptyStringSchema,
    })
    .strict(),
]);
export type WindowHostAttachmentScope = z.infer<typeof windowHostAttachmentScopeSchema>;

export const hostConnectRemoteWorkspaceMessageSchema = z
  .object({
    type: z.literal("connect-remote-workspace"),
    requestId: nonEmptyStringSchema,
    target: remoteTargetSchema,
    remoteAssets: remoteAssetDirsSchema,
    workspacePath: nonEmptyStringSchema.optional(),
    workspaceIdentity: nonEmptyStringSchema.optional(),
    confirmSourceServerInstall: z.boolean().optional(),
  })
  .strict();

export const hostCancelRemoteWorkspaceConnectMessageSchema = z
  .object({
    type: z.literal("cancel-remote-workspace-connect"),
    requestId: nonEmptyStringSchema,
  })
  .strict();

export const hostBindRemoteWorkspaceContextMessageSchema = z
  .object({
    type: z.literal("bind-remote-workspace-context"),
    requestId: nonEmptyStringSchema,
    remoteSessionId: nonEmptyStringSchema,
    workspacePath: nonEmptyStringSchema,
    workspaceIdentity: nonEmptyStringSchema,
    workspacePurpose: z.enum(["project", "conversation"]).optional(),
    legacyRouteHint: nonEmptyStringSchema.optional(),
  })
  .strict();

export const hostCancelRemoteWorkspaceBindMessageSchema = z
  .object({
    type: z.literal("cancel-remote-workspace-bind"),
    requestId: nonEmptyStringSchema,
    remoteSessionId: nonEmptyStringSchema,
  })
  .strict();

export const hostDisposeRemoteWorkspaceSessionMessageSchema = z
  .object({
    type: z.literal("dispose-remote-workspace-session"),
    requestId: nonEmptyStringSchema,
    remoteSessionId: nonEmptyStringSchema,
  })
  .strict();

export const hostAttachServicePortMessageSchema = z
  .object({
    type: z.literal("attach-service-port"),
    requestId: nonEmptyStringSchema,
    attachmentId: nonEmptyStringSchema,
    clientMode: z.enum(["desktop-continuous", "web-remote-replayable"]),
    scope: windowHostAttachmentScopeSchema,
  })
  .strict();

export const hostDetachServicePortMessageSchema = z.object({
  type: z.literal("detach-service-port"),
  attachmentId: nonEmptyStringSchema,
});

export const hostDisposeMessageSchema = z.object({
  type: z.literal("dispose"),
});

export const hostBroadcastEnvelopeSchema = z.object({
  type: z.literal("broadcast"),
  message: broadcastMessageSchema,
});

export const hostBroadcastClaimResultMessageSchema = z.discriminatedUnion("status", [
  z.object({
    type: z.literal("broadcast-claim-result"),
    requestId: nonEmptyStringSchema,
    status: z.literal("acquired"),
    claimToken: nonEmptyStringSchema,
  }),
  z.object({
    type: z.literal("broadcast-claim-result"),
    requestId: nonEmptyStringSchema,
    status: z.literal("busy"),
    retryAfterMs: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("broadcast-claim-result"),
    requestId: nonEmptyStringSchema,
    status: z.literal("committed"),
  }),
]);

export const hostTaskRealtimeDeliverMessageSchema = z.object({
  type: z.literal("task-realtime-deliver"),
  event: taskRealtimeDeliveredEventSchema,
});

export const hostTaskRunLeaseResultMessageSchema = z.object({
  type: z.literal("task-run-lease-result"),
  result: taskRunLeaseResultSchema,
});

export const hostTaskOwnerCommandDeliverMessageSchema = z.object({
  type: z.literal("task-owner-command-deliver"),
  command: taskOwnerCommandDeliverySchema,
});

export const hostTaskOwnerCommandResultMessageSchema = z.object({
  type: z.literal("task-owner-command-result"),
  result: taskOwnerCommandResultSchema,
});

export const sessionMessageRequestSchema = z.object({
  content: nonEmptyStringSchema,
  createdAt: nonEmptyStringSchema,
  fromSessionId: nonEmptyStringSchema,
  messageId: nonEmptyStringSchema,
  requestId: nonEmptyStringSchema,
  toSessionId: nonEmptyStringSchema,
});

export const sessionMessageDeliveryResultSchema = z.object({
  error: z.string().optional(),
  messageId: nonEmptyStringSchema,
  requestId: nonEmptyStringSchema,
  sessionId: nonEmptyStringSchema,
  status: z.enum(["success", "failed"]),
});

export const sessionRouteSchema = z.object({
  sessionId: nonEmptyStringSchema,
});

export const hostSessionMessageDeliverMessageSchema = z.object({
  type: z.literal("session-message-deliver"),
  request: sessionMessageRequestSchema,
});

export const hostSessionMessageDeliveryResultMessageSchema = z.object({
  type: z.literal("session-message-delivery-result"),
  result: sessionMessageDeliveryResultSchema,
});

export const hostFeedbackLogArchiveResultMessageSchema = z.object({
  type: z.literal("feedback-log-archive-result"),
  requestId: nonEmptyStringSchema,
  ok: z.boolean(),
  path: z.string().optional(),
  size: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
});

export const hostCronRunMessageSchema = z.object({
  type: z.literal("cron-run"),
  automationId: nonEmptyStringSchema,
  runId: nonEmptyStringSchema,
  workspacePath: nonEmptyStringSchema,
  workspaceIdentity: z.string().optional(),
  projectId: nonEmptyStringSchema.nullable().optional(),
  hostId: nonEmptyStringSchema.optional(),
  additionalDirectories: z.array(nonEmptyStringSchema).max(256).optional(),
  prompt: nonEmptyStringSchema,
  targetTaskId: nonEmptyStringSchema.optional(),
  modelSelection: modelSelectionSchema.optional(),
  mode: z.string().optional(),
});

export const hostOffPeakRunMessageSchema = z.object({
  type: z.literal("off-peak-run"),
  offPeakTaskId: nonEmptyStringSchema,
  workspacePath: nonEmptyStringSchema,
  workspaceIdentity: z.string().optional(),
  projectId: nonEmptyStringSchema.nullable().optional(),
  hostId: nonEmptyStringSchema.optional(),
  additionalDirectories: z.array(nonEmptyStringSchema).max(256).optional(),
  prompt: nonEmptyStringSchema,
  permissionMode: nonEmptyStringSchema,
  modelSelection: modelSelectionSchema,
  conversationId: z.string().optional(),
  sessionId: z.string().optional(),
  serverTicketId: z.string().optional(),
});

export const hostBrowserExecuteResultMessageSchema = z.object({
  type: z.literal("browser-execute-result"),
  requestId: nonEmptyStringSchema,
  result: browserCommandResultSchema,
});

export const hostLocalMediaPreviewPathAuthorizeResultMessageSchema = z
  .object({
    type: z.literal("local-media-preview-path-authorize-result"),
    requestId: nonEmptyStringSchema,
    ok: z.boolean(),
    path: nonEmptyStringSchema.optional(),
    error: z.string().optional(),
  })
  .strict();

export const hostPluginSandboxRegisterResultMessageSchema = z
  .object({
    type: z.literal("plugin-sandbox-register-result"),
    requestId: nonEmptyStringSchema,
    ok: z.boolean(),
    instance: mcpAppInstanceSchema.optional(),
    sandboxId: nonEmptyStringSchema.optional(),
    initId: z.number().int().nonnegative().optional(),
    shellUrl: nonEmptyStringSchema.optional(),
    partition: nonEmptyStringSchema.optional(),
    resourceMeta: z
      .object({
        prefersBorder: z.boolean().optional(),
        heightHint: z.number().int().positive().optional(),
        minFrameHeight: z.number().int().positive().optional(),
        showInline: z.boolean().optional(),
        permissions: z
          .array(z.enum(["camera", "microphone", "geolocation", "clipboardWrite"]))
          .optional(),
      })
      .strict()
      .optional(),
    error: z.string().optional(),
  })
  .strict();

export const hostCuaPipFocusChangedMessageSchema = z
  .object({
    type: z.literal("cua-pip-focus-changed"),
    event: z
      .object({
        kind: z.literal("focus-changed"),
        revision: z.number().int().nonnegative().safe(),
        sourceWindowId: nonEmptyStringSchema.max(255),
        sessionId: nonEmptyStringSchema.max(255).nullable(),
      })
      .strict(),
  })
  .strict();

export const hostApplicationLocaleChangedMessageSchema = z
  .object({
    type: z.literal("application-locale-changed"),
    locale: localeSchema,
  })
  .strict();

export const hostProviderProvisioningExecuteMessageSchema = z
  .object({
    type: z.literal("provider-provisioning-execute"),
    requestId: nonEmptyStringSchema,
    environmentKey: nonEmptyStringSchema,
    remoteSessionId: nonEmptyStringSchema,
    trigger: providerProvisioningTriggerSchema,
  })
  .strict();

export const hostPrepareProjectWorkspaceMessageSchema = z
  .object({
    type: z.literal("prepare-project-workspace"),
    requestId: nonEmptyStringSchema,
    clientMode: z.literal("web-remote-replayable"),
    projectId: nonEmptyStringSchema.nullable().optional(),
    hostId: nonEmptyStringSchema.optional(),
    draftId: z.string().uuid().optional(),
    reuseDraft: z.boolean().optional(),
    task: z
      .object({ taskId: nonEmptyStringSchema, workspaceKey: nonEmptyStringSchema })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (request) => (request.task ? request.projectId === undefined : request.projectId !== undefined),
    "Exactly one task or draft intent is required",
  )
  .refine(
    (request) =>
      (!request.draftId || request.projectId === null) &&
      (!request.reuseDraft || Boolean(request.draftId)),
    "Only an unclassified draft can reuse its directory",
  );
export type HostProjectWorkspaceNavigationInput = Pick<
  z.infer<typeof hostPrepareProjectWorkspaceMessageSchema>,
  "projectId" | "hostId" | "task" | "draftId" | "reuseDraft"
>;
export const hostProjectWorkspacePreparedValueSchema = z
  .object({
    hostId: nonEmptyStringSchema,
    projectId: nonEmptyStringSchema.nullable(),
    workspacePath: nonEmptyStringSchema,
    workspaceIdentity: nonEmptyStringSchema.optional(),
    additionalDirectories: z.array(nonEmptyStringSchema),
    remote: windowHostRemoteWorkspaceDescriptorSchema.optional(),
  })
  .strict();
export type HostPreparedProjectWorkspace = z.infer<typeof hostProjectWorkspacePreparedValueSchema>;
export const hostProjectWorkspacePreparedResponseSchema = z
  .object({
    type: z.literal("project-workspace-prepared"),
    requestId: nonEmptyStringSchema,
    result: z.discriminatedUnion("ok", [
      z.object({ ok: z.literal(true), value: hostProjectWorkspacePreparedValueSchema }).strict(),
      z.object({ ok: z.literal(false), error: nonEmptyStringSchema }).strict(),
    ]),
  })
  .strict();

export const hostResourceUsageSnapshotRequestMessageSchema = z
  .object({
    type: z.literal("resource-usage-snapshot-request"),
    requestId: nonEmptyStringSchema,
  })
  .strict();
export type HostResourceUsageSnapshotRequestMessage = z.infer<
  typeof hostResourceUsageSnapshotRequestMessageSchema
>;

export const hostIncomingMessageSchema = z.discriminatedUnion("type", [
  hostPrepareProjectWorkspaceMessageSchema,
  z.object({ type: z.literal("network-capture"), control: networkCaptureControlSchema }).strict(),
  z
    .object({ type: z.literal("database-startup-control"), control: databaseStartupControlSchema })
    .strict(),
  hostResourceUsageSnapshotRequestMessageSchema,
  z
    .object({ type: z.literal("resource-usage-snapshot-cancel"), requestId: nonEmptyStringSchema })
    .strict(),
  hostInitLocalMessageSchema,
  hostConnectRemoteWorkspaceMessageSchema,
  hostCancelRemoteWorkspaceConnectMessageSchema,
  hostBindRemoteWorkspaceContextMessageSchema,
  hostCancelRemoteWorkspaceBindMessageSchema,
  hostDisposeRemoteWorkspaceSessionMessageSchema,
  hostAttachServicePortMessageSchema,
  hostDetachServicePortMessageSchema,
  hostDisposeMessageSchema,
  hostBroadcastEnvelopeSchema,
  hostBroadcastClaimResultMessageSchema,
  hostTaskRealtimeDeliverMessageSchema,
  hostTaskRunLeaseResultMessageSchema,
  hostTaskOwnerCommandDeliverMessageSchema,
  hostTaskOwnerCommandResultMessageSchema,
  hostSessionMessageDeliverMessageSchema,
  hostSessionMessageDeliveryResultMessageSchema,
  hostFeedbackLogArchiveResultMessageSchema,
  hostCronRunMessageSchema,
  hostOffPeakRunMessageSchema,
  hostBrowserExecuteResultMessageSchema,
  hostLocalMediaPreviewPathAuthorizeResultMessageSchema,
  hostPluginSandboxRegisterResultMessageSchema,
  hostCuaPipFocusChangedMessageSchema,
  hostApplicationLocaleChangedMessageSchema,
  hostProviderProvisioningExecuteMessageSchema,
]);

export const hostRemoteWorkspaceConnectedResponseSchema = z
  .object({
    type: z.literal("remote-workspace-connected"),
    requestId: nonEmptyStringSchema,
    descriptor: windowHostRemoteWorkspaceDescriptorSchema,
  })
  .strict();

export const hostRemoteWorkspaceContextBoundResponseSchema = z
  .object({
    type: z.literal("remote-workspace-context-bound"),
    requestId: nonEmptyStringSchema,
    previousWorkspaceIdentity: nonEmptyStringSchema.optional(),
  })
  .strict();

export const hostRemoteWorkspaceContextBindFailedResponseSchema = z
  .object({
    type: z.literal("remote-workspace-context-bind-failed"),
    requestId: nonEmptyStringSchema,
    error: nonEmptyStringSchema,
    reasonCode: nonEmptyStringSchema.optional(),
    retryable: z.boolean().optional(),
  })
  .strict();

export const hostRemoteWorkspaceReconnectedResponseSchema = z
  .object({
    type: z.literal("remote-workspace-reconnected"),
    previousRemoteSessionId: nonEmptyStringSchema,
    descriptor: windowHostRemoteWorkspaceDescriptorSchema,
  })
  .strict();

export const hostRemoteWorkspaceConnectionLogResponseSchema = z
  .object({
    type: z.literal("remote-workspace-connection-log"),
    requestId: nonEmptyStringSchema,
    level: z.enum(["info", "warn", "error"]),
    message: nonEmptyStringSchema,
  })
  .strict();

export const hostRemoteWorkspaceConnectFailedResponseSchema = z
  .object({
    type: z.literal("remote-workspace-connect-failed"),
    requestId: nonEmptyStringSchema,
    error: nonEmptyStringSchema,
    reasonCode: nonEmptyStringSchema.optional(),
    retryable: z.boolean().optional(),
    profileId: z.string().uuid().optional(),
    resolvedWslTarget: z
      .object({
        kind: z.literal("wsl"),
        distro: nonEmptyStringSchema,
        user: wslUserSchema.refine((value) => value.length > 0),
      })
      .strict()
      .optional(),
  })
  .strict();

export const hostRemoteWorkspaceClosedResponseSchema = z
  .object({
    type: z.literal("remote-workspace-closed"),
    remoteSessionId: nonEmptyStringSchema,
    reason: z.enum(["connection-closed", "disposed", "connect-cancelled"]),
    exitCode: z.number().int().nullable().optional(),
    signal: z.string().nullable().optional(),
    error: z.string().optional(),
    recoverable: z.boolean().optional(),
    recoveryAttempt: z.number().int().positive().optional(),
    recoveryLimit: z.number().int().positive().optional(),
    recoveryBudgetExhausted: z.boolean().optional(),
    reasonCode: nonEmptyStringSchema.optional(),
    retryable: z.boolean().optional(),
  })
  .strict();

export const hostLogResponseSchema = z.object({
  type: z.literal("log"),
  level: z.enum(["info", "warn", "error"]),
  source: z.string(),
  message: z.string(),
});

export { cfProviderSchema };

export const cfTaskMigrationSourceSchema = z.enum(["claudeCode"]);

export const hostAgentProcessSpawnedResponseSchema = z.object({
  type: z.literal("agent-process-spawned"),
  
  lane: nonEmptyStringSchema.optional(),
  pid: z.number().int().positive(),
  provider: cfProviderSchema,
  workspacePath: nonEmptyStringSchema,
  command: z.string(),
  args: z.array(z.string()),
  startedAt: z.number().int().nonnegative(),
  runtimeGeneration: z.number().int().positive().optional(),
  runtimeInstanceId: nonEmptyStringSchema.optional(),
});
export type HostAgentProcessSpawnedResponse = z.infer<typeof hostAgentProcessSpawnedResponseSchema>;

export const hostAgentProcessReadyResponseSchema = z.object({
  type: z.literal("agent-process-ready"),
  
  lane: nonEmptyStringSchema.optional(),
  pid: z.number().int().positive(),
  provider: cfProviderSchema,
  workspacePath: nonEmptyStringSchema,
  readyAt: z.number().int().nonnegative(),
  startupDurationMs: z.number().int().nonnegative(),
  runtimeGeneration: z.number().int().positive(),
  runtimeInstanceId: nonEmptyStringSchema,
});
export type HostAgentProcessReadyResponse = z.infer<typeof hostAgentProcessReadyResponseSchema>;

export const hostAgentProcessExitedResponseSchema = z.object({
  type: z.literal("agent-process-exited"),
  
  lane: nonEmptyStringSchema.optional(),
  pid: z.number().int().positive(),
  provider: cfProviderSchema,
  workspacePath: nonEmptyStringSchema,
  exitCode: z.number().int().nullable(),
  signal: z.string().nullable(),
  endedAt: z.number().int().nonnegative(),
  terminationKind: z.enum(["expected", "unexpected", "watchdog_recycle"]),
  terminationReason: z.string().optional(),
  
  runtimeReady: z.boolean().optional(),
  runtimeGeneration: z.number().int().positive(),
  runtimeInstanceId: nonEmptyStringSchema.optional(),
  uptimeMs: z.number().int().nonnegative(),
  stderrLineCount: z.number().int().nonnegative(),
  stderrTail: z.array(z.string().max(1_100)).max(20).optional(),
});

export type HostAgentProcessExitedResponse = z.infer<typeof hostAgentProcessExitedResponseSchema>;

export const hostAgentProcessErrorResponseSchema = z.object({
  type: z.literal("agent-process-error"),
  
  lane: nonEmptyStringSchema.optional(),
  pid: z.number().int().positive().nullable(),
  provider: cfProviderSchema,
  workspacePath: nonEmptyStringSchema,
  command: z.string(),
  args: z.array(z.string()),
  errorName: nonEmptyStringSchema,
  errorCode: z.string().optional(),
  errorMessage: z.string(),
  errorStack: z.string().optional(),
  runtimeGeneration: z.number().int().positive(),
  runtimeInstanceId: nonEmptyStringSchema.optional(),
  occurredAt: z.number().int().nonnegative(),
});

export type HostAgentProcessErrorResponse = z.infer<typeof hostAgentProcessErrorResponseSchema>;

export const hostAgentProcessExceptionResponseSchema = z
  .object({
    type: z.literal("agent-process-exception"),
    lane: nonEmptyStringSchema.optional(),
    pid: z.number().int().positive(),
    provider: cfProviderSchema,
    workspacePath: nonEmptyStringSchema,
    runtimeGeneration: z.number().int().positive(),
    runtimeInstanceId: nonEmptyStringSchema,
    diagnostic: cfProcessDiagnosticSchema,
  })
  .strict();
export type HostAgentProcessExceptionResponse = z.infer<
  typeof hostAgentProcessExceptionResponseSchema
>;

export const processResourceCliLaneSchema = z.enum(PROCESS_RESOURCE_CLI_LANES);
export const agentLaneResourceSampleSchema = cfProcessResourceSampleSchema
  .extend({ lane: processResourceCliLaneSchema.optional() })
  .strict();
export type AgentLaneResourceSample = z.infer<typeof agentLaneResourceSampleSchema>;

const resourceTelemetryEnvironmentKeySchema = z.string().regex(/^[a-f0-9]{64}$/);

export const hostAgentResourceSampleResponseSchema = z
  .object({
    type: z.literal("agent-resource-sample"),
    runtimeSurface: z.enum(["local", "remote"]),
    environmentKey: resourceTelemetryEnvironmentKeySchema.optional(),
    sample: agentLaneResourceSampleSchema,
  })
  .strict();
export type HostAgentResourceSampleResponse = z.infer<typeof hostAgentResourceSampleResponseSchema>;

export const nodeSelfResourceSampleSchema = z
  .object({
    
    cpuPercent: z.number().finite().nonnegative().max(100_000),
    rssKb: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER),
    heapUsedKb: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
export type NodeSelfResourceSample = z.infer<typeof nodeSelfResourceSampleSchema>;

export const rendererHeapSampleSchema = z
  .object({
    heapUsedKb: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
export type RendererHeapSample = z.infer<typeof rendererHeapSampleSchema>;

export const hostResourceSampleResponseSchema = z
  .object({
    type: z.literal("host-resource-sample"),
    sample: nodeSelfResourceSampleSchema,
  })
  .strict();
export type HostResourceSampleResponse = z.infer<typeof hostResourceSampleResponseSchema>;

export const hostMcpResourceSamplesResponseSchema = z
  .object({
    type: z.literal("mcp-resource-samples"),
    runtimeSurface: z.enum(["local", "remote"]),
    environmentKey: resourceTelemetryEnvironmentKeySchema.optional(),
    samples: cfMcpResourceSamplesSchema,
  })
  .strict();
export type HostMcpResourceSamplesResponse = z.infer<typeof hostMcpResourceSamplesResponseSchema>;

export const hostToolExecResourceResponseSchema = z
  .object({
    type: z.literal("tool-exec-resource"),
    runtimeSurface: z.enum(["local", "remote"]),
    sample: cfToolExecResourceSchema,
  })
  .strict();
export type HostToolExecResourceResponse = z.infer<typeof hostToolExecResourceResponseSchema>;

export const hostMcpTelemetryResponseSchema = z
  .object({
    type: z.literal("mcp-telemetry"),
    runtimeSurface: z.enum(["local", "remote"]),
    event: cfMcpTelemetryEventSchema,
  })
  .strict();
export type HostMcpTelemetryResponse = z.infer<typeof hostMcpTelemetryResponseSchema>;

export const hostPluginTelemetryResponseSchema = z
  .object({
    type: z.literal("plugin-telemetry"),
    event: rendererTelemetryEventPayloadSchema.refine((event) =>
      ["plugin_lifecycle", "plugin_usage", "plugin_runtime_error"].includes(event.elementName),
    ),
  })
  .strict();
export type HostPluginTelemetryResponse = z.infer<typeof hostPluginTelemetryResponseSchema>;

export const hostSessionCreateTelemetryResponseSchema = z
  .object({
    type: z.literal("session-create-telemetry"),
    event: automationSessionCreateTelemetrySchema,
  })
  .strict();
export type HostSessionCreateTelemetryResponse = z.infer<
  typeof hostSessionCreateTelemetryResponseSchema
>;

export const hostAgentRunningTaskCountChangedResponseSchema = z.object({
  type: z.literal("agent-running-task-count-changed"),
  runningTaskCount: z.number().int().nonnegative(),
});

export const hostWorkspaceRunningTaskCountChangedResponseSchema = z.object({
  type: z.literal("workspace-running-task-count-changed"),
  workspacePath: nonEmptyStringSchema,
  workspaceIdentity: nonEmptyStringSchema.optional(),
  runningTaskCount: z.number().int().nonnegative(),
});

export const hostCuaOperationStateResponseSchema = z
  .object({
    type: z.literal("cua-operation-state"),
    active: z.boolean(),
    sessionId: nonEmptyStringSchema,
    turnId: nonEmptyStringSchema,
    workspacePath: nonEmptyStringSchema,
    workspaceIdentity: nonEmptyStringSchema.optional(),
  })
  .strict();

export type HostCuaOperationStateResponse = z.infer<typeof hostCuaOperationStateResponseSchema>;

export const hostBroadcastClaimRequestResponseSchema = z.object({
  type: z.literal("broadcast-claim-request"),
  requestId: nonEmptyStringSchema,
  key: nonEmptyStringSchema.max(1_024),
});

export const hostBroadcastClaimCommitResponseSchema = z.object({
  type: z.literal("broadcast-claim-commit"),
  key: nonEmptyStringSchema.max(1_024),
  claimToken: nonEmptyStringSchema,
});

export const hostBroadcastClaimReleaseResponseSchema = z.object({
  type: z.literal("broadcast-claim-release"),
  key: nonEmptyStringSchema.max(1_024),
  claimToken: nonEmptyStringSchema,
});

export const hostTaskRealtimePublishResponseSchema = z.object({
  type: z.literal("task-realtime-publish"),
  event: taskRealtimeEventSchema,
});

export const hostTaskStreamOpPublishResponseSchema = z.object({
  type: z.literal("task-stream-op-publish"),
  target: taskStreamMirrorTargetSchema,
  op: taskStreamMirrorPublishOpSchema,
});

export const hostTaskRunLeaseAcquireResponseSchema = z.object({
  type: z.literal("task-run-lease-acquire"),
  request: taskRunLeaseAcquireRequestSchema,
});

export const hostTaskRunLeaseReleaseResponseSchema = z.object({
  type: z.literal("task-run-lease-release"),
  target: taskRunLeaseTargetSchema,
});

export const hostTaskOwnerCommandRequestResponseSchema = z.object({
  type: z.literal("task-owner-command-request"),
  command: taskOwnerCommandRequestSchema,
});

export const hostTaskOwnerCommandResultResponseSchema = z.object({
  type: z.literal("task-owner-command-result"),
  result: taskOwnerCommandResultSchema,
});

export const hostSessionMessageSendRequestedResponseSchema = z.object({
  type: z.literal("session-message-send-requested"),
  request: sessionMessageRequestSchema,
});

export const hostSessionRouteAnnounceResponseSchema = z.object({
  type: z.literal("session-route-announce"),
  route: sessionRouteSchema,
});

export const hostSessionMessageDeliverResultResponseSchema = z.object({
  type: z.literal("session-message-deliver-result"),
  result: sessionMessageDeliveryResultSchema,
});

export const hostFeedbackLogArchiveRequestResponseSchema = z.object({
  type: z.literal("feedback-log-archive-request"),
  requestId: nonEmptyStringSchema,
  sourceDir: nonEmptyStringSchema,
});

export const hostCronRunResultResponseSchema = z.object({
  type: z.literal("cron-run-result"),
  runId: nonEmptyStringSchema,
  ok: z.boolean(),
  taskId: z.string().optional(),
  sessionId: z.string().optional(),
  error: z.string().optional(),
  failureKind: z.enum(["transient", "permanent"]).optional(),
});

export const hostOffPeakRunResultResponseSchema = z.object({
  type: z.literal("off-peak-run-result"),
  offPeakTaskId: nonEmptyStringSchema,
  ok: z.boolean(),
  
  lifecycleManaged: z.literal(true).optional(),
  conversationId: z.string().optional(),
  sessionId: z.string().optional(),
  error: z.string().optional(),
  failureKind: z.enum(["transient", "permanent"]).optional(),
});

export const hostCronSchedulerWakeRequestResponseSchema = z.object({
  type: z.literal("cron-scheduler-wake-request"),
  automationId: nonEmptyStringSchema,
});

export const hostOffPeakSchedulerWakeRequestResponseSchema = z.object({
  type: z.literal("off-peak-scheduler-wake-request"),
  offPeakTaskId: z.string().optional(),
});

export const hostBrowserExecuteRequestResponseSchema = z.object({
  type: z.literal("browser-execute-request"),
  requestId: nonEmptyStringSchema,
  browserId: nonEmptyStringSchema.optional(),
  browserGeneration: z.number().int().nonnegative().optional(),
  sessionId: nonEmptyStringSchema,
  turnId: nonEmptyStringSchema.optional(),
  workspaceKey: nonEmptyStringSchema.optional(),
  workspacePath: nonEmptyStringSchema.optional(),
  workspaceIdentity: nonEmptyStringSchema.optional(),
  remoteSessionId: nonEmptyStringSchema.optional(),
  clientMode: z.enum(["desktop-continuous", "web-remote-replayable"]).optional(),
  sessionContext: z.enum(["live", "cached"]).optional(),
  command: browserCommandSchema,
});

export const hostLocalMediaPreviewPathAuthorizeRequestResponseSchema = z
  .object({
    type: z.literal("local-media-preview-path-authorize-request"),
    requestId: nonEmptyStringSchema,
    path: nonEmptyStringSchema,
  })
  .strict();

export const hostPluginSandboxRegisterRequestResponseSchema = z
  .object({
    type: z.literal("plugin-sandbox-register-request"),
    instance: mcpAppInstanceSchema,
    requestId: nonEmptyStringSchema,
    workspacePath: z.string().optional(),
    workspaceIdentity: z.string().optional(),
    ownerWebContentsId: z.number().int().nonnegative(),
    sessionId: nonEmptyStringSchema,
    contentKind: z.literal("gen-ui").optional(),
    pluginId: nonEmptyStringSchema.optional(),
    serverName: nonEmptyStringSchema.optional(),
    scopeId: nonEmptyStringSchema,
    html: z.string(),
    csp: z
      .object({
        connectDomains: z.array(z.string()).optional(),
        resourceDomains: z.array(z.string()).optional(),
        frameDomains: z.array(z.string()).optional(),
        baseUriDomains: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
    cspRelaxations: z
      .object({ unsafeEval: z.boolean().optional(), wasmUnsafeEval: z.boolean().optional() })
      .strict()
      .optional(),
    permissions: z
      .array(z.enum(["camera", "microphone", "geolocation", "clipboardWrite"]))
      .optional(),
    prefersBorder: z.boolean().optional(),
    heightHint: z.number().int().positive().optional(),
    minFrameHeight: z.number().int().positive().optional(),
    showInline: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.contentKind === "gen-ui"
        ? !value.pluginId && !value.serverName && !value.permissions?.length
        : Boolean(value.pluginId && value.serverName),
    "Invalid sandbox provenance",
  );

export const networkObservationSchema = z.object({
  transport: z.enum(["http", "websocket", "rpc"]),
  interface: z.string(),
  durationMs: z.number(),
  ok: z.boolean(),
  statusCode: z.number().optional(),
  errorKind: z.string().optional(),
  attempt: z.number().int().positive().optional(),
  dnsMs: z.number().optional(),
  tcpMs: z.number().optional(),
  tlsMs: z.number().optional(),
  ttfbMs: z.number().optional(),
  downloadMs: z.number().optional(),
});

export const hostNetworkTelemetryBatchResponseSchema = z.object({
  type: z.literal("network-telemetry-batch"),
  observations: z.array(networkObservationSchema).max(500),
});

export const hostProviderProvisioningSourceChangedResponseSchema = z
  .object({
    type: z.literal("provider-provisioning-source-changed"),
    trigger: providerProvisioningTriggerSchema.exclude(["environment-online"]),
  })
  .strict();

export const hostProviderProvisioningExecutionResultResponseSchema = z
  .object({
    type: z.literal("provider-provisioning-execution-result"),
    requestId: nonEmptyStringSchema,
    environmentKey: nonEmptyStringSchema,
    status: z.enum(["applied", "already-applied", "unsupported", "failed", "rollback_failed"]),
    error: z.string().optional(),
    errorCode: providerProvisioningErrorCodeSchema.optional(),
  })
  .strict();

export const hostResourceUsageProcessSchema = z
  .object({
    pid: z.number().int().positive(),
    name: nonEmptyStringSchema,
    category: z.enum(["base", "builtin-plugin", "community-plugin"]),
    groupKey: nonEmptyStringSchema,
    groupLabel: nonEmptyStringSchema,
    cpuPercent: z.number().finite().nonnegative(),
    memoryBytes: z.number().finite().nonnegative(),
  })
  .strict();

export const hostResourceUsageSnapshotResultResponseSchema = z
  .object({
    type: z.literal("resource-usage-snapshot-result"),
    requestId: nonEmptyStringSchema,
    sampledAt: z.number().int().nonnegative(),
    processes: z.array(hostResourceUsageProcessSchema).max(10_000),
  })
  .strict();
export type HostResourceUsageSnapshotResultResponse = z.infer<
  typeof hostResourceUsageSnapshotResultResponseSchema
>;

export const hostResponseMessageSchema = z.discriminatedUnion("type", [
  hostProjectWorkspacePreparedResponseSchema,
  z.object({ type: z.literal("network-capture-batch"), batch: networkCaptureBatchSchema }).strict(),
  z
    .object({ type: z.literal("database-startup-state"), state: databaseStartupStateSchema })
    .strict(),
  hostResourceUsageSnapshotResultResponseSchema,
  hostRemoteWorkspaceConnectionLogResponseSchema,
  hostRemoteWorkspaceConnectedResponseSchema,
  hostRemoteWorkspaceContextBoundResponseSchema,
  hostRemoteWorkspaceContextBindFailedResponseSchema,
  hostRemoteWorkspaceReconnectedResponseSchema,
  hostRemoteWorkspaceConnectFailedResponseSchema,
  hostRemoteWorkspaceClosedResponseSchema,
  hostLogResponseSchema,
  hostAgentProcessSpawnedResponseSchema,
  hostAgentProcessReadyResponseSchema,
  hostAgentProcessExitedResponseSchema,
  hostAgentProcessErrorResponseSchema,
  hostAgentProcessExceptionResponseSchema,
  hostAgentResourceSampleResponseSchema,
  hostResourceSampleResponseSchema,
  hostMcpTelemetryResponseSchema,
  hostMcpResourceSamplesResponseSchema,
  hostToolExecResourceResponseSchema,
  hostSessionCreateTelemetryResponseSchema,
  hostPluginTelemetryResponseSchema,
  hostAgentRunningTaskCountChangedResponseSchema,
  hostWorkspaceRunningTaskCountChangedResponseSchema,
  hostCuaOperationStateResponseSchema,
  hostBroadcastEnvelopeSchema,
  hostBroadcastClaimRequestResponseSchema,
  hostBroadcastClaimCommitResponseSchema,
  hostBroadcastClaimReleaseResponseSchema,
  hostTaskRealtimePublishResponseSchema,
  hostTaskStreamOpPublishResponseSchema,
  hostTaskRunLeaseAcquireResponseSchema,
  hostTaskRunLeaseReleaseResponseSchema,
  hostTaskOwnerCommandRequestResponseSchema,
  hostTaskOwnerCommandResultResponseSchema,
  hostSessionMessageSendRequestedResponseSchema,
  hostSessionRouteAnnounceResponseSchema,
  hostSessionMessageDeliverResultResponseSchema,
  hostFeedbackLogArchiveRequestResponseSchema,
  hostBrowserExecuteRequestResponseSchema,
  hostLocalMediaPreviewPathAuthorizeRequestResponseSchema,
  hostPluginSandboxRegisterRequestResponseSchema,
  hostNetworkTelemetryBatchResponseSchema,
  hostProviderProvisioningSourceChangedResponseSchema,
  hostProviderProvisioningExecutionResultResponseSchema,
  hostCronRunResultResponseSchema,
  hostOffPeakRunResultResponseSchema,
  hostCronSchedulerWakeRequestResponseSchema,
  hostOffPeakSchedulerWakeRequestResponseSchema,
]);

export const cfTaskPersistStatusSchema = z.enum(["running", "completed", "error"]);

export const cfPromptImageAttachmentSchema = z.object({
  kind: z.literal("image"),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative().optional(),
  dataBase64: z.string().optional(),
  localPath: z.string().optional(),
});

export const cfPromptVideoAttachmentSchema = z.object({
  kind: z.literal("video"),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative().optional(),
  dataBase64: z.string().optional(),
  localPath: z.string().optional(),
});

export const cfPromptPdfAttachmentSchema = z.object({
  kind: z.literal("pdf"),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative().optional(),
  dataBase64: z.string().optional(),
  localPath: z.string().optional(),
});

export const cfPromptFileAttachmentSchema = z.object({
  kind: z.literal("file"),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  dataBase64: z.string().optional(),
  textContent: z.string().optional(),
  localPath: z.string().optional(),
});

export const cfPromptAttachmentSchema = z.discriminatedUnion("kind", [
  cfPromptImageAttachmentSchema,
  cfPromptVideoAttachmentSchema,
  cfPromptPdfAttachmentSchema,
  cfPromptFileAttachmentSchema,
]);

export const cfPersistedToolCallSchema = z.object({
  toolName: z.string().optional(),
  title: z.string().optional(),
  kind: z.string().optional(),
  status: z.enum(["completed", "failed", "denied", "stopped"]).optional(),
  input: z.unknown(),
  output: z.unknown().optional(),
  error: z.string().optional(),
  raw: z.unknown().optional(),
  snapshotRefs: z
    .array(
      z.object({
        field: z.enum(["input", "output", "raw"]),
        refId: z.string(),
        hash: z.string(),
        fullBytes: z.number().int().nonnegative(),
        previewBytes: z.number().int().nonnegative(),
      }),
    )
    .optional(),
});

const cfPersistedMessagePartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("content"), content: z.string() }),
  z.object({ type: z.literal("thought"), content: z.string() }),
  z.object({
    type: z.literal("tool-call"),
    toolIndex: z.number().int().nonnegative(),
  }),
]);

export const cfPersistedMessageSchema = z.object({
  id: z.string().optional(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  timestamp: z.number().int().nonnegative(),
  model: z.string().optional(),
  characterCount: z.number().int().nonnegative().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  interrupted: z.boolean().optional(),
  feedback: z.enum(["like", "dislike"]).optional(),
  attachments: z.array(cfPromptAttachmentSchema).optional(),
  tools: z.array(cfPersistedToolCallSchema).optional(),
  thought: z.string().optional(),
  parts: z.array(cfPersistedMessagePartSchema).optional(),
  checkpointState: z.enum(["partial"]).optional(),
  checkpointReason: z.enum(["tool_completed", "part_boundary", "periodic"]).optional(),
  checkpointUpdatedAt: z.number().int().nonnegative().optional(),
  turnIndex: z.number().int().nonnegative().optional(),
  bodyRefs: z
    .array(
      z.object({
        field: z.enum(["content", "thought"]),
        refId: z.string(),
        hash: z.string(),
        fullBytes: z.number().int().nonnegative(),
        previewBytes: z.number().int().nonnegative(),
      }),
    )
    .optional(),
  toolSlice: z
    .object({
      persistedMessageIndex: z.number().int().nonnegative(),
      totalTools: z.number().int().nonnegative(),
      startToolIndex: z.number().int().nonnegative(),
      endToolIndexExclusive: z.number().int().nonnegative(),
    })
    .optional(),
});

export const cfTaskGoalStatusSchema = z.enum(["active", "paused", "budget_limited", "complete"]);

export const cfTaskTargetChangedActionSchema = z.enum([
  "set",
  "status_updated",
  "cleared",
  "usage_accounted",
  "run_started",
  "run_finished",
  "summary_updated",
]);

export const cfTaskTargetChangedSourceSchema = z.enum(["command", "tool", "runtime"]);

export const cfTaskGoalSchema = z.object({
  sessionID: nonEmptyStringSchema,
  targetID: nonEmptyStringSchema,
  objective: nonEmptyStringSchema,
  summaryTitle: z.string().min(1).nullable().default(null),
  status: cfTaskGoalStatusSchema,
  tokenBudget: z.number().int().positive().nullable(),
  tokensUsed: z.number().int().nonnegative(),
  timeUsedSeconds: z.number().int().nonnegative(),
  activeInputId: nonEmptyStringSchema.nullable().optional(),
  activeRunStartedAtMs: z.number().int().nonnegative().nullable().optional(),
  activeRunLastSeenAtMs: z.number().int().nonnegative().nullable().optional(),
  time: z.object({
    created: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
  }),
});

export const cfTaskGoalChangedPatchSchema = z.object({
  action: cfTaskTargetChangedActionSchema,
  source: cfTaskTargetChangedSourceSchema,
  target: cfTaskGoalSchema.nullable(),
  previousTarget: cfTaskGoalSchema.nullable().optional(),
});

export const cfTaskTargetStatusSchema = cfTaskGoalStatusSchema;
export const cfTaskTargetSchema = cfTaskGoalSchema;
export const cfTaskTargetChangedPatchSchema = cfTaskGoalChangedPatchSchema;

export const cfTaskMetaSchema = z.object({
  taskId: nonEmptyStringSchema,
  traceId: nonEmptyStringSchema,
  title: z.string(),
  titleOverridden: z.boolean().optional(),
  workspacePath: nonEmptyStringSchema,
  workspaceIdentity: nonEmptyStringSchema.optional(),
  workspacePurpose: z.enum(["project", "conversation"]).optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  mode: cfTaskModeSchema,
  model: z.string().optional(),
  thoughtLevel: nonEmptyStringSchema.optional(),
  runtimeEpoch: z.number().int().nonnegative().optional(),
  provider: legacyCfProviderSchema.optional(),
  migrationSource: cfTaskMigrationSourceSchema.optional(),
  forkedFromTaskId: nonEmptyStringSchema.optional(),
  cronAutomationId: nonEmptyStringSchema.optional(),
  offPeakTaskId: nonEmptyStringSchema.optional(),
  unreadAt: z.number().int().nonnegative().optional(),
  status: cfTaskPersistStatusSchema.optional(),
  lastError: z
    .object({
      code: z.string().optional(),
      detail: z.string().optional(),
      message: z.string().min(1),
      traceId: nonEmptyStringSchema.optional(),
      taskId: nonEmptyStringSchema.optional(),
      attribution: errorAttributionSchema.optional(),
    })
    .optional(),
  repairState: z
    .object({
      claudeNativeSnapshotAssistantContentVersion: z.number().int().nonnegative().optional(),
      codexNativeSnapshotSubagentToolsVersion: z.number().int().nonnegative().optional(),
    })
    .optional(),
  changeSummary: z
    .object({
      fileCount: z.number().int().nonnegative(),
      added: z.number().int().nonnegative(),
      removed: z.number().int().nonnegative(),
      files: z.array(
        z.object({
          path: z.string(),
          added: z.number().int().nonnegative(),
          removed: z.number().int().nonnegative(),
          writeCount: z.number().int().positive(),
          lastTurnIndex: z.number().int().nonnegative(),
        }),
      ),
    })
    .optional(),
  target: cfTaskGoalSchema.nullable().optional(),
});

export const cfTaskSessionBindingStateSchema = z.enum([
  "idle",
  "syncing",
  "ready",
  "stale",
  "failed",
]);

export const cfTaskSessionBindingSchema = z.object({
  provider: legacyCfProviderSchema,
  sessionId: nonEmptyStringSchema,
  lastSyncedTurnIndex: z.number().int(),
  state: cfTaskSessionBindingStateSchema,
});

export const cfTaskIndexEntrySchema = z.object({
  workspaceHash: nonEmptyStringSchema,
  taskId: nonEmptyStringSchema,
});

export const cfPinnedTasksFileSchema = z.object({
  version: z.literal("1"),
  tasks: z.array(cfTaskIndexEntrySchema),
});

const cfPersistedFileSnapshotSchema = z.object({
  path: z.string(),
  beforeContent: z.string().nullable(),
  afterContent: z.string(),
  writeCount: z.number().int().positive(),
  contentRefs: z
    .array(
      z.object({
        field: z.enum(["beforeContent", "afterContent"]),
        refId: z.string(),
        hash: z.string(),
        fullBytes: z.number().int().nonnegative(),
        previewBytes: z.number().int().nonnegative(),
      }),
    )
    .optional(),
});

const cfPersistedFileChangeSchema = z.object({
  turnIndex: z.number().int().nonnegative(),
  snapshots: z.array(cfPersistedFileSnapshotSchema),
  fileState: z.enum(["applied", "reverted"]).optional(),
});

const cfPersistedTurnCheckpointSchema = z.object({
  turnIndex: z.number().int().nonnegative(),
  baseFileCheckpointId: nonEmptyStringSchema,
  resultFileCheckpointId: nonEmptyStringSchema.optional(),
});

export const cfSessionFileSchema = z.object({
  meta: cfTaskMetaSchema,
  messages: z.array(cfPersistedMessageSchema),
  fileChanges: z.array(cfPersistedFileChangeSchema).optional(),
  turnCheckpoints: z.array(cfPersistedTurnCheckpointSchema).optional(),
});
