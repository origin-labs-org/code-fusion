import { assertValidAutomationScheduleRule } from "#src/session/automationCronValidation.js";
export { InvalidAutomationScheduleRuleError } from "#src/session/automationCronValidation.js";
import type {
  ProjectExecutionSnapshot,
  CfAutomation,
  CfAutomationCreateParams,
  CfAutomationRun,
  CfAutomationUpdateParams,
} from "@origin-ai/cf-shared";
import { resolveWorkspaceKey } from "@origin-ai/cf-shared";
import { AutomationRepo } from "#src/session/automationRepo.js";
import {
  assertValidAutomationIntervalCarrier,
  forceIntervalCarrierRecurring,
} from "#src/session/automationIntervalCarrier.js";
export { InvalidAutomationIntervalCarrierError } from "#src/session/automationIntervalCarrier.js";
import {
  buildIntervalScheduleRule,
  buildRelativeDelaySchedule,
  computeInitialAutomationNextRunAt,
  computeAutomationNextRunAt,
  inferMinuteIntervalScheduleRule,
  isValidCronExpr,
  scheduleRuleDefinition,
} from "#src/session/automationCron.js";

export interface AutomationWorkspaceScope {
  workspacePath: string;
  workspaceIdentity?: string;
}

function resolveScopeKey(scope?: AutomationWorkspaceScope): string | undefined {
  if (!scope?.workspacePath) return undefined;
  return resolveWorkspaceKey({
    workspacePath: scope.workspacePath,
    workspaceIdentity: scope.workspaceIdentity,
  });
}

export class InvalidCronExprError extends Error {
  constructor(cronExpr: string) {
    super(`非法的 cron 表达式：${cronExpr}`);
    this.name = "InvalidCronExprError";
  }
}

export class InvalidAutomationMaxRunsUpdateError extends Error {
  constructor(message = "清空 maxRuns 时必须在同一次更新中设置 recurring=true") {
    super(message);
    this.name = "InvalidAutomationMaxRunsUpdateError";
  }
}

export class InvalidAutomationRelativeDelayError extends Error {
  constructor(message: string) {
    super(`非法的E对时间Scheduled Tasks：${message}`);
    this.name = "InvalidAutomationRelativeDelayError";
  }
}

export class AutomationService {
  constructor(
    private readonly repo: AutomationRepo = new AutomationRepo(),
    private readonly prepareProjectExecution?: (
      projectId: string,
    ) => Promise<ProjectExecutionSnapshot>,
  ) {}

  async create(params: CfAutomationCreateParams): Promise<CfAutomation> {
    const createdAt = Date.now();
    const relativeDelayMinutes = params.relativeDelayMinutes;
    if (
      relativeDelayMinutes !== undefined &&
      (!Number.isInteger(relativeDelayMinutes) ||
        relativeDelayMinutes < 1 ||
        relativeDelayMinutes > 525_600)
    ) {
      throw new InvalidAutomationRelativeDelayError("delayMinutes 必须是 1-525600 的整数");
    }
    if (relativeDelayMinutes !== undefined && params.recurring) {
      throw new InvalidAutomationRelativeDelayError("相对延迟任务必须设置 recurring=false");
    }
    if (relativeDelayMinutes !== undefined && params.maxRuns !== undefined) {
      throw new InvalidAutomationRelativeDelayError("相对延迟任务固定只运行一次，不能设置 maxRuns");
    }
    if (relativeDelayMinutes !== undefined && params.scheduleRule) {
      throw new InvalidAutomationRelativeDelayError("不能同时提交 delayMinutes 和 scheduleRule");
    }
    const intervalUnit = params.intervalUnit;
    const interval = params.interval;
    assertValidAutomationIntervalCarrier({
      intervalUnit,
      interval,
      scheduleRule: params.scheduleRule,
      relativeDelayMinutes,
      recurring: params.recurring,
      maxRuns: params.maxRuns,
    });
    const {
      relativeDelayMinutes: _relativeDelayMinutes,
      intervalUnit: _intervalUnit,
      interval: _interval,
      ...persistedParams
    } = params;
    const relativeNormalizedParams =
      relativeDelayMinutes === undefined
        ? persistedParams
        : {
            ...persistedParams,
            ...buildRelativeDelaySchedule(relativeDelayMinutes, createdAt),
            recurring: false,
          };
    const normalizedParams =
      intervalUnit !== undefined && interval !== undefined
        ? {
            ...relativeNormalizedParams,
            recurring: true,
            maxRuns: undefined,
            scheduleRule: buildIntervalScheduleRule(
              intervalUnit,
              interval,
              relativeNormalizedParams.cronExpr,
              createdAt,
            ),
          }
        : relativeNormalizedParams;
    if (!isValidCronExpr(normalizedParams.cronExpr)) {
      throw new InvalidCronExprError(normalizedParams.cronExpr);
    }
    if (normalizedParams.scheduleRule) {
      assertValidAutomationScheduleRule(normalizedParams.scheduleRule);
    }
    const scheduleRule = normalizedParams.scheduleRule
      ? { ...normalizedParams.scheduleRule, anchorAt: createdAt }
      : inferMinuteIntervalScheduleRule(normalizedParams.cronExpr, createdAt);
    const createParams = scheduleRule ? { ...normalizedParams, scheduleRule } : normalizedParams;
    const nextRunAt = computeInitialAutomationNextRunAt(createParams, createdAt);
    const endedBeforeFirstRun =
      createParams.endAt !== undefined && (nextRunAt ?? Infinity) > createParams.endAt;
    let execution: ProjectExecutionSnapshot | undefined;
    if (createParams.projectId) {
      if (createParams.targetTaskId) throw new Error("project.bound-task");
      if (!this.prepareProjectExecution) throw new Error("project.creation-unavailable");
      execution = await this.prepareProjectExecution(createParams.projectId);
    }
    return this.repo.create(
      { ...createParams, ...execution },
      {
        nextRunAt: endedBeforeFirstRun ? null : nextRunAt,
        ...(endedBeforeFirstRun ? { lifecycleStatus: "completed" as const } : {}),
      },
    );
  }

  async list(scope?: {
    workspacePath?: string;
    workspaceIdentity?: string;
  }): Promise<CfAutomation[]> {
    return this.repo.list(scope);
  }

  async hasTaskBinding(scope: {
    workspacePath: string;
    workspaceIdentity?: string;
    targetTaskId: string;
  }): Promise<boolean> {
    return this.repo.hasTaskBinding(scope);
  }

  async get(
    automationId: string,
    scope?: AutomationWorkspaceScope,
  ): Promise<CfAutomation | null> {
    return this.repo.get(automationId, resolveScopeKey(scope));
  }

  async update(
    automationId: string,
    params: CfAutomationUpdateParams,
    scope?: AutomationWorkspaceScope,
  ): Promise<CfAutomation | null> {
    const workspaceKey = resolveScopeKey(scope);
    const existing = await this.repo.get(automationId, workspaceKey);
    if (!existing) return null;

    if (params.scheduleRule) assertValidAutomationScheduleRule(params.scheduleRule);

    const { intervalUnit, interval, scheduleRule: directScheduleRule, ...restParams } = params;
    const hasDirectScheduleRule = directScheduleRule !== undefined;
    assertValidAutomationIntervalCarrier({
      intervalUnit,
      interval,
      scheduleRule: hasDirectScheduleRule ? directScheduleRule : undefined,
      recurring: restParams.recurring,
      maxRuns: restParams.maxRuns,
    });
    const hasIntervalCarrier = intervalUnit !== undefined && interval !== undefined;

    if (!hasIntervalCarrier && restParams.maxRuns === null && restParams.recurring !== true) {
      throw new InvalidAutomationMaxRunsUpdateError();
    }

    const nextRecurring = hasIntervalCarrier ? true : (restParams.recurring ?? existing.recurring);
    if (nextRecurring && typeof restParams.maxRuns === "number") {
      throw new InvalidAutomationMaxRunsUpdateError("无限循环任务不能设置有限次数 maxRuns");
    }

    const normalizedParams: CfAutomationUpdateParams = hasIntervalCarrier
      ? forceIntervalCarrierRecurring(restParams)
      : nextRecurring &&
          restParams.maxRuns === undefined &&
          (restParams.recurring === true || existing.maxRuns !== undefined)
        ? { ...restParams, maxRuns: null }
        : restParams;

    const options: {
      nextRunAt?: number | null;
      lifecycleStatus?: CfAutomation["lifecycleStatus"];
      resetRetry?: boolean;
    } = {};

    const cronChanged =
      normalizedParams.cronExpr !== undefined && normalizedParams.cronExpr !== existing.cronExpr;
    if (normalizedParams.cronExpr !== undefined && !isValidCronExpr(normalizedParams.cronExpr)) {
      throw new InvalidCronExprError(normalizedParams.cronExpr);
    }
    const updatedAt = Date.now();
    const effectiveCron = normalizedParams.cronExpr ?? existing.cronExpr;
    const carrierScheduleRule = hasIntervalCarrier
      ? buildIntervalScheduleRule(intervalUnit, interval, effectiveCron, updatedAt)
      : undefined;
    const effectiveDirectScheduleRule = hasDirectScheduleRule
      ? directScheduleRule
      : carrierScheduleRule;
    const normalizedWithSchedule: CfAutomationUpdateParams =
      effectiveDirectScheduleRule !== undefined
        ? { ...normalizedParams, scheduleRule: effectiveDirectScheduleRule }
        : normalizedParams;
    if (effectiveDirectScheduleRule) {
      assertValidAutomationScheduleRule(effectiveDirectScheduleRule);
    }
    const explicitScheduleRule = effectiveDirectScheduleRule
      ? {
          ...effectiveDirectScheduleRule,
          anchorAt:
            existing.scheduleRule &&
            scheduleRuleDefinition(existing.scheduleRule) ===
              scheduleRuleDefinition(effectiveDirectScheduleRule)
              ? existing.scheduleRule.anchorAt
              : updatedAt,
        }
      : effectiveDirectScheduleRule;
    const inferredScheduleRule =
      cronChanged && effectiveDirectScheduleRule === undefined
        ? inferMinuteIntervalScheduleRule(effectiveCron, updatedAt)
        : undefined;
    const effectiveScheduleRule =
      effectiveDirectScheduleRule === undefined
        ? cronChanged
          ? inferredScheduleRule
          : existing.scheduleRule
        : (explicitScheduleRule ?? undefined);
    const updateParams =
      cronChanged && effectiveDirectScheduleRule === undefined
        ? { ...normalizedWithSchedule, scheduleRule: inferredScheduleRule ?? null }
        : effectiveDirectScheduleRule === undefined
          ? normalizedWithSchedule
          : { ...normalizedWithSchedule, scheduleRule: explicitScheduleRule ?? null };
    if (
      cronChanged ||
      normalizedParams.endAt !== undefined ||
      effectiveDirectScheduleRule !== undefined
    ) {
      options.nextRunAt = computeAutomationNextRunAt(
        {
          cronExpr: effectiveCron,
          scheduleRule: effectiveScheduleRule,
        },
        updatedAt,
      );
      options.resetRetry = true;
    }

    const effectiveEndAt =
      normalizedParams.endAt === undefined ? existing.endAt : (normalizedParams.endAt ?? undefined);
    if (
      effectiveEndAt !== undefined &&
      (options.nextRunAt ?? existing.nextRunAt ?? Infinity) > effectiveEndAt
    ) {
      options.nextRunAt = null;
      options.lifecycleStatus = "completed";
    } else if (
      normalizedParams.endAt !== undefined &&
      (existing.lifecycleStatus === "completed" || existing.lifecycleStatus === "failed")
    ) {
      options.lifecycleStatus = "active";
    }

    if (normalizedParams.recurring !== undefined || normalizedParams.maxRuns !== undefined) {
      const nextMaxRuns =
        normalizedParams.maxRuns === undefined
          ? existing.maxRuns
          : (normalizedParams.maxRuns ?? undefined);
      const scheduledRunCount = await this.repo.getScheduledRunCount(automationId, workspaceKey);
      if (scheduledRunCount === null) return null;
      const reachedMax = !nextRecurring && scheduledRunCount >= (nextMaxRuns ?? 1);
      if (reachedMax) {
        options.lifecycleStatus = "completed";
      } else if (
        existing.lifecycleStatus === "completed" ||
        existing.lifecycleStatus === "failed"
      ) {
        options.lifecycleStatus = "active";
        if (options.nextRunAt === undefined) {
          options.nextRunAt = computeAutomationNextRunAt(
            {
              cronExpr: effectiveCron,
              scheduleRule: effectiveScheduleRule,
            },
            updatedAt,
          );
        }
      }
    }

    return this.repo.update(automationId, updateParams, options, workspaceKey);
  }

  async delete(automationId: string, scope?: AutomationWorkspaceScope): Promise<boolean> {
    return this.repo.delete(automationId, resolveScopeKey(scope));
  }

  
  async setEnabled(
    automationId: string,
    enabled: boolean,
    scope?: AutomationWorkspaceScope,
  ): Promise<void> {
    return this.repo.setEnabled(automationId, enabled, resolveScopeKey(scope));
  }

  
  async restart(automationId: string, scope?: AutomationWorkspaceScope): Promise<void> {
    const workspaceKey = resolveScopeKey(scope);
    const existing = await this.repo.get(automationId, workspaceKey);
    if (!existing) return;
    if (existing.lifecycleStatus !== "failed") return;
    const nextRunAt = computeAutomationNextRunAt(existing);
    return this.repo.restart(automationId, { nextRunAt }, workspaceKey);
  }

  
  async runNow(
    automationId: string,
    scope?: AutomationWorkspaceScope,
  ): Promise<{ automation: CfAutomation; run: CfAutomationRun } | null> {
    const workspaceKey = resolveScopeKey(scope);
    const existing = await this.repo.get(automationId, workspaceKey);
    if (!existing) return null;
    return this.repo.runNow(automationId, { now: Date.now() }, workspaceKey);
  }

  async listRuns(
    automationId: string,
    scope?: AutomationWorkspaceScope,
  ): Promise<CfAutomationRun[]> {
    return this.repo.listRuns(automationId, resolveScopeKey(scope));
  }
  async deleteRun(runId: string, scope?: AutomationWorkspaceScope): Promise<void> {
    return this.repo.deleteRun(runId, resolveScopeKey(scope));
  }
}
