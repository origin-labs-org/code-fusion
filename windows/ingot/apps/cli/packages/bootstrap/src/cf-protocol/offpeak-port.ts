import type { OffPeakPort, OffPeakTaskSummary } from "@origin-ai/cf-contracts";
import {
  cfOffPeakCreateResultSchema,
  cfOffPeakListResultSchema,
  cfProtocolMethods,
  type CfOffPeakTaskProtocolSnapshot,
} from "@origin-ai/cf-shared";
import type {
  CfProtocolAgentServerContext,
  CfProtocolSessionRecord,
} from "./server-types.js";

export const OFF_PEAK_CREATE_FROM_OFF_PEAK_RUN_ERROR =
  "Cannot create an idle-time task while running an idle-time task.";
export const OFF_PEAK_CREATE_IN_BOUND_SESSION_ERROR =
  "This session already has a pending idle-time task. Wait for it to finish (or cancel it in Automations) before creating another one here.";
export const OFF_PEAK_CREATE_BOUND_SESSION_CHECK_ERROR =
  "Cannot verify whether this session already has a pending idle-time task; try again later.";

const OFF_PEAK_TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

export function createProtocolOffPeakPort(
  context: CfProtocolAgentServerContext,
  resolveOwnSession?: () => CfProtocolSessionRecord | undefined,
): OffPeakPort {
  return {
    async create(input, createContext) {
      const activeSession =
        resolveOwnSession?.() ??
        (createContext?.sessionId ? context.sessions.get(createContext.sessionId) : undefined);
      if (activeSession?.activeOffPeakTaskId?.trim()) {
        throw new Error(OFF_PEAK_CREATE_FROM_OFF_PEAK_RUN_ERROR);
      }
      const boundSessionId = createContext?.sessionId ?? activeSession?.app.sessionId;
      if (boundSessionId) {
        let bound: boolean;
        try {
          const listed = await context.requestClient(
            cfProtocolMethods.offPeakList,
            {},
            cfOffPeakListResultSchema,
          );
          bound = listed.tasks.some(
            (task) => task.sessionId === boundSessionId && !OFF_PEAK_TERMINAL_STATUSES.has(task.status),
          );
        } catch (error) {
          context.logger?.warn("Failed to check bound idle-time tasks before OffPeakCreate", {
            errorMessage: error instanceof Error ? error.message : String(error),
            event: "offpeak.create.bound_session_check.failed",
            sessionId: boundSessionId,
          });
          throw new Error(OFF_PEAK_CREATE_BOUND_SESSION_CHECK_ERROR);
        }
        if (bound) throw new Error(OFF_PEAK_CREATE_IN_BOUND_SESSION_ERROR);
      }
      const result = await context.requestClient(
        cfProtocolMethods.offPeakCreate,
        {
          title: input.title,
          prompt: input.prompt,
          ...(input.permissionMode ? { permissionMode: input.permissionMode } : {}),
          ...(input.model ? { model: input.model } : {}),
          ...(input.thoughtLevel ? { thoughtLevel: input.thoughtLevel } : {}),
          ...(boundSessionId ? { boundSessionId } : {}),
        },
        cfOffPeakCreateResultSchema,
      );
      if (!result.ok) {
        return {
          ok: false,
          failureStage: result.failureStage,
          errorCategory: result.errorCategory,
          errorCode: result.errorCode,
        };
      }
      return { ok: true, task: toOffPeakTaskSummary(result.task) };
    },
    async list() {
      const result = await context.requestClient(
        cfProtocolMethods.offPeakList,
        {},
        cfOffPeakListResultSchema,
      );
      return result.tasks.map(toOffPeakTaskSummary);
    },
  };
}

function toOffPeakTaskSummary(input: CfOffPeakTaskProtocolSnapshot): OffPeakTaskSummary {
  return {
    offPeakTaskId: input.offPeakTaskId,
    title: input.title,
    status: input.status,
    queuePosition: input.queuePosition,
    sessionId: input.sessionId,
    createdAt: input.createdAt,
  };
}
