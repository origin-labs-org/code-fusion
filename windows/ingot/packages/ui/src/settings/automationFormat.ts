
export interface IntlLike {
  formatMessage: (descriptor: { id: string }, values?: Record<string, string>) => string;
}

export type AutomationStatusKind = "active" | "paused" | "completed" | "failed";

interface AutomationStatusLike {
  lifecycleStatus: AutomationStatusKind;
  enabled: boolean;
}

interface AutomationFailureLike {
  lifecycleStatus: AutomationStatusKind;
  dispatchStatus?: "idle" | "claimed" | "dispatched" | "failed_to_dispatch";
  dispatchAttempts?: number;
  retryAt?: number;
  lastError?: string;
}

export function hasAutomationFailureState(automation: AutomationFailureLike): boolean {
  return (
    automation.lifecycleStatus === "failed" ||
    automation.dispatchStatus === "failed_to_dispatch" ||
    Boolean(automation.lastError?.trim())
  );
}

export function hasAutomationRetryQueueState(automation: AutomationFailureLike): boolean {
  return (
    hasAutomationFailureState(automation) &&
    automation.dispatchStatus === "failed_to_dispatch" &&
    (automation.dispatchAttempts ?? 0) > 0 &&
    typeof automation.retryAt === "number"
  );
}

export function resolveAutomationStatusKind(
  automation: AutomationStatusLike,
): AutomationStatusKind {
  if (automation.lifecycleStatus === "failed") return "failed";
  if (automation.lifecycleStatus === "completed") return "completed";
  if (automation.lifecycleStatus === "paused" || !automation.enabled) return "paused";
  return "active";
}

export type CronFrequency = "hourly" | "daily" | "weekdays" | "weekly" | "monthly" | "custom";
export type CustomRepeatUnit = "minute" | "hourly" | "daily" | "weekly" | "monthly" | "yearly";
export type CustomMonthlyMode = "date" | "weekday";

export interface CronBuilderState {
  frequency: CronFrequency;
  
  hour: number;
  
  minute: number;
  
  weekdays: number[];
  
  dayOfMonth: number;
  
  rawExpr: string;
  customInterval: number;
  customUnit: CustomRepeatUnit;
  customWeekdays: number[];
  customMonthDays: number[];
  
  customMonth: number;
  customMonthlyMode: CustomMonthlyMode;
}

export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

const pad2 = (value: number): string => String(value).padStart(2, "0");
const AUTOMATION_CARD_RELATIVE_NEXT_RUN_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;

export function isSessionCreatedAutomation(
  automation: { targetTaskId?: string } | null | undefined,
): boolean {
  return Boolean(automation?.targetTaskId?.trim());
}

export function buildAutomationEditCronExpr(
  state: CronBuilderState,
  automation: { cronExpr: string; targetTaskId?: string } | null | undefined,
): string {
  return isSessionCreatedAutomation(automation) ? automation!.cronExpr : buildCronExpr(state);
}

export function buildCronExpr(state: CronBuilderState): string {
  const { frequency, hour, minute, weekdays, dayOfMonth, rawExpr } = state;
  switch (frequency) {
    case "hourly":
      return `${minute} * * * *`;
    case "daily":
      return `${minute} ${hour} * * *`;
    case "weekdays":
      return `${minute} ${hour} * * 1-5`;
    case "weekly": {
      const days = weekdays.length > 0 ? [...weekdays].sort((a, b) => a - b).join(",") : "*";
      return `${minute} ${hour} * * ${days}`;
    }
    case "monthly":
      return `${minute} ${hour} ${dayOfMonth} * *`;
    case "custom": {
      const interval = Math.max(1, Math.floor(state.customInterval));
      if (state.customUnit === "minute") {
        return interval <= 59 ? `*/${interval} * * * *` : "* * * * *";
      }
      if (state.customUnit === "hourly") {
        return interval <= 24 ? `${minute} */${interval} * * *` : `${minute} * * * *`;
      }
      if (state.customUnit === "daily") {
        return interval <= 31 ? `${minute} ${hour} */${interval} * *` : `${minute} ${hour} * * *`;
      }
      if (state.customUnit === "weekly") {
        const days = state.customWeekdays.length > 0 ? state.customWeekdays.join(",") : "1";
        return `${minute} ${hour} * * ${days}`;
      }
      if (state.customUnit === "monthly") {
        if (state.customMonthlyMode === "weekday") {
          return `${minute} ${hour} * * ${state.customWeekdays[0] ?? 1}#1`;
        }
        const days = state.customMonthDays.length > 0 ? state.customMonthDays.join(",") : "1";
        return `${minute} ${hour} ${days} * *`;
      }
      const yearMonth = Math.min(12, Math.max(1, Math.floor(state.customMonth)));
      const yearDay = state.customMonthDays[0] ?? new Date().getDate();
      return `${minute} ${hour} ${yearDay} ${yearMonth} *`;
    }
    default:
      return rawExpr.trim();
  }
}

export function parseCronToBuilder(expr: string): CronBuilderState {
  const fallback: CronBuilderState = {
    frequency: "custom",
    hour: 9,
    minute: 0,
    weekdays: [1],
    dayOfMonth: 1,
    rawExpr: expr,
    customInterval: 1,
    customUnit: "daily",
    customWeekdays: [1],
    customMonthDays: [1],
    customMonth: new Date().getMonth() + 1,
    customMonthlyMode: "date",
  };
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return fallback;
  const min = parts[0]!;
  const hr = parts[1]!;
  const dom = parts[2]!;
  const mon = parts[3]!;
  const dow = parts[4]!;
  const minNum = Number(min);
  const hrNum = Number(hr);
  const isNum = (v: string) => /^\d+$/.test(v);

  const minuteInterval = /^\*\/([1-9]\d*)$/.exec(min);
  if (minuteInterval && hr === "*" && dom === "*" && mon === "*" && dow === "*") {
    return {
      ...fallback,
      frequency: "custom",
      customInterval: Number(minuteInterval[1]),
      customUnit: "minute",
    };
  }

  const hourlyInterval = /^\*\/(\d+)$/.exec(hr);
  if (isNum(min) && hourlyInterval && dom === "*" && mon === "*" && dow === "*") {
    return {
      ...fallback,
      frequency: "custom",
      minute: minNum,
      customInterval: Math.max(1, Number(hourlyInterval[1])),
      customUnit: "hourly",
    };
  }
  const dailyInterval = /^\*\/(\d+)$/.exec(dom);
  if (isNum(min) && isNum(hr) && dailyInterval && mon === "*" && dow === "*") {
    return {
      ...fallback,
      frequency: "custom",
      hour: hrNum,
      minute: minNum,
      customInterval: Math.max(1, Number(dailyInterval[1])),
      customUnit: "daily",
    };
  }

  if (isNum(min) && hr === "*" && dom === "*" && mon === "*" && dow === "*") {
    return { ...fallback, frequency: "hourly", minute: minNum };
  }
  if (isNum(min) && isNum(hr) && dom === "*" && mon === "*" && dow === "*") {
    return { ...fallback, frequency: "daily", hour: hrNum, minute: minNum };
  }
  if (isNum(min) && isNum(hr) && dom === "*" && mon === "*" && dow === "1-5") {
    return { ...fallback, frequency: "weekdays", hour: hrNum, minute: minNum };
  }
  if (isNum(min) && isNum(hr) && dom === "*" && mon === "*" && dow !== "*") {
    const days = dow
      .split(",")
      .map((d) => Number(d))
      .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
    if (days.length > 0) {
      return { ...fallback, frequency: "weekly", hour: hrNum, minute: minNum, weekdays: days };
    }
  }
  if (isNum(min) && isNum(hr) && isNum(dom) && isNum(mon) && dow === "*") {
    const monthNum = Number(mon);
    if (monthNum >= 1 && monthNum <= 12) {
      return {
        ...fallback,
        frequency: "custom",
        hour: hrNum,
        minute: minNum,
        customUnit: "yearly",
        customMonth: monthNum,
        customMonthDays: [Number(dom)],
      };
    }
  }
  if (isNum(min) && isNum(hr) && isNum(dom) && mon === "*" && dow === "*") {
    return {
      ...fallback,
      frequency: "monthly",
      hour: hrNum,
      minute: minNum,
      dayOfMonth: Number(dom),
    };
  }
  return fallback;
}

function weekdayLabel(day: number, intl: IntlLike): string {
  return intl.formatMessage({ id: `automations.weekday.${day}` });
}

export function describeCronBuilder(state: CronBuilderState, intl: IntlLike): string {
  const time = `${pad2(state.hour)}:${pad2(state.minute)}`;
  switch (state.frequency) {
    case "hourly":
      return intl.formatMessage(
        { id: "automations.schedule.hourly" },
        { minute: pad2(state.minute) },
      );
    case "daily":
      return intl.formatMessage({ id: "automations.schedule.daily" }, { time });
    case "weekdays":
      return intl.formatMessage({ id: "automations.schedule.weekdays" }, { time });
    case "weekly": {
      const days = [...state.weekdays]
        .sort((a, b) => WEEKDAY_ORDER.indexOf(a as never) - WEEKDAY_ORDER.indexOf(b as never))
        .map((d) => weekdayLabel(d, intl))
        .join("、");
      return intl.formatMessage({ id: "automations.schedule.weekly" }, { days, time });
    }
    case "monthly":
      return intl.formatMessage(
        { id: "automations.schedule.monthly" },
        { day: String(state.dayOfMonth), time },
      );
    case "custom": {
      if (state.customUnit === "minute") {
        return intl.formatMessage(
          { id: "automations.schedule.customMinutes" },
          { interval: String(state.customInterval) },
        );
      }
      if (state.customUnit === "hourly") {
        return intl.formatMessage(
          { id: "automations.schedule.customHourly" },
          {
            interval: String(state.customInterval),
            time: pad2(state.minute),
          },
        );
      }
      if (state.customUnit === "weekly") {
        const days = state.customWeekdays
          .map((day) => weekdayLabel(day, intl))
          .join(intl.formatMessage({ id: "automations.weekday.separator" }));
        return intl.formatMessage(
          { id: "automations.schedule.customWeekly" },
          { interval: String(state.customInterval), days, time },
        );
      }
      if (state.customUnit === "monthly") {
        if (state.customMonthlyMode === "weekday") {
          return intl.formatMessage(
            { id: "automations.schedule.customMonthlyWeekday" },
            {
              interval: String(state.customInterval),
              day: weekdayLabel(state.customWeekdays[0] ?? 1, intl),
              time,
            },
          );
        }
        return intl.formatMessage(
          { id: "automations.schedule.customMonthlyDates" },
          {
            interval: String(state.customInterval),
            days: state.customMonthDays.join(", "),
            time,
          },
        );
      }
      if (state.customUnit === "yearly") {
        return intl.formatMessage(
          { id: "automations.schedule.customYearly" },
          {
            interval: String(state.customInterval),
            month: String(state.customMonth),
            day: String(state.customMonthDays[0] ?? 1),
            time,
          },
        );
      }
      const unitId = "automations.customRepeat.unit.day";
      return intl.formatMessage(
        { id: "automations.schedule.custom" },
        {
          interval: String(state.customInterval),
          unit: intl.formatMessage({ id: unitId }),
          time,
        },
      );
    }
    default:
      return state.rawExpr;
  }
}

export function describeCron(expr: string, intl: IntlLike): string {
  const normalizedExpr = expr.trim().replace(/\s+/g, " ");
  const minuteInterval = /^\*\/([1-9]\d*) \* \* \* \*$/.exec(normalizedExpr);
  if (minuteInterval) {
    return intl.formatMessage(
      { id: "automations.schedule.customMinutes" },
      { interval: minuteInterval[1]! },
    );
  }

  if (/^\d+ \d+ \d+ \d+ \*$/.test(normalizedExpr)) {
    return intl.formatMessage({ id: "automations.frequency.custom" });
  }
  if (/^\d+ \d+ \d+ \*\/\d+ \*$/.test(normalizedExpr)) {
    return intl.formatMessage({ id: "automations.frequency.custom" });
  }

  const builder = parseCronToBuilder(normalizedExpr);
  if (builder.frequency === "custom" && buildCronExpr(builder) !== normalizedExpr) {
    return intl.formatMessage({ id: "automations.frequency.custom" });
  }
  return describeCronBuilder(builder, intl);
}

export function canVisualizeCronInAutomationEditor(expr: string): boolean {
  const normalizedExpr = expr.trim().replace(/\s+/g, " ");
  if (/^\d+ \d+ \d+ \d+ \*$/.test(normalizedExpr)) return false;
  if (/^\d+ \d+ \d+ \*\/\d+ \*$/.test(normalizedExpr)) return false;
  const builder = parseCronToBuilder(normalizedExpr);
  return buildCronExpr(builder) === normalizedExpr;
}

export function formatGmtOffset(offsetMinutes = -new Date().getTimezoneOffset()): string {
  if (offsetMinutes === 0) return "GMT";
  const sign = offsetMinutes > 0 ? "+" : "-";
  const absoluteMinutes = Math.abs(offsetMinutes);
  const hours = Math.floor(absoluteMinutes / 60);
  const minutes = absoluteMinutes % 60;
  return `GMT${sign}${hours}${minutes > 0 ? `:${pad2(minutes)}` : ""}`;
}

export function formatDateTime(ts: number | undefined): string {
  if (!ts) return "-";
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function formatRelativeToNow(ts: number | undefined, now: number, intl: IntlLike): string {
  if (!ts) return "-";
  const diff = ts - now;
  const abs = Math.abs(diff);
  const future = diff >= 0;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  let value: number;
  let unitId: string;
  if (abs < minute) {
    return intl.formatMessage({
      id: future ? "automations.time.soon" : "automations.time.justNow",
    });
  }
  if (abs < hour) {
    value = Math.round(abs / minute);
    unitId = "automations.time.minutes";
  } else if (abs < day) {
    value = Math.round(abs / hour);
    unitId = "automations.time.hours";
  } else {
    value = Math.round(abs / day);
    unitId = "automations.time.days";
  }
  const amount = intl.formatMessage({ id: unitId }, { value: String(value) });
  return intl.formatMessage(
    { id: future ? "automations.time.in" : "automations.time.ago" },
    { amount },
  );
}

export function formatAutomationCardNextRun(
  ts: number | undefined,
  now: number,
  intl: IntlLike,
): string | null {
  if (!ts || ts <= now) return null;
  return ts - now <= AUTOMATION_CARD_RELATIVE_NEXT_RUN_THRESHOLD_MS
    ? formatRelativeToNow(ts, now, intl)
    : formatDateTime(ts);
}

export function formatDuration(startTs: number | undefined, endTs: number | undefined): string {
  if (!startTs || !endTs || endTs < startTs) return "-";
  const totalSec = Math.round((endTs - startTs) / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min <= 0) return `${sec}s`;
  return `${min}m ${sec}s`;
}
