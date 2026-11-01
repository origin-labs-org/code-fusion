import {
  AutomationCreateLimitError,
  hasRelativeDelayMinutes,
  isAutomationCreateLimitError,
  type AutomationPort,
  type CronAutomation,
} from "@origin-ai/cf-contracts";
import {
  parseModelPickerValue,
  cfAutomationCheckTaskBindingResultSchema,
  cfAutomationCreateResultSchema,
  cfAutomationDeleteResultSchema,
  cfAutomationListResultSchema,
  cfAutomationUpdateResultSchema,
  cfProtocolMethods,
  type CfAutomationProtocol,
} from "@origin-ai/cf-shared";
import {
  ProtocolRequestError,
  type CfProtocolAgentServerContext,
  type CfProtocolSessionRecord,
} from "./server-types.js";

export const AUTOMATION_CREATE_FROM_AUTOMATION_RUN_ERROR =
  "Cannot create a scheduled task while running a scheduled task.";

export const AUTOMATION_CREATE_IN_BOUND_SESSION_ERROR =
  "Cannot create a scheduled task inside a session that already belongs to a scheduled task. " +
  "Ask the user to start a new chat to create another scheduled task.";

export const AUTOMATION_CREATE_BOUND_SESSION_CHECK_ERROR =
  "Cannot verify whether this session belongs to a scheduled task. Try again later.";

export function createProtocolAutomationPort(
  context: CfProtocolAgentServerContext,
  resolveOwnSession?: () => CfProtocolSessionRecord | undefined,
): AutomationPort {
  return {
    async create(input, createContext) {
      const activeSession =
        resolveOwnSession?.() ??
        (createContext?.sessionId ? context.sessions.get(createContext.sessionId) : undefined);
      if (activeSession?.activeAutomationId?.trim()) {
        throw new Error(AUTOMATION_CREATE_FROM_AUTOMATION_RUN_ERROR);
      }
      const ownSessionId = createContext?.sessionId ?? activeSession?.app.sessionId;
      if (ownSessionId) {
        let bound: boolean;
        try {
          try {
            const result = await context.requestClient(
              cfProtocolMethods.automationCheckTaskBinding,
              { targetTaskId: ownSessionId },
              cfAutomationCheckTaskBindingResultSchema,
            );
            bound = result.bound;
          } catch (error) {
            if (!(error instanceof ProtocolRequestError && error.code === -32601)) {
              throw error;
            }
            const legacyResult = await context.requestClient(
              cfProtocolMethods.automationList,
              {},
              cfAutomationListResultSchema,
            );
            bound = legacyResult.automations.some(
              (automation) => automation.targetTaskId === ownSessionId,
            );
          }
        } catch (error) {
          context.logger?.warn("Failed to check bound automations before CronCreate", {
            errorMessage: error instanceof Error ? error.message : String(error),
            event: "automation.create.bound_session_check.failed",
            sessionId: ownSessionId,
          });
          throw new Error(AUTOMATION_CREATE_BOUND_SESSION_CHECK_ERROR);
        }
        if (bound) {
          throw new Error(AUTOMATION_CREATE_IN_BOUND_SESSION_ERROR);
        }
      }
      const runtimeModelSelection =
        activeSession?.app.runtime.getSessionModelSelection() ??
        (() => {
          try {
            return createContext?.model ? parseModelPickerValue(createContext.model) : undefined;
          } catch {
            return undefined;
          }
        })();
      const runtimeMode = activeSession?.app.getMode();
      const hasIntervalCarrier = input.intervalUnit !== undefined && input.interval !== undefined;
      let result;
      try {
        result = await context.requestClient(
          cfProtocolMethods.automationCreate,
          {
            cronExpr: input.cron ?? "* * * * *",
            ...(hasRelativeDelayMinutes(input) ? { relativeDelayMinutes: input.delayMinutes } : {}),
            prompt: input.prompt,
            title: input.title,
            recurring: hasRelativeDelayMinutes(input)
              ? false
              : hasIntervalCarrier
                ? true
                : (input.recurring ?? true),
            ...(runtimeModelSelection ? { modelSelection: runtimeModelSelection } : {}),
            ...(runtimeMode ? { mode: runtimeMode === "auto" ? "build" : runtimeMode } : {}),
            ...(createContext?.sessionId ? { targetTaskId: createContext.sessionId } : {}),
            ...(activeSession?.activeBotDeliveryTarget
              ? { botDeliveryTarget: activeSession.activeBotDeliveryTarget }
              : {}),
            ...(hasIntervalCarrier
              ? {
                  intervalUnit: input.intervalUnit,
                  interval: input.interval,
                }
              : input.maxRuns !== undefined
                ? { maxRuns: input.maxRuns }
                : {}),
          },
          cfAutomationCreateResultSchema,
        );
      } catch (error) {
        if (!isAutomationCreateLimitError(error)) throw error;
        throw new AutomationCreateLimitError(
          error instanceof Error ? error.message : String(error),
          error,
        );
      }
      const automation = toCronAutomation(result.automation);
      const title = automation.title.trim();
      if (activeSession && title.length > 0) {
        try {
          await activeSession.app.setCustomSessionTitle({
            title,
            traceContext: activeSession.traceContext,
          });
        } catch (error) {
          context.logger?.warn("Failed to freeze session title after CronCreate", {
            errorMessage: error instanceof Error ? error.message : String(error),
            event: "automation.session_title_freeze.failed",
            sessionId: createContext?.sessionId,
          });
        }
      }
      return automation;
    },
    async update(input) {
      const hasIntervalCarrier = input.intervalUnit !== undefined && input.interval !== undefined;
      const result = await context.requestClient(
        cfProtocolMethods.automationUpdate,
        {
          automationId: input.id,
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.cron !== undefined ? { cronExpr: input.cron } : {}),
          ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
          ...(hasIntervalCarrier
            ? {
                recurring: true,
                maxRuns: null,
                intervalUnit: input.intervalUnit,
                interval: input.interval,
              }
            : {
                ...(input.recurring !== undefined ? { recurring: input.recurring } : {}),
                ...(input.maxRuns !== undefined ? { maxRuns: input.maxRuns } : {}),
              }),
        },
        cfAutomationUpdateResultSchema,
      );
      return toCronAutomation(result.automation);
    },
    async list() {
      const result = await context.requestClient(
        cfProtocolMethods.automationList,
        {},
        cfAutomationListResultSchema,
      );
      return result.automations.map(toCronAutomation);
    },
    async delete(input) {
      const result = await context.requestClient(
        cfProtocolMethods.automationDelete,
        { automationId: input.id },
        cfAutomationDeleteResultSchema,
      );
      return result.deleted;
    },
  };
}

function normalizeCronAutomationMode(
  mode: CfAutomationProtocol["mode"],
): CronAutomation["mode"] {
  switch (mode) {
    case undefined:
      return undefined;
    case "plan":
    case "edit":
    case "guarded":
    case "yolo":
    case "build":
      return mode;
    case "dontAsk":
    case "bypassPermissions":
      return "yolo";
    case "default":
    case "auto":
    case "acceptEdits":
    case "autoEdit":
      return "build";
    default: {
      const exhaustiveMode: never = mode;
      return exhaustiveMode;
    }
  }
}

function toCronAutomation(input: CfAutomationProtocol): CronAutomation {
  return {
    automationId: input.automationId,
    title: input.title,
    cronExpr: input.cronExpr,
    prompt: input.prompt,
    enabled: input.enabled,
    lifecycleStatus: input.lifecycleStatus,
    nextRunAt: input.nextRunAt,
    lastRunAt: input.lastRunAt,
    runCount: input.runCount,
    recurring: input.recurring,
    maxRuns: input.maxRuns,
    modelSelection: input.modelSelection,
    mode: normalizeCronAutomationMode(input.mode),
    scheduleRule: input.scheduleRule,
  };
}
