import { BrowserWindow, ipcMain } from "electron";
import type { WebContents } from "electron";
import {
  buildWebRemoteControlStartResultTelemetry,
  classifyRemoteUsageError,
  parseRemoteWorkspaceIdentity,
  PlatformChannels,
  webRemoteControlAuthStateChangeSchema,
  type WebRemoteControlAuthStateChange,
  type TelemetryEventPayload,
  type WebRemoteControlContext,
  type WebRemoteControlStartResult,
  type WebRemoteControlStatus,
} from "@origin-ai/cf-shared";
import type { WebRemoteControlStartAuthorization } from "./webRemoteControlManager.js";

export interface WebRemoteControlIpcManager {
  authorizeStart: (
    windowId: number,
    context: WebRemoteControlContext,
  ) => WebRemoteControlStartAuthorization;
  startAuthorized: (
    windowId: number,
    context: WebRemoteControlContext,
    authorization: WebRemoteControlStartAuthorization,
  ) => Promise<WebRemoteControlStartResult>;
  notifyAuthStateChanged(windowId: number, change: WebRemoteControlAuthStateChange): Promise<void>;
  stop(windowId: number): Promise<void>;
  getStatus(windowId: number): WebRemoteControlStatus;
}

interface WebRemoteControlIpcDependencies {
  reportRemoteUsageEvent: (rendererId: number, event: TelemetryEventPayload) => void;
  webRemoteControlManager: WebRemoteControlIpcManager;
}

function reportRemoteUsageEventSafely(
  reportRemoteUsageEvent: WebRemoteControlIpcDependencies["reportRemoteUsageEvent"],
  rendererId: number,
  event: TelemetryEventPayload,
): void {
  try {
    reportRemoteUsageEvent(rendererId, event);
  } catch {
  }
}

function resolveWorkspaceKind(context: WebRemoteControlContext): "local" | "remote" {
  return context.workspaceIdentity?.trim() || context.remoteSessionId?.trim() ? "remote" : "local";
}

async function runStartOperation(input: {
  context: WebRemoteControlContext;
  sender: WebContents;
  missingWindowMessage: string;
  operation: (windowId: number) => Promise<WebRemoteControlStartResult>;
  reportRemoteUsageEvent: WebRemoteControlIpcDependencies["reportRemoteUsageEvent"];
}): Promise<WebRemoteControlStartResult> {
  const workspaceKind = resolveWorkspaceKind(input.context);
  const remoteKind = input.context.workspaceIdentity
    ? parseRemoteWorkspaceIdentity(input.context.workspaceIdentity)?.kind
    : undefined;
  const rendererId = input.sender.id;
  try {
    const win = BrowserWindow.fromWebContents(input.sender);
    if (!win) {
      throw new Error(input.missingWindowMessage);
    }
    const response = await input.operation(win.id);
    reportRemoteUsageEventSafely(
      input.reportRemoteUsageEvent,
      rendererId,
      buildWebRemoteControlStartResultTelemetry({
        result: "success",
        workspaceKind,
        remoteKind,
      }),
    );
    return response;
  } catch (error) {
    reportRemoteUsageEventSafely(
      input.reportRemoteUsageEvent,
      rendererId,
      buildWebRemoteControlStartResultTelemetry({
        result: "failure",
        workspaceKind,
        remoteKind,
        errorCategory: classifyRemoteUsageError(error),
      }),
    );
    throw error;
  }
}

export function registerWebRemoteControlIpcHandlers(
  dependencies: WebRemoteControlIpcDependencies,
): void {
  ipcMain.on(PlatformChannels.WebRemoteControlAuthStateChanged, (event, payload: unknown) => {
    const parsed = webRemoteControlAuthStateChangeSchema.safeParse(payload);
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!parsed.success || !win) return;
    void dependencies.webRemoteControlManager
      .notifyAuthStateChanged(win.id, parsed.data)
      .catch(() => {});
  });
  ipcMain.handle(
    PlatformChannels.StartWebRemoteControl,
    async (event, context: WebRemoteControlContext) =>
      runStartOperation({
        context,
        sender: event.sender,
        missingWindowMessage: "Current window not found, cannot enable Web remote control",
        operation: (windowId) => {
          const manager = dependencies.webRemoteControlManager;
          const authorization = manager.authorizeStart(windowId, context);
          return manager.startAuthorized(windowId, context, authorization);
        },
        reportRemoteUsageEvent: dependencies.reportRemoteUsageEvent,
      }),
  );

  ipcMain.handle(PlatformChannels.StopWebRemoteControl, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      await dependencies.webRemoteControlManager.stop(win.id);
    }
  });

  ipcMain.handle(PlatformChannels.GetWebRemoteControlStatus, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win
      ? dependencies.webRemoteControlManager.getStatus(win.id)
      : { status: "idle" as const };
  });
}
