import { utilityProcess as electronUtilityProcess } from "electron";
import type { UtilityProcess as ElectronUtilityProcess } from "electron";
import { HostMessageTypes } from "@origin-ai/cf-shared";
import { buildHostProcessEnv, schedulerModulePath } from "./desktopRuntimeEnv.js";
import { ingestSchedulerSelfResourceSample } from "./processResourceSelfHeapSource.js";
import { registerSchedulerProcess, unregisterSchedulerProcess } from "./resourceManagerWindow.js";
import type {
  MainToSchedulerMessage,
  SchedulerToMainMessage,
} from "../scheduler/schedulerProtocol.js";

export interface CronRunResultPayload {
  runId: string;
  ok: boolean;
  taskId?: string;
  sessionId?: string;
  error?: string;
  failureKind?: "transient" | "permanent";
}

export interface OffPeakRunResultPayload {
  offPeakTaskId: string;
  ok: boolean;
  lifecycleManaged?: true;
  conversationId?: string;
  sessionId?: string;
  error?: string;
  failureKind?: "transient" | "permanent";
}

interface CronSchedulerDeps {
  hostProcessLocalEnv: Record<string, string>;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  
  resolveDispatchHost: () => ElectronUtilityProcess | null;
  
  onOffPeakActiveCountChanged?: (count: number) => void;
}

export interface CronSchedulerHandle {
  
  handleCronRunResult: (result: CronRunResultPayload) => void;
  
  handleOffPeakRunResult: (result: OffPeakRunResultPayload) => void;
  
  wake: (automationId: string) => void;
  
  dispose: () => Promise<void>;
}

const DISPOSE_FORCE_KILL_MS = 1_500;

export function spawnCronScheduler(deps: CronSchedulerDeps): CronSchedulerHandle {
  const child = electronUtilityProcess.fork(schedulerModulePath, [], {
    serviceName: "cf-cron-scheduler",
    execArgv: ["--no-warnings"],
    env: {
      ...buildHostProcessEnv(deps.hostProcessLocalEnv),
      CF_PROCESS_LABEL: "scheduler",
    },
  });

  deps.logger.info(`[cron-scheduler] forked scheduler process pid=${child.pid}`);
  registerSchedulerProcess(child);
  let isDisposing = false;
  let disposePromise: Promise<void> | null = null;

  const postToScheduler = (message: MainToSchedulerMessage): void => {
    try {
      child.postMessage(message);
    } catch (error) {
      deps.logger.warn("[cron-scheduler] postMessage to scheduler failed:", error);
    }
  };

  child.on("message", (raw: unknown) => {
    const msg = raw as SchedulerToMainMessage;
    if (!msg || typeof msg !== "object") return;

    if (msg.type === "scheduler-log") {
      const level = msg.level === "warn" ? "warn" : msg.level === "error" ? "error" : "info";
      deps.logger[level](`[cron-scheduler] ${msg.message}`);
      return;
    }

    if (msg.type === "offpeak-active-count") {
      deps.onOffPeakActiveCountChanged?.(msg.count);
      return;
    }

    if (msg.type === "scheduler-resource-sample") {
      ingestSchedulerSelfResourceSample(msg.sample);
      return;
    }

    if (msg.type === "cron-dispatch-request") {
      if (isDisposing) {
        postToScheduler({
          type: "cron-dispatch-result",
          runId: msg.runId,
          ok: false,
          failureKind: "transient",
          error: "app is shutting down",
        });
        return;
      }
      const host = deps.resolveDispatchHost();
      if (!host) {
        postToScheduler({
          type: "cron-dispatch-result",
          runId: msg.runId,
          ok: false,
          failureKind: "transient",
          error: "no local host available",
        });
        return;
      }
      try {
        host.postMessage({
          type: HostMessageTypes.CronRun,
          automationId: msg.automationId,
          runId: msg.runId,
          prompt: msg.prompt,
          targetTaskId: msg.targetTaskId,
          modelSelection: msg.modelSelection,
          mode: msg.mode,
          workspacePath: msg.workspacePath,
          workspaceIdentity: msg.workspaceIdentity,
          projectId: msg.projectId,
          hostId: msg.hostId,
          additionalDirectories: msg.additionalDirectories,
        });
      } catch (error) {
        deps.logger.warn("[cron-scheduler] forward CronRun to host failed:", error);
        postToScheduler({
          type: "cron-dispatch-result",
          runId: msg.runId,
          ok: false,
          failureKind: "transient",
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    if (msg.type === "offpeak-dispatch-request") {
      const host = deps.resolveDispatchHost();
      if (!host) {
        postToScheduler({
          type: "offpeak-dispatch-result",
          offPeakTaskId: msg.offPeakTaskId,
          ok: false,
          failureKind: "transient",
          error: "no local host available",
        });
        return;
      }
      try {
        host.postMessage({
          type: HostMessageTypes.OffPeakRun,
          offPeakTaskId: msg.offPeakTaskId,
          prompt: msg.prompt,
          permissionMode: msg.permissionMode,
          modelSelection: msg.modelSelection,
          conversationId: msg.conversationId,
          sessionId: msg.sessionId,
          serverTicketId: msg.serverTicketId,
          workspacePath: msg.workspacePath,
          workspaceIdentity: msg.workspaceIdentity,
          projectId: msg.projectId,
          hostId: msg.hostId,
          additionalDirectories: msg.additionalDirectories,
        });
      } catch (error) {
        deps.logger.warn("[cron-scheduler] forward OffPeakRun to host failed:", error);
        postToScheduler({
          type: "offpeak-dispatch-result",
          offPeakTaskId: msg.offPeakTaskId,
          ok: false,
          failureKind: "transient",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  });

  child.on("exit", (code) => {
    unregisterSchedulerProcess(child);
    deps.logger.info(`[cron-scheduler] scheduler process exited code=${code}`);
  });

  return {
    handleCronRunResult(result) {
      postToScheduler({ type: "cron-dispatch-result", ...result });
    },
    handleOffPeakRunResult(result) {
      postToScheduler({ type: "offpeak-dispatch-result", ...result });
    },
    wake(automationId) {
      if (isDisposing) return;
      postToScheduler({ type: "scheduler-wake", automationId });
    },
    dispose() {
      if (disposePromise) return disposePromise;
      isDisposing = true;
      postToScheduler({ type: "scheduler-dispose" });
      disposePromise = new Promise<void>((resolve) => {
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(() => {
          try {
            child.kill();
          } catch {
          }
          done();
        }, DISPOSE_FORCE_KILL_MS);
        child.once("exit", done);
      });
      return disposePromise;
    },
  };
}
