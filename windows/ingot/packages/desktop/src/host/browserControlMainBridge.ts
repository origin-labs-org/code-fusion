import { randomUUID } from "node:crypto";
import { HostResponseTypes } from "@origin-ai/cf-shared";
import type {
  BrowserBackendDescriptor,
  BrowserClientMode,
  BrowserCommand,
  BrowserCommandResult,
  BrowserRecordingArtifact,
} from "@origin-ai/cf-shared";

export interface BrowserExecuteRequestMessage {
  type: typeof HostResponseTypes.BrowserExecuteRequest;
  requestId: string;
  browserId: string;
  browserGeneration: number;
  sessionId: string;
  turnId?: string;
  workspaceKey: string;
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  clientMode: BrowserClientMode;
  sessionContext: "live" | "cached";
  command: BrowserCommand;
}

export interface BrowserExecuteResultMessage {
  requestId: string;
  result: BrowserCommandResult;
}

interface PendingEntry {
  resolve: (result: BrowserCommandResult) => void;
  timer: ReturnType<typeof setTimeout>;
  method: BrowserCommand["method"];
  startedAt: number;
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  outputPath?: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;

function mayHaveSideEffects(command: BrowserCommand): boolean {
  if (command.method === "playwright" && command.action.name === "locator") {
    return [
      "click",
      "dblclick",
      "downloadMedia",
      "fill",
      "press",
      "selectOption",
      "setChecked",
    ].includes(command.action.operation);
  }
  return [
    "navigate",
    "back",
    "forward",
    "reload",
    "click",
    "fill",
    "type",
    "press",
    "cuaKeypress",
    "scroll",
    "cuaScroll",
    "domCuaScroll",
    "hover",
    "select",
    "check",
    "drag",
    "cuaDrag",
    "recordingStart",
    "recordingCancel",
    "handleDialog",
    "close",
    "finalize",
    "newTab",
  ].includes(command.method);
}

export interface BrowserControlMainBridge {
  list(): Promise<BrowserBackendDescriptor[]>;
  execute(input: {
    requestId?: string;
    browserId?: string;
    browserGeneration?: number;
    sessionId: string;
    turnId?: string;
    workspaceKey?: string;
    workspacePath?: string;
    workspaceIdentity?: string;
    remoteSessionId?: string;
    clientMode?: BrowserClientMode;
    sessionContext?: "live" | "cached";
    command: BrowserCommand;
  }): Promise<BrowserCommandResult>;
  
  handleResult(message: BrowserExecuteResultMessage): Promise<void>;
  dispose(): void;
}

export function createBrowserControlMainBridge(deps: {
  postToMain: (message: BrowserExecuteRequestMessage) => void;
  timeoutMs?: number;
  materializeRecording?(input: {
    artifact: BrowserRecordingArtifact;
    localPath: string;
    outputPath: string;
    workspacePath: string;
    workspaceIdentity?: string;
    remoteSessionId?: string;
  }): Promise<BrowserRecordingArtifact>;
}): BrowserControlMainBridge {
  const pending = new Map<string, PendingEntry>();
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const browserId = `iab:${randomUUID()}`;
  const browserGeneration = Date.now();
  const deletePendingIfCurrent = (requestId: string, entry: PendingEntry): boolean => {
    if (pending.get(requestId) !== entry) return false;
    pending.delete(requestId);
    return true;
  };
  const descriptor: BrowserBackendDescriptor = {
    id: browserId,
    generation: browserGeneration,
    type: "iab",
    name: "CodeFusion In-app Browser",
    capabilities: {
      browser: [
        {
          id: "visibility",
          description:
            "Use to show or hide the browser to the user, and to determine the browser's current visibility. Keep browser work in the background unless the user asks to see it or live viewing is useful. When the browser should be visible, call set(true).",
        },
      ],
      tab: [],
    },
    apiSupportOverrides: {
      "BrowserUser.claimTab": true,
      "Tabs.finalize": true,
      "Tab.markDeliverable": true,
      "Tab.markHandoff": true,
      "BrowserRecordingAPI.start": true,
      "BrowserRecordingAPI.status": true,
      "BrowserRecordingAPI.cancel": true,
    },
    metadata: {
      provider: "cf-desktop-iab",
    },
  };

  return {
    async list(): Promise<BrowserBackendDescriptor[]> {
      return [descriptor];
    },

    async execute({
      requestId: inputRequestId,
      browserId: requestedBrowserId,
      browserGeneration: requestedBrowserGeneration,
      sessionId,
      turnId,
      workspaceKey = sessionId,
      workspacePath = workspaceKey,
      workspaceIdentity,
      remoteSessionId,
      clientMode = "desktop-continuous",
      sessionContext = "live",
      command,
    }): Promise<BrowserCommandResult> {
      if (requestedBrowserId && requestedBrowserId !== browserId) {
        return {
          ok: false,
          error: {
            code: "backend_unavailable",
            message: `browser backend '${requestedBrowserId}' is no longer available`,
          },
          elapsedMs: 0,
        };
      }
      if (
        requestedBrowserGeneration !== undefined &&
        requestedBrowserGeneration !== browserGeneration
      ) {
        return {
          ok: false,
          error: {
            code: "backend_unavailable",
            message: `browser backend '${browserId}' generation ${requestedBrowserGeneration} is stale`,
          },
          elapsedMs: 0,
        };
      }
      const requestId = inputRequestId ?? randomUUID();
      if (pending.has(requestId)) {
        return {
          ok: false,
          error: {
            code: "duplicate_request_id",
            message: `browser requestId '${requestId}' is already running`,
            sideEffect: "none",
          },
          elapsedMs: 0,
        };
      }
      const startedAt = Date.now();
      const requestTimeoutMs =
        command.method === "playwrightWaitForTimeout"
          ? command.timeoutMs + 2_000
          : command.method === "playwright"
            ? ("timeoutMs" in command.action
                ? (command.action.timeoutMs ?? timeoutMs)
                : timeoutMs) + 2_000
            : timeoutMs;
      return await new Promise<BrowserCommandResult>((resolve) => {
        let entry: PendingEntry;
        const timer = setTimeout(() => {
          if (!deletePendingIfCurrent(requestId, entry)) return;
          const cancelRequestId = randomUUID();
          try {
            deps.postToMain({
              type: HostResponseTypes.BrowserExecuteRequest,
              requestId: cancelRequestId,
              browserId,
              browserGeneration,
              sessionId,
              turnId,
              workspaceKey,
              workspacePath,
              workspaceIdentity,
              remoteSessionId,
              clientMode,
              sessionContext,
              command: { method: "cancelRequest", requestId },
            });
          } catch {
          }
          resolve({
            ok: false,
            error: {
              code: "timeout",
              message: `browser Command ${command.method} 超时（${requestTimeoutMs}ms）`,
              sideEffect: mayHaveSideEffects(command) ? "uncertain" : "none",
            },
            elapsedMs: Date.now() - startedAt,
          });
        }, requestTimeoutMs);
        entry = {
          resolve,
          timer,
          method: command.method,
          startedAt,
          workspacePath,
          ...(workspaceIdentity ? { workspaceIdentity } : {}),
          ...(remoteSessionId ? { remoteSessionId } : {}),
          ...(command.method === "recordingStatus" && command.outputPath
            ? { outputPath: command.outputPath }
            : {}),
        };
        pending.set(requestId, entry);
        try {
          deps.postToMain({
            type: HostResponseTypes.BrowserExecuteRequest,
            requestId,
            browserId,
            browserGeneration,
            sessionId,
            turnId,
            workspaceKey,
            workspacePath,
            workspaceIdentity,
            remoteSessionId,
            clientMode,
            sessionContext,
            command,
          });
        } catch (error) {
          clearTimeout(timer);
          deletePendingIfCurrent(requestId, entry);
          resolve({
            ok: false,
            error: {
              code: "backend_unavailable",
              message: error instanceof Error ? error.message : String(error),
            },
            elapsedMs: Date.now() - startedAt,
          });
        }
      });
    },

    async handleResult(message): Promise<void> {
      const entry = pending.get(message.requestId);
      if (!entry) {
        return;
      }
      clearTimeout(entry.timer);
      if (!deletePendingIfCurrent(message.requestId, entry)) return;
      const artifact = message.result.recording?.artifact;
      if (
        message.result.ok &&
        message.result.recording?.status === "completed" &&
        artifact &&
        entry.outputPath
      ) {
        if (!deps.materializeRecording) {
          entry.resolve({
            ok: false,
            error: {
              code: "backend_unavailable",
              message: "browser recording artifact materialization is unavailable",
              sideEffect: "none",
            },
            elapsedMs: Date.now() - entry.startedAt,
          });
          return;
        }
        try {
          const materialized = await deps.materializeRecording({
            artifact,
            localPath: artifact.path,
            outputPath: entry.outputPath,
            workspacePath: entry.workspacePath,
            ...(entry.workspaceIdentity ? { workspaceIdentity: entry.workspaceIdentity } : {}),
            ...(entry.remoteSessionId ? { remoteSessionId: entry.remoteSessionId } : {}),
          });
          entry.resolve({
            ...message.result,
            recording: { ...message.result.recording, artifact: materialized },
          });
        } catch (error) {
          entry.resolve({
            ok: false,
            error: {
              code: "execution_error",
              message: error instanceof Error ? error.message : String(error),
              sideEffect: "none",
            },
            elapsedMs: Date.now() - entry.startedAt,
          });
        }
        return;
      }
      if (message.result.recording?.status === "completed" && artifact && !entry.outputPath) {
        const { artifact: _mainTemporaryArtifact, ...recording } = message.result.recording;
        entry.resolve({
          ...message.result,
          recording,
        });
        return;
      }
      entry.resolve(message.result);
    },

    dispose(): void {
      for (const [requestId, entry] of pending) {
        if (!deletePendingIfCurrent(requestId, entry)) continue;
        clearTimeout(entry.timer);
        entry.resolve({
          ok: false,
          error: {
            code: "backend_unavailable",
            message: "browser bridge disposed while command was pending",
            sideEffect: "uncertain",
          },
          elapsedMs: Date.now() - entry.startedAt,
        });
      }
    },
  };
}
