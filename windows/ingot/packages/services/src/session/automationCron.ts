import { Cron } from "croner";
import type { CfAutomation, CfAutomationScheduleRule } from "@origin-ai/cf-shared";
import { isValidCronExpr } from "#src/session/automationCronValidation.js";

export { isValidCronExpr } from "#src/session/automationCronValidation.js";

const ONE_SHOT_MISSED_RUN_GRACE_MS = 60 * 1_000;
const ONE_SHOT_STALE_TARGET_WINDOW_MS = 30 * 60 * 1_000;
const FIXED_CALENDAR_CRON = /^\d+\s+\d+\s+\d+\s+\d+\s+\*$/;

export function scheduleRuleDefinition(rule: CfAutomationScheduleRule): string {
  return JSON.stringify([
    rule.unit,
    rule.interval,
    rule.hour,
    rule.minute,
    rule.weekdays ? [...rule.weekdays].sort((a, b) => a - b) : null,
    rule.monthDays ? [...rule.monthDays].sort((a, b) => a - b) : null,
    rule.months ? [...rule.months].sort((a, b) => a - b) : null,
    rule.monthlyMode ?? null,
  ]);
}

export class StaleOneShotAutomationScheduleError extends Error {
  constructor(targetAt: number) {
    super(
      `One次性Scheduled Tasks的Target时间（${new Date(targetAt).toLocaleString()}）已过去；E对时间请使用 delayMinutes，绝对时间Please confirm未来时刻后Retry`,
    );
    this.name = "StaleOneShotAutomationScheduleError";
  }
}

export function isOneShotAutomation(
  automation: Pick<CfAutomation, "recurring" | "maxRuns">,
): boolean {
  return !automation.recurring && (automation.maxRuns ?? 1) <= 1;
}

export function computeNextRunAt(cronExpr: string, from?: number): number | null {
  const cron = new Cron(cronExpr);
  const next = cron.nextRun(from === undefined ? undefined : new Date(from));
  return next ? next.getTime() : null;
}

export function buildRelativeDelaySchedule(
  delayMinutes: number,
  from = Date.now(),
): Pick<CfAutomation, "cronExpr" | "scheduleRule"> {
  const target = new Date(from + delayMinutes * 60 * 1_000);
  return {
    cronExpr: `${target.getMinutes()} ${target.getHours()} ${target.getDate()} ${target.getMonth() + 1} *`,
    scheduleRule: {
      unit: "minute",
      interval: delayMinutes,
      hour: target.getHours(),
      minute: target.getMinutes(),
      anchorAt: from,
    },
  };
}

export function computeInitialAutomationNextRunAt(
  automation: Pick<CfAutomation, "cronExpr" | "recurring" | "scheduleRule">,
  from = Date.now(),
): number | null {
  const nextRunAt = computeAutomationNextRunAt(automation, from);
  if (
    automation.recurring ||
    automation.scheduleRule ||
    !FIXED_CALENDAR_CRON.test(automation.cronExpr.trim())
  ) {
    return nextRunAt;
  }

  const cron = new Cron(automation.cronExpr);
  const previousRun = cron.previousRuns(1, new Date(from))[0]?.getTime();
  const targetAge =
    previousRun !== undefined &&
    from >= previousRun &&
    from - previousRun <= ONE_SHOT_STALE_TARGET_WINDOW_MS
      ? from - previousRun
      : undefined;
  const rolledToNextCalendarOccurrence =
    nextRunAt === null || nextRunAt - from > ONE_SHOT_STALE_TARGET_WINDOW_MS;
  if (targetAge !== undefined && rolledToNextCalendarOccurrence) {
    if (targetAge < ONE_SHOT_MISSED_RUN_GRACE_MS) return from;

    throw new StaleOneShotAutomationScheduleError(from - targetAge);
  }
  return nextRunAt;
}

function atTime(date: Date, hour: number, minute: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute, 0, 0);
}

function firstWeekdayOfMonth(year: number, month: number, weekday: number): Date {
  const first = new Date(year, month, 1);
  return new Date(year, month, 1 + ((weekday - first.getDay() + 7) % 7));
}

export function computeScheduleRuleNextRunAt(
  rule: CfAutomationScheduleRule,
  from = Date.now(),
): number | null {
  const interval = Math.max(1, Math.floor(rule.interval));
  const anchor = new Date(rule.anchorAt);

  if (rule.unit === "minute") {
    const step = interval * 60 * 1_000;
    const steps = Math.max(1, Math.floor((from - rule.anchorAt) / step) + 1);
    return rule.anchorAt + steps * step;
  }

  if (rule.unit === "hourly") {
    const base = new Date(anchor);
    base.setMinutes(rule.minute, 0, 0);
    const step = interval * 60 * 60 * 1_000;
    const steps = Math.max(0, Math.floor((from - base.getTime()) / step) + 1);
    return base.getTime() + steps * step;
  }

  if (rule.unit === "daily") {
    for (let index = 0; index < 36_600; index += 1) {
      const date = new Date(
        anchor.getFullYear(),
        anchor.getMonth(),
        anchor.getDate() + index * interval,
      );
      const candidate = atTime(date, rule.hour, rule.minute).getTime();
      if (candidate > from) return candidate;
    }
    return null;
  }

  if (rule.unit === "weekly") {
    const anchorWeek = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
    anchorWeek.setDate(anchorWeek.getDate() - ((anchorWeek.getDay() + 6) % 7));
    const weekdays = [...(rule.weekdays?.length ? rule.weekdays : [1])].sort();
    for (let week = 0; week < 5_220; week += interval) {
      for (const weekday of weekdays) {
        const dayOffset = (weekday + 6) % 7;
        const date = new Date(
          anchorWeek.getFullYear(),
          anchorWeek.getMonth(),
          anchorWeek.getDate() + week * 7 + dayOffset,
        );
        const candidate = atTime(date, rule.hour, rule.minute).getTime();
        if (candidate > from) return candidate;
      }
    }
    return null;
  }

  if (rule.unit === "monthly") {
    for (let offset = 0; offset <= 1_200; offset += interval) {
      const month = new Date(anchor.getFullYear(), anchor.getMonth() + offset, 1);
      const candidates =
        rule.monthlyMode === "weekday"
          ? [firstWeekdayOfMonth(month.getFullYear(), month.getMonth(), rule.weekdays?.[0] ?? 1)]
          : [...(rule.monthDays?.length ? rule.monthDays : [1])]
              .sort((left, right) => left - right)
              .map((day) => new Date(month.getFullYear(), month.getMonth(), day))
              .filter((date) => date.getMonth() === month.getMonth());
      for (const date of candidates) {
        const candidate = atTime(date, rule.hour, rule.minute).getTime();
        if (candidate > from) return candidate;
      }
    }
    return null;
  }

  const targetMonth =
    rule.months?.[0] != null ? (((rule.months[0] - 1) % 12) + 12) % 12 : anchor.getMonth();
  const targetDay = rule.monthDays?.[0] ?? anchor.getDate();
  for (let offset = 0; offset < 400; offset += interval) {
    const date = new Date(anchor.getFullYear() + offset, targetMonth, targetDay);
    if (date.getMonth() !== targetMonth) continue;
    const candidate = atTime(date, rule.hour, rule.minute).getTime();
    if (candidate > from) return candidate;
  }
  return null;
}

export function inferMinuteIntervalScheduleRule(
  cronExpr: string,
  anchorAt: number,
): CfAutomationScheduleRule | undefined {
  const match = /^\*\/([1-9]\d*)\s+\*\s+\*\s+\*\s+\*$/.exec(cronExpr.trim());
  if (!match) return undefined;
  return {
    unit: "minute",
    interval: Number(match[1]),
    hour: new Date(anchorAt).getHours(),
    minute: new Date(anchorAt).getMinutes(),
    anchorAt,
  };
}

function parseCronFields(cronExpr: string): {
  minute?: number;
  hour?: number;
  monthDays?: number[];
  months?: number[];
  weekdays?: number[];
} {
  const parts = cronExpr.trim().split(/\s+/);
  const [minuteToken, hourToken, domToken, monthToken, dowToken] = parts;
  if (parts.length < 5 || minuteToken === undefined) return {};
  const parseSingle = (token: string): number | undefined => {
    if (token === "*" || token === "?") return undefined;
    const value = Number(token);
    return Number.isInteger(value) ? value : undefined;
  };
  const parseList = (token: string): number[] | undefined => {
    if (token === "*" || token === "?") return undefined;
    const values = token
      .split(",")
      .map((piece) => Number(piece))
      .filter((value) => Number.isInteger(value));
    return values.length > 0 ? values : undefined;
  };
  return {
    minute: parseSingle(minuteToken),
    hour: hourToken === undefined ? undefined : parseSingle(hourToken),
    monthDays: domToken === undefined ? undefined : parseList(domToken),
    months: monthToken === undefined ? undefined : parseList(monthToken),
    weekdays: dowToken === undefined ? undefined : parseList(dowToken),
  };
}

export function buildIntervalScheduleRule(
  intervalUnit: CfAutomationScheduleRule["unit"],
  interval: number,
  cronExpr: string,
  anchorAt: number,
): CfAutomationScheduleRule {
  const fields = parseCronFields(cronExpr);
  const anchor = new Date(anchorAt);
  const minute = fields.minute ?? anchor.getMinutes();
  const hour = fields.hour ?? anchor.getHours();
  const monthDays = fields.monthDays ?? [anchor.getDate()];
  const months = fields.months ?? [anchor.getMonth() + 1];
  const weekdays = fields.weekdays ?? [1];

  switch (intervalUnit) {
    case "minute":
      return {
        unit: "minute",
        interval,
        hour: anchor.getHours(),
        minute: anchor.getMinutes(),
        anchorAt,
      };
    case "hourly":
      return { unit: "hourly", interval, hour: 0, minute, anchorAt };
    case "daily":
      return { unit: "daily", interval, hour, minute, anchorAt };
    case "weekly":
      return { unit: "weekly", interval, hour, minute, weekdays, anchorAt };
    case "monthly":
      return {
        unit: "monthly",
        interval,
        hour,
        minute,
        monthDays,
        monthlyMode: "date",
        anchorAt,
      };
    case "yearly":
      return { unit: "yearly", interval, hour, minute, months, monthDays, anchorAt };
    default: {
      const exhaustive: never = intervalUnit;
      throw new Error(`Unsupported intervalUnit: ${String(exhaustive)}`);
    }
  }
}

export function computeAutomationNextRunAt(
  automation: Pick<CfAutomation, "cronExpr" | "scheduleRule">,
  from?: number,
): number | null {
  return automation.scheduleRule
    ? computeScheduleRuleNextRunAt(automation.scheduleRule, from)
    : computeNextRunAt(automation.cronExpr, from);
}
