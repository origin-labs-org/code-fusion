import type {
  CfAutomationIntervalUnit,
  CfAutomationScheduleRule,
  CfAutomationUpdateParams,
} from "@origin-ai/cf-shared";

const MAX_SESSION_AUTOMATION_INTERVAL = 200;

export class InvalidAutomationIntervalCarrierError extends Error {
  constructor(message: string) {
    super(`非法的自定义重复入参：${message}`);
    this.name = "InvalidAutomationIntervalCarrierError";
  }
}

export function assertValidAutomationIntervalCarrier(input: {
  intervalUnit?: CfAutomationIntervalUnit;
  interval?: number;
  scheduleRule?: CfAutomationScheduleRule | null;
  relativeDelayMinutes?: number;
  recurring?: boolean;
  maxRuns?: number | null;
}): void {
  const { intervalUnit, interval, scheduleRule, relativeDelayMinutes, recurring, maxRuns } = input;
  if ((intervalUnit === undefined) !== (interval === undefined)) {
    throw new InvalidAutomationIntervalCarrierError(
      "intervalUnit 与 interval 必须同时提交或同时省略",
    );
  }
  if (
    interval !== undefined &&
    (!Number.isInteger(interval) || interval < 1 || interval > MAX_SESSION_AUTOMATION_INTERVAL)
  ) {
    throw new InvalidAutomationIntervalCarrierError("interval 必须是 1-200 的整数");
  }
  if (intervalUnit !== undefined && relativeDelayMinutes !== undefined) {
    throw new InvalidAutomationIntervalCarrierError(
      "intervalUnit 是周期 carrier，不能与一次性 relativeDelayMinutes 同时提交",
    );
  }
  if (intervalUnit !== undefined && scheduleRule !== undefined) {
    throw new InvalidAutomationIntervalCarrierError(
      "intervalUnit carrier 不能与直传 scheduleRule 同时提交",
    );
  }
  if (intervalUnit !== undefined && recurring === false) {
    throw new InvalidAutomationIntervalCarrierError("intervalUnit carrier 必须使用 recurring=true");
  }
  if (intervalUnit !== undefined && typeof maxRuns === "number") {
    throw new InvalidAutomationIntervalCarrierError(
      "intervalUnit carrier 不能与有限 maxRuns 同时提交",
    );
  }
}

export function forceIntervalCarrierRecurring(
  params: CfAutomationUpdateParams,
): CfAutomationUpdateParams {
  return { ...params, recurring: true, maxRuns: null };
}
