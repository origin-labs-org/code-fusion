
import { createInMemorySessionEventStore } from "@origin-ai/cf-adapters/storage";
import type { ModelSelection } from "@origin-ai/cf-contracts";
import {
  cfProviderTestModelConnectivityParamsSchema,
  cfWorkspaceReadPresentationParamsSchema,
  type CfWorkspaceRef,
} from "@origin-ai/cf-shared";
import type { CfApp, CfAppOptions } from "../app/types.js";
import { listProtocolSlashCommands } from "./slash-commands.js";
import {
  parseParams,
  type CfProtocolAgentServerContext,
  type CfProtocolSessionRecord,
} from "./server-types.js";
import { runSessionModelConfigMutation } from "../cf-protocol-v4/model-config-mutation.js";
import { createProviderRuntimeHeadersPort } from "./provider-runtime-headers.js";
import { offPeakLifecycleNotificationSchema } from "@origin-ai/cf-shared";
import { V4_NOTIFICATIONS } from "@origin-ai/cf-shared/cf-protocol-v4";

export async function readWorkspacePresentation(
  context: CfProtocolAgentServerContext,
  rawParams: unknown,
) {
  const params = parseParams(cfWorkspaceReadPresentationParamsSchema, rawParams);
  return {
    workspace: params.workspace,
    mode: "build" as const,
    slashCommands: await listProtocolSlashCommands({
      dynamicWorkflowEnabled: context.appRuntimePreferences.dynamicWorkflowEnabled,
      env: context.deps.env,
      logger: context.logger,
      workingDirectory: params.workspace.workspacePath,
    }),
  };
}

export async function testProviderModelConnectivity(
  context: CfProtocolAgentServerContext,
  rawParams: unknown,
  abortSignal?: AbortSignal,
) {
  const params = parseParams(cfProviderTestModelConnectivityParamsSchema, rawParams);
  await context.deps.refreshProviderRegistry?.("provider-connectivity");
  const active = Array.from(context.sessions.values()).find(
    (record) => record.workspace.workspaceKey === params.workspace.workspaceKey,
  );
  const app =
    active?.app ??
    (await createWorkspaceCfApp(context, params.workspace, {
      env: context.deps.env,
      eventStore: createInMemorySessionEventStore(),
      runtimeConfig: { workingDirectory: params.workspace.workspacePath },
      sessionStore: context.deps.sessionStore,
      version: context.deps.version,
    }));
  try {
    await app.testModelConnectivity(
      { selection: params.selection as ModelSelection },
      { abortSignal },
    );
    return { success: true as const };
  } finally {
    if (!active) await app.close?.();
  }
}

export async function createWorkspaceCfApp(
  context: CfProtocolAgentServerContext,
  workspace: CfWorkspaceRef,
  options: Omit<CfAppOptions, "providerRegistry">,
): Promise<CfApp> {
  const providerRuntimeHeadersPort =
    options.providerRuntimeHeadersPort ?? createProviderRuntimeHeadersPort(context, workspace);
  return context.deps.createCfApp({
    ...options,
    onOffPeakLifecycleEvent: (event) =>
      context.notify({
        method: V4_NOTIFICATIONS.offPeakLifecycle,
        params: offPeakLifecycleNotificationSchema.parse(event),
      }),
    includeVisualize: true,
    platform: context.deps.platform,
    providerRuntimeHeadersPort,
    runtimeConfig: {
      ...options.runtimeConfig,
      workspacePath: workspace.workspacePath,
      ...(workspace.remoteSessionId ? { remoteSessionId: workspace.remoteSessionId } : {}),
      ...(workspace.workspaceIdentity
        ? {
            memory: {
              ...options.runtimeConfig?.memory,
              workspaceIdentity: workspace.workspaceIdentity,
            },
          }
        : {}),
      modelStreaming: options.runtimeConfig?.modelStreaming ?? "on",
    },
  });
}

export function hasSessionModelProvider(
  _context: CfProtocolAgentServerContext,
  record: Pick<CfProtocolSessionRecord, "app" | "workspace">,
  providerId: string,
): boolean {
  return record.app.listModels().some((model) => model.ref.providerId === providerId);
}

async function ensureSessionModelAvailableUnlocked(
  context: CfProtocolAgentServerContext,
  record: CfProtocolSessionRecord,
): Promise<boolean> {
  void context;
  void record;
  return false;
}

export async function ensureSessionModelAvailable(
  context: CfProtocolAgentServerContext,
  record: CfProtocolSessionRecord,
): Promise<boolean> {
  return runSessionModelConfigMutation(record.app, () =>
    ensureSessionModelAvailableUnlocked(context, record),
  );
}

export function resolveSessionModelContextWindow(
  _context: CfProtocolAgentServerContext,
  record: Pick<CfProtocolSessionRecord, "app" | "workspace" | "restoredModelSelection">,
): number | undefined {
  const selection = record.app.runtime.getSessionModelSelection() ?? record.restoredModelSelection;
  const value = selection && record.app.getModelOption?.(selection)?.contextWindow;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}
