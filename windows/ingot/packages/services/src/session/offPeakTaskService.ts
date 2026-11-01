

import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import {
  isOffPeakTerminalStatus,
  resolveWorkspaceKey,
  type ProjectExecutionSnapshot,
  type OffPeakCodingPlanSupport,
  type OffPeakTaskCreateErrorCategory,
  type OffPeakTaskCreateFailureStage,
  type OffPeakTaskCreateResult,
  type CfOffPeakTask,
  type CfOffPeakTaskCreateParams,
} from "@origin-ai/cf-shared";
import type { ServiceLogger } from "../logger/serviceLogger.js";
import { isOffPeakBoundSessionConflict, type OffPeakTaskRepo } from "./offPeakTaskRepo.js";
import type { IOffPeakTaskService, OffPeakUpdateTaskParams } from "./offPeakTask.js";
import { OffPeakServerError, type OffPeakServerClient } from "./offPeakServerClient.js";
import type { ModelSelection, ModelSelectionValidation } from "@origin-ai/cf-provider";
import { OffPeakResidentExecutions } from "./offPeakResidentExecutions.js";

export const OFF_PEAK_SYNC_MIN_INTERVAL_MS = 5_000;
export const OFF_PEAK_SYNC_MAX_INTERVAL_MS = 5 * 60_000;
const SYNC_FAILURE_BASE_MS = 10_000;

export interface OffPeakTaskServiceDeps {
  repo: OffPeakTaskRepo;
  prepareProjectExecution?: (projectId: string) => Promise<ProjectExecutionSnapshot>;
  client: OffPeakServerClient;
  
  resolveCodingPlanSupport: () => Promise<OffPeakCodingPlanSupport>;
  
  resolveTelemetryProviderName: () => Promise<string>;
  
  resolveModelSelection: (input: {
    readonly modelId?: string;
    readonly reasoningLevel?: string;
  }) => Promise<
    | { readonly ok: true; readonly selection: ModelSelection }
    | { readonly ok: false; readonly validation: ModelSelectionValidation }
  >;
  logger: ServiceLogger;
  
  requestSchedulerWake?: () => void;
  
  stopRunningTask?: (params: {
    conversationId: string;
    workspacePath: string;
    workspaceIdentity?: string;
  }) => Promise<void>;
  
  onTasksChanged?: () => void;
  
  now?: () => number;
  
  onDispose?: () => void;
}

const VALID_CREATE_PERMISSION_MODES = new Set([
  "default",
  "yolo",
  "guarded",
  "plan",
  "edit",
  "acceptEdits",
  "auto",
  "dontAsk",
  "bypassPermissions",
  "autoEdit",
  "build",
]);

function isValidCreateParams(params: CfOffPeakTaskCreateParams): boolean {
  return (
    typeof params.title === "string" &&
    params.title.trim().length > 0 &&
    typeof params.prompt === "string" &&
    params.prompt.trim().length > 0 &&
    ((typeof params.projectId === "string" && params.projectId.trim().length > 0) ||
      (typeof params.workspacePath === "string" && params.workspacePath.trim().length > 0)) &&
    typeof params.permissionMode === "string" &&
    VALID_CREATE_PERMISSION_MODES.has(params.permissionMode)
  );
}

export function classifyOffPeakCreateFailure(
  error: unknown,
  failureStage: OffPeakTaskCreateFailureStage,
): Pick<
  Extract<OffPeakTaskCreateResult, { ok: false }>,
  "failureStage" | "errorCategory" | "errorCode"
> {
  let errorCategory: OffPeakTaskCreateErrorCategory = "unknown";
  let errorCode = "";
  if (failureStage === "client_validation") {
    errorCategory = "client_validation";
  } else if (failureStage === "local_persist") {
    errorCategory = "local_persist";
  } else if (error instanceof OffPeakServerError) {
    errorCode = error.bizCode === undefined ? "" : String(error.bizCode);
    if (error.bizCode === 3101) errorCategory = "eligibility_3101";
    else if (error.bizCode === 3103) errorCategory = "quota_3103";
  } else if (error instanceof ZodError) {
    errorCategory = "invalid_response";
  } else {
    errorCategory = "network";
  }
  return { failureStage, errorCategory, errorCode };
}

const OFF_PEAK_SESSION_BOUND_FAILURE = {
  failureStage: "client_validation",
  errorCategory: "client_validation",
  errorCode: "session_bound",
} as const;

export class OffPeakTaskService implements IOffPeakTaskService {
  readonly residentExecutions: OffPeakResidentExecutions;
  private readonly retakes = new Map<string, Promise<void>>();
  private readonly releasedTicketOutbox = new Set<string>();
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private syncRunning = false;
  private syncStopped = true;
  private consecutiveSyncFailures = 0;

  constructor(private readonly deps: OffPeakTaskServiceDeps) {
    this.residentExecutions = new OffPeakResidentExecutions({
      renew: (taskId, current) => this.handleTicketExpiredDuringRun(taskId, current),
      takeover: async (taskId) => {
        await this.deps.repo.markRunning(taskId, { startedAt: this.now() });
        await this.deps.repo.updateSchedulingSnapshot(taskId, {
          schedulable: false,
          queuePosition: null,
          now: this.now(),
        });
        this.emitChanged();
      },
      release: (ticketId) => this.releaseExecutionTicket(ticketId),
    });
  }

  
  private async releaseExecutionTicket(ticketId: string): Promise<void> {
    this.releasedTicketOutbox.add(ticketId);
    try {
      await this.deps.client.settle(ticketId);
      this.releasedTicketOutbox.delete(ticketId);
    } catch (error) {
      if (error instanceof OffPeakServerError && error.httpStatus < 500)
        this.releasedTicketOutbox.delete(ticketId);
      else
        this.deps.logger.warn(
          `off-peak execution ticket release failed ticket=${ticketId}:`,
          error,
        );
    }
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private emitChanged(): void {
    try {
      this.deps.onTasksChanged?.();
    } catch (error) {
      this.deps.logger.warn("off-peak onTasksChanged 回调失败:", error);
    }
  }

  async getCodingPlanSupport(): Promise<OffPeakCodingPlanSupport> {
    return this.deps.resolveCodingPlanSupport();
  }

  
  async validateDispatchModelSelection(selection: ModelSelection): Promise<boolean> {
    const resolved = await this.deps.resolveModelSelection({
      modelId: selection.modelId,
      ...(selection.options?.reasoningLevel
        ? { reasoningLevel: selection.options.reasoningLevel }
        : {}),
    });
    return (
      resolved.ok &&
      resolved.selection.providerId === selection.providerId &&
      resolved.selection.modelId === selection.modelId
    );
  }

  async getTakeNumberAvailability() {
    return this.deps.client.getTakeNumberAvailability();
  }

  
  async createTask(params: CfOffPeakTaskCreateParams): Promise<OffPeakTaskCreateResult> {
    let providerName = "";
    try {
      providerName = await this.deps.resolveTelemetryProviderName();
    } catch {
    }
    if (!isValidCreateParams(params)) {
      return {
        ok: false,
        ...classifyOffPeakCreateFailure(undefined, "client_validation"),
        providerName,
      };
    }
    const selection = await this.deps.resolveModelSelection({
      modelId: params.modelSelection.modelId,
      ...(params.modelSelection.options?.reasoningLevel
        ? { reasoningLevel: params.modelSelection.options.reasoningLevel }
        : {}),
    });
    if (!selection.ok) {
      return {
        ok: false,
        ...classifyOffPeakCreateFailure(undefined, "client_validation"),
        providerName,
      };
    }
    let execution: ProjectExecutionSnapshot | undefined;
    if (params.projectId) {
      try {
        if (params.boundSessionId || !this.deps.prepareProjectExecution)
          throw new Error("project.creation-unavailable");
        execution = await this.deps.prepareProjectExecution(params.projectId);
      } catch (error) {
        return {
          ok: false,
          ...classifyOffPeakCreateFailure(error, "client_validation"),
          providerName,
        };
      }
    }
    const normalizedParams: CfOffPeakTaskCreateParams = {
      ...params,
      ...execution,
      modelSelection: selection.selection,
    };
    if (
      params.boundSessionId &&
      (await this.deps.repo.hasActiveBoundTask(
        resolveWorkspaceKey({
          workspacePath: params.workspacePath,
          workspaceIdentity: params.workspaceIdentity,
        }),
        params.boundSessionId,
      ))
    ) {
      return { ok: false, ...OFF_PEAK_SESSION_BOUND_FAILURE, providerName };
    }
    const offPeakTaskId = `offpeak-${randomUUID()}`;
    let ticket;
    try {
      ticket = await this.deps.client.takeTicket(offPeakTaskId);
    } catch (error) {
      return {
        ok: false,
        ...classifyOffPeakCreateFailure(error, "ticket_request"),
        providerName,
      };
    }
    let created: CfOffPeakTask;
    try {
      created = await this.deps.repo.create(normalizedParams, {
        offPeakTaskId,
        serverTicketId: ticket.ticketId,
        registeredAt: ticket.registeredAt,
        ...(ticket.position !== undefined ? { queuePosition: ticket.position } : {}),
        schedulable: ticket.state === "ready",
      });
      if (ticket.nextPollAfterMs !== undefined) {
        await this.deps.repo.updateSchedulingSnapshot(created.offPeakTaskId, {
          nextPollAt: this.now() + ticket.nextPollAfterMs,
        });
      }
    } catch (error) {
      if (isOffPeakBoundSessionConflict(error)) {
        return { ok: false, ...OFF_PEAK_SESSION_BOUND_FAILURE, providerName };
      }
      return {
        ok: false,
        ...classifyOffPeakCreateFailure(error, "local_persist"),
        providerName,
      };
    }
    this.deps.logger.info(
      `off-peak task created id=${offPeakTaskId} ticket=${ticket.ticketId} state=${ticket.state}`,
    );
    this.emitChanged();
    this.ensureSyncScheduled(0);
    if (ticket.state === "ready") {
      try {
        this.deps.requestSchedulerWake?.();
      } catch (error) {
        this.deps.logger.warn("off-peak scheduler wake failed after create:", error);
      }
    }
    return {
      ok: true,
      task: created,
      ticketInitialState: ticket.state,
      ...(ticket.position !== undefined ? { queuePosition: ticket.position } : {}),
      providerName,
    };
  }

  
  async cancelTask(offPeakTaskId: string): Promise<CfOffPeakTask | null> {
    const existing = await this.deps.repo.get(offPeakTaskId);
    if (!existing || isOffPeakTerminalStatus(existing.status)) return existing;
    const cancelled = await this.deps.repo.markTerminal(offPeakTaskId, {
      status: "cancelled",
      endedAt: this.now(),
    });
    if (!cancelled) return this.deps.repo.get(offPeakTaskId);
    if (this.residentExecutions.has(offPeakTaskId)) {
      try {
        await this.residentExecutions.cancel(offPeakTaskId);
      } catch (error) {
        this.deps.logger.warn(`off-peak lifecycle cancel failed task=${offPeakTaskId}:`, error);
      }
    } else if (
      existing.status === "running" &&
      existing.conversationId &&
      this.deps.stopRunningTask
    ) {
      try {
        await this.deps.stopRunningTask({
          conversationId: existing.conversationId,
          workspacePath: existing.workspacePath,
          ...(existing.workspaceIdentity ? { workspaceIdentity: existing.workspaceIdentity } : {}),
        });
      } catch (error) {
        this.deps.logger.warn(`off-peak cancel stop loop failed task=${offPeakTaskId}:`, error);
      }
    }
    this.emitChanged();
    void this.settleOne(cancelled);
    return cancelled;
  }

  
  async pauseTask(offPeakTaskId: string): Promise<CfOffPeakTask | null> {
    const paused = await this.deps.repo.setPaused(offPeakTaskId, true, {
      now: this.now(),
    });
    if (paused) this.emitChanged();
    return paused;
  }

  
  async continueTask(offPeakTaskId: string): Promise<CfOffPeakTask | null> {
    const resumed = await this.deps.repo.setPaused(offPeakTaskId, false, {
      now: this.now(),
    });
    if (!resumed) return null;
    let ticketAlive = false;
    if (resumed.serverTicketId) {
      try {
        const status = await this.deps.client.batchStatus([resumed.serverTicketId]);
        const entry = status.tickets.find((t) => t.ticketId === resumed.serverTicketId);
        ticketAlive =
          entry !== undefined && entry.state !== "expired" && entry.state !== "not_found";
        if (entry && ticketAlive) {
          await this.deps.repo.updateSchedulingSnapshot(offPeakTaskId, {
            schedulable: entry.state === "ready",
            queuePosition: entry.position ?? null,
            now: this.now(),
          });
        }
      } catch (error) {
        this.deps.logger.warn(
          `off-peak continue status check failed task=${offPeakTaskId}:`,
          error,
        );
        ticketAlive = true;
      }
    }
    if (!ticketAlive) {
      await this.retakeTicket(offPeakTaskId);
    }
    this.emitChanged();
    this.ensureSyncScheduled(0);
    return this.deps.repo.get(offPeakTaskId);
  }

  
  async deleteTask(offPeakTaskId: string): Promise<void> {
    const existing = await this.deps.repo.get(offPeakTaskId);
    if (!existing) return;
    if (!isOffPeakTerminalStatus(existing.status)) {
      await this.cancelTask(offPeakTaskId);
    }
    await this.deps.repo.delete(offPeakTaskId);
    this.emitChanged();
  }

  
  async deleteHistory(offPeakTaskId: string): Promise<CfOffPeakTask | null> {
    const updated = await this.deps.repo.markHistoryDeleted(offPeakTaskId, {
      now: this.now(),
    });
    if (updated) this.emitChanged();
    return updated;
  }

  
  async updateTask(
    offPeakTaskId: string,
    params: OffPeakUpdateTaskParams,
  ): Promise<CfOffPeakTask | null> {
    const existing = await this.deps.repo.get(offPeakTaskId);
    if (!existing) return null;
    if (existing.status !== "queued" && existing.status !== "paused") {
      return null;
    }
    if (params.modelSelection === null) return null;
    const candidate = params.modelSelection ?? existing.modelSelection;
    if (!candidate) return null;
    const selection = await this.deps.resolveModelSelection({
      modelId: candidate.modelId,
      ...(candidate.options?.reasoningLevel
        ? { reasoningLevel: candidate.options.reasoningLevel }
        : {}),
    });
    if (!selection.ok) return null;
    const normalizedParams: OffPeakUpdateTaskParams = {
      ...params,
      modelSelection: selection.selection,
    };
    const updated = await this.deps.repo.updateEditableFields(offPeakTaskId, normalizedParams, {
      now: this.now(),
    });
    if (updated) this.emitChanged();
    return updated;
  }

  async list(): Promise<CfOffPeakTask[]> {
    return this.projectModelSelectionIssues(await this.deps.repo.list());
  }

  async get(offPeakTaskId: string): Promise<CfOffPeakTask | null> {
    const task = await this.deps.repo.get(offPeakTaskId);
    if (!task) return null;
    return (await this.projectModelSelectionIssues([task]))[0] ?? null;
  }

  
  private async projectModelSelectionIssues(
    tasks: readonly CfOffPeakTask[],
  ): Promise<CfOffPeakTask[]> {
    const repaired: CfOffPeakTask[] = [];
    for (const task of tasks) {
      if (task.modelSelection) {
        const usable =
          isOffPeakTerminalStatus(task.status) ||
          (await this.validateDispatchModelSelection(task.modelSelection));
        repaired.push(
          usable
            ? task
            : {
                ...task,
                schedulable: false,
                modelSelectionIssue: {
                  code: "repair-required",
                  legacyModelId: task.modelSelection.modelId,
                  legacyReasoningLevel: task.modelSelection.options?.reasoningLevel,
                },
              },
        );
        continue;
      }
      repaired.push({ ...task, schedulable: false });
    }
    return repaired;
  }

  
  async handleTicketExpiredDuringRun(
    offPeakTaskId: string,
    current = this.residentExecutions.retakeGuard(offPeakTaskId),
  ): Promise<void> {
    if (!current()) return;
    const requeued = await this.deps.repo.requeueForContinuation(offPeakTaskId, {
      now: this.now(),
    });
    if (!current()) {
      if (this.residentExecutions.isUserOwned(offPeakTaskId))
        await this.deps.repo.markRunning(offPeakTaskId, { startedAt: this.now() });
      return;
    }
    if (!requeued) {
      this.deps.logger.info(
        `off-peak ticket-expired requeue dropped (not running) task=${offPeakTaskId}`,
      );
      return;
    }
    await this.retakeTicket(offPeakTaskId);
    this.emitChanged();
    this.ensureSyncScheduled(0);
  }

  
  private async retakeTicket(offPeakTaskId: string): Promise<void> {
    const existing = this.retakes.get(offPeakTaskId);
    if (existing) return existing;
    const current = this.residentExecutions.retakeGuard(offPeakTaskId);
    if (!current()) return;
    const pending = this.runRetakeTicket(offPeakTaskId, current).finally(() => {
      this.retakes.delete(offPeakTaskId);
    });
    this.retakes.set(offPeakTaskId, pending);
    return pending;
  }

  private async runRetakeTicket(offPeakTaskId: string, current: () => boolean): Promise<void> {
    try {
      const ticket = await this.deps.client.takeTicket(offPeakTaskId);
      const task = await this.deps.repo.get(offPeakTaskId);
      if (!current() || !task || isOffPeakTerminalStatus(task.status)) {
        await this.releaseExecutionTicket(ticket.ticketId);
        return;
      }
      await this.deps.repo.updateSchedulingSnapshot(offPeakTaskId, {
        serverTicketId: ticket.ticketId,
        registeredAt: ticket.registeredAt,
        schedulable: ticket.state === "ready",
        queuePosition: ticket.position ?? null,
        ...(ticket.nextPollAfterMs !== undefined
          ? { nextPollAt: this.now() + ticket.nextPollAfterMs }
          : {}),
        now: this.now(),
      });
      if (!current()) {
        await this.releaseExecutionTicket(ticket.ticketId);
        if (this.residentExecutions.isUserOwned(offPeakTaskId)) {
          await this.deps.repo.markRunning(offPeakTaskId, { startedAt: this.now() });
          await this.deps.repo.updateSchedulingSnapshot(offPeakTaskId, {
            serverTicketId: task.serverTicketId,
            schedulable: false,
            now: this.now(),
          });
        }
        return;
      }
      if (ticket.state === "ready") this.deps.requestSchedulerWake?.();
      this.deps.logger.info(
        `off-peak re-take ticket task=${offPeakTaskId} ticket=${ticket.ticketId} state=${ticket.state}`,
      );
    } catch (error) {
      this.deps.logger.warn(`off-peak re-take ticket failed task=${offPeakTaskId}:`, error);
    }
  }

  startSync(): void {
    if (!this.syncStopped) return;
    this.syncStopped = false;
    this.ensureSyncScheduled(0);
  }

  stopSync(): void {
    this.syncStopped = true;
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
  }

  
  disposeAll(): void {
    this.residentExecutions.dispose();
    this.stopSync();
    try {
      this.deps.onDispose?.();
    } catch (error) {
      this.deps.logger.warn("off-peak onDispose 清理失败:", error);
    }
  }

  private ensureSyncScheduled(delayMs: number): void {
    if (this.syncStopped) return;
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      void this.runSyncCycle();
    }, delayMs);
    this.syncTimer.unref?.();
  }

  
  async runSyncCycle(): Promise<void> {
    if (this.syncRunning) return;
    this.syncRunning = true;
    let nextDelay = OFF_PEAK_SYNC_MAX_INTERVAL_MS;
    try {
      await this.flushSettleOutbox();
      for (const ticketId of this.releasedTicketOutbox) await this.releaseExecutionTicket(ticketId);
      try {
        await this.residentExecutions.retryPendingTickets();
      } catch (error) {
        this.deps.logger.warn("off-peak ticket confirmation pending:", error);
      }
      const nonTerminal = await this.projectModelSelectionIssues(
        await this.deps.repo.listNonTerminal(),
      );
      const withTickets = nonTerminal.filter(
        (task) => task.serverTicketId && !this.residentExecutions.isUserOwned(task.offPeakTaskId),
      );
      for (const task of nonTerminal) {
        if (!task.serverTicketId && task.status === "queued") {
          await this.retakeTicket(task.offPeakTaskId);
        }
      }
      if (withTickets.length === 0 && nonTerminal.length === 0) {
        this.consecutiveSyncFailures = 0;
        return;
      }
      if (withTickets.length > 0) {
        const status = await this.deps.client.batchStatus(
          withTickets.map((task) => task.serverTicketId!),
        );
        let anyBecameSchedulable = false;
        for (const task of withTickets) {
          const entry = status.tickets.find((t) => t.ticketId === task.serverTicketId);
          if (!entry) continue;
          anyBecameSchedulable =
            (await this.applyTicketStatus(task, entry.state, entry.position)) ||
            anyBecameSchedulable;
        }
        if (anyBecameSchedulable) this.deps.requestSchedulerWake?.();
        if (status.nextPollAfterMs !== undefined) {
          nextDelay = status.nextPollAfterMs;
        } else {
          nextDelay = OFF_PEAK_SYNC_MIN_INTERVAL_MS;
        }
        this.emitChanged();
      } else {
        nextDelay = OFF_PEAK_SYNC_MIN_INTERVAL_MS;
      }
      this.consecutiveSyncFailures = 0;
    } catch (error) {
      this.consecutiveSyncFailures += 1;
      nextDelay = Math.min(
        SYNC_FAILURE_BASE_MS * 2 ** Math.max(0, this.consecutiveSyncFailures - 1),
        OFF_PEAK_SYNC_MAX_INTERVAL_MS,
      );
      this.deps.logger.warn(
        `off-peak sync cycle failed (attempt ${this.consecutiveSyncFailures}):`,
        error,
      );
    } finally {
      this.syncRunning = false;
      const clamped = Math.min(
        Math.max(nextDelay, OFF_PEAK_SYNC_MIN_INTERVAL_MS),
        OFF_PEAK_SYNC_MAX_INTERVAL_MS,
      );
      this.ensureSyncScheduled(clamped);
    }
  }

  
  private async applyTicketStatus(
    task: CfOffPeakTask,
    state: string,
    position: number | undefined,
  ): Promise<boolean> {
    const now = this.now();
    switch (state) {
      case "ready": {
        const became = task.schedulable !== true && task.status === "queued";
        await this.deps.repo.updateSchedulingSnapshot(task.offPeakTaskId, {
          schedulable: true,
          queuePosition: position ?? null,
          nextPollAt: now + OFF_PEAK_SYNC_MIN_INTERVAL_MS,
          now,
        });
        return became;
      }
      case "queued":
        await this.deps.repo.updateSchedulingSnapshot(task.offPeakTaskId, {
          schedulable: false,
          queuePosition: position ?? null,
          now,
        });
        return false;
      case "active":
        await this.deps.repo.updateSchedulingSnapshot(task.offPeakTaskId, {
          queuePosition: null,
          now,
        });
        return false;
      case "expired": {
        if (task.status === "queued") {
          await this.deps.repo.updateSchedulingSnapshot(task.offPeakTaskId, {
            schedulable: false,
            queuePosition: null,
            now,
          });
          await this.retakeTicket(task.offPeakTaskId);
        }
        return false;
      }
      case "settled":
      case "not_found":
      default:
        return false;
    }
  }

  
  private async flushSettleOutbox(): Promise<void> {
    const unsettled = await this.deps.repo.listUnsettledTerminal();
    for (const task of unsettled) {
      await this.settleOne(task);
    }
  }

  private async settleOne(task: CfOffPeakTask): Promise<void> {
    if (!task.serverTicketId) {
      await this.deps.repo.markSettled(task.offPeakTaskId, this.now());
      return;
    }
    try {
      await this.deps.client.settle(task.serverTicketId);
      await this.deps.repo.markSettled(task.offPeakTaskId, this.now());
    } catch (error) {
      if (error instanceof OffPeakServerError && error.httpStatus < 500) {
        await this.deps.repo.markSettled(task.offPeakTaskId, this.now());
        return;
      }
      this.deps.logger.warn(`off-peak settle failed ticket=${task.serverTicketId}:`, error);
    }
  }
}
