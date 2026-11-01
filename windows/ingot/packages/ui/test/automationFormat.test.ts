import { describe, expect, it } from "vitest";
import {
  canVisualizeCronInAutomationEditor,
  buildAutomationEditCronExpr,
  buildCronExpr,
  describeCron,
  describeCronBuilder,
  formatAutomationCardNextRun,
  formatGmtOffset,
  hasAutomationFailureState,
  hasAutomationRetryQueueState,
  parseCronToBuilder,
  resolveAutomationStatusKind,
} from "../src/settings/automationFormat.js";
import { describeAutomationCardSchedule } from "../src/settings/automationCardSchedule.js";

describe("automationFormat", () => {
  const scheduleIntl = {
    formatMessage: ({ id }: { id: string }, values?: Record<string, string>) =>
      id === "automations.schedule.customMinutes"
        ? `Every ${values?.["interval"]} minutes`
        : id,
  };

  it("Minute step cron displays real frequency instead of default time", () => {
    expect(describeCron("*/20 * * * *", scheduleIntl)).toBe("Every 20 minutes");
    const builder = parseCronToBuilder("*/20 * * * *");
    expect(builder).toMatchObject({
      frequency: "custom",
      customInterval: 20,
      customUnit: "minute",
    });
    expect(buildCronExpr(builder)).toBe("*/20 * * * *");
    expect(describeCronBuilder(builder, scheduleIntl)).toBe("Every 20 minutes");
  });

  it("Unknown cron displays as custom instead of raw expression", () => {
    expect(
      describeCron("1,15 2-8 * * *", {
        formatMessage: ({ id }) =>
          id === "automations.frequency.custom" ? "Custom" : id,
      }),
    ).toBe("Custom");
  });

  it("Editor only handles cron that can be restored losslessly", () => {
    expect(canVisualizeCronInAutomationEditor("0 9 * * *")).toBe(true);
    expect(canVisualizeCronInAutomationEditor("20 18 13 */1 *")).toBe(false);
    expect(canVisualizeCronInAutomationEditor("0 8 27 7 *")).toBe(false);
  });

  it("Hourly cron from old tasks can stably populate edit state", () => {
    expect(parseCronToBuilder("40 * * * *")).toMatchObject({
      frequency: "hourly",
      minute: 40,
    });
  });

  it("Preserve cron as-is when editing tasks created within session", () => {
    const builder = parseCronToBuilder("*/10 * * * *");

    expect(
      buildAutomationEditCronExpr(builder, {
        cronExpr: "*/10 * * * *",
        targetTaskId: "sess-from-chat",
      }),
    ).toBe("*/10 * * * *");
  });

  it("工作日频率与 1-5 cron 可以双向转换", () => {
    const cronExpr = buildCronExpr({
      frequency: "weekdays",
      hour: 9,
      minute: 30,
      weekdays: [1, 2, 3, 4, 5],
      dayOfMonth: 1,
      rawExpr: "",
      customInterval: 1,
      customUnit: "daily",
      customWeekdays: [1],
      customMonthDays: [1],
      customMonth: 1,
      customMonthlyMode: "date",
    });

    expect(cronExpr).toBe("30 9 * * 1-5");
    expect(parseCronToBuilder(cronExpr)).toMatchObject({
      frequency: "weekdays",
      hour: 9,
      minute: 30,
    });
  });

  it("自定义小时和天间隔可以双向转换", () => {
    const base = {
      frequency: "custom" as const,
      hour: 9,
      minute: 30,
      weekdays: [1],
      dayOfMonth: 1,
      rawExpr: "",
      customWeekdays: [1],
      customMonthDays: [1],
      customMonth: 1,
      customMonthlyMode: "date" as const,
    };
    expect(buildCronExpr({ ...base, customInterval: 3, customUnit: "hourly" })).toBe(
      "30 */3 * * *",
    );
    expect(parseCronToBuilder("30 */3 * * *")).toMatchObject({
      frequency: "custom",
      customInterval: 3,
      customUnit: "hourly",
    });
    expect(buildCronExpr({ ...base, customInterval: 2, customUnit: "daily" })).toBe("30 9 */2 * *");
  });

  it("Every 31 hours uses valid hourly candidate cron, leaving true interval to scheduleRule", () => {
    expect(
      buildCronExpr({
        frequency: "custom",
        hour: 9,
        minute: 49,
        weekdays: [1],
        dayOfMonth: 1,
        rawExpr: "",
        customInterval: 31,
        customUnit: "hourly",
        customWeekdays: [1],
        customMonthDays: [1],
        customMonth: 1,
        customMonthlyMode: "date",
      }),
    ).toBe("49 * * * *");
  });

  it("Every 61/200 minutes and 32/200 days use valid compatible cron, leaving true interval to scheduleRule", () => {
    const base = {
      frequency: "custom" as const,
      hour: 9,
      minute: 30,
      weekdays: [1],
      dayOfMonth: 1,
      rawExpr: "",
      customWeekdays: [1],
      customMonthDays: [1],
      customMonth: 1,
      customMonthlyMode: "date" as const,
    };

    for (const interval of [61, 200]) {
      expect(buildCronExpr({ ...base, customInterval: interval, customUnit: "minute" })).toBe(
        "* * * * *",
      );
    }
    for (const interval of [32, 200]) {
      expect(buildCronExpr({ ...base, customInterval: interval, customUnit: "daily" })).toBe(
        "30 9 * * *",
      );
    }
  });

  it("Hourly recurrence shows only minute offset without meaningless default 09:00", () => {
    const intl = {
      formatMessage: ({ id }: { id: string }, values?: Record<string, string>) =>
        id === "automations.schedule.customHourly"
          ? `每 ${values?.["interval"]} 小时的第 ${values?.["time"]} 分`
          : id,
    };

    const builder = parseCronToBuilder("0 */2 * * *");
    expect(describeCronBuilder(builder, intl)).toBe("每 2 小时的第 00 分");
    expect(describeCron("0 */2 * * *", intl)).toBe("每 2 小时的第 00 分");
    expect(describeCronBuilder(builder, intl)).not.toContain("09:00");
  });

  it("GMT offset supports full hours, half hours, and UTC", () => {
    expect(formatGmtOffset(480)).toBe("GMT+8");
    expect(formatGmtOffset(330)).toBe("GMT+5:30");
    expect(formatGmtOffset(-210)).toBe("GMT-3:30");
    expect(formatGmtOffset(0)).toBe("GMT");
  });

  it("Monthly custom summary retains user-selected dates", () => {
    const text = describeCronBuilder(
      {
        frequency: "custom",
        hour: 10,
        minute: 52,
        weekdays: [1],
        dayOfMonth: 1,
        rawExpr: "",
        customInterval: 1,
        customUnit: "monthly",
        customWeekdays: [1],
        customMonthDays: [12, 20],
        customMonth: 1,
        customMonthlyMode: "date",
      },
      {
        formatMessage: ({ id }, values) =>
          id === "automations.schedule.customMonthlyDates"
            ? `每 ${values?.["interval"]} 个月的 ${values?.["days"]} 日，${values?.["time"]}`
            : id,
      },
    );

    expect(text).toBe("Every 1 month on day 12, 20 at 10:52");
  });

  it("Every 29 months uses valid monthly candidate cron, leaving true interval to scheduleRule", () => {
    const base = {
      frequency: "custom" as const,
      hour: 9,
      minute: 0,
      weekdays: [1],
      dayOfMonth: 1,
      rawExpr: "",
      customInterval: 29,
      customUnit: "monthly" as const,
      customWeekdays: [1],
      customMonthDays: [1, 15, 16],
      customMonth: 1,
    };

    expect(buildCronExpr({ ...base, customMonthlyMode: "date" as const })).toBe(
      "0 9 1,15,16 * *",
    );
    expect(buildCronExpr({ ...base, customMonthlyMode: "weekday" as const })).toBe(
      "0 9 * * 1#1",
    );
  });

  it("Card prioritizes scheduleRule to display every 30 months without being downgraded to monthly by compatible cron", () => {
    const text = describeAutomationCardSchedule(
      {
        cronExpr: "0 9 1 * *",
        scheduleRule: {
          unit: "monthly",
          interval: 30,
          hour: 9,
          minute: 0,
          anchorAt: new Date(2026, 6, 27, 9).getTime(),
          monthDays: [1],
          monthlyMode: "date",
        },
      },
      {
        formatMessage: ({ id }, values) =>
          id === "automations.schedule.customMonthlyDates"
            ? `每 ${values?.["interval"]} 个月的 ${values?.["days"]} 日，${values?.["time"]}`
            : id,
      },
    );

    expect(text).toBe("每 30 个月的 1 日，09:00");
  });

  it("Yearly custom is assembled as `M H DOM MON *` and bidirectionally convertible", () => {
    const cronExpr = buildCronExpr({
      frequency: "custom",
      hour: 9,
      minute: 30,
      weekdays: [1],
      dayOfMonth: 1,
      rawExpr: "",
      customInterval: 1,
      customUnit: "yearly",
      customWeekdays: [1],
      customMonthDays: [12],
      customMonth: 7,
      customMonthlyMode: "date",
    });

    expect(cronExpr).toBe("30 9 12 7 *");
    expect(parseCronToBuilder(cronExpr)).toMatchObject({
      frequency: "custom",
      hour: 9,
      minute: 30,
      customUnit: "yearly",
      customMonth: 7,
      customMonthDays: [12],
    });
  });

  it("每年自定义摘要包含用户选择的月份和日期", () => {
    const text = describeCronBuilder(
      {
        frequency: "custom",
        hour: 9,
        minute: 0,
        weekdays: [1],
        dayOfMonth: 1,
        rawExpr: "",
        customInterval: 1,
        customUnit: "yearly",
        customWeekdays: [1],
        customMonthDays: [12],
        customMonth: 7,
        customMonthlyMode: "date",
      },
      {
        formatMessage: ({ id }, values) =>
          id === "automations.schedule.customYearly"
            ? `每 ${values?.["interval"]} 年的 ${values?.["month"]} 月 ${values?.["day"]} 日，${values?.["time"]}`
            : id,
      },
    );

    expect(text).toBe("每 1 年的 7 月 12 日，09:00");
  });

  it("Fixed dates and cron that cannot be stably visualized are uniformly displayed as custom", () => {
    const intl = {
      formatMessage: ({ id }: { id: string }) =>
        id === "automations.frequency.custom" ? "自定义" : id,
    };

    expect(
      describeAutomationCardSchedule(
        { cronExpr: "0 8 27 7 *" },
        intl,
      ),
    ).toBe("自定义");

    expect(
      describeAutomationCardSchedule({ cronExpr: "20 18 13 */1 *" }, intl),
    ).toBe("自定义");

    expect(
      describeAutomationCardSchedule({ cronExpr: "1,15 2-8 * * *" }, intl),
    ).toBe("自定义");
  });

  it("Relative one-time tasks display as custom instead of \"Every N minutes\" recurrence", () => {
    const intl = {
      formatMessage: ({ id }: { id: string }, values?: Record<string, unknown>) =>
        id === "automations.frequency.custom"
          ? "自定义" : id === "automations.schedule.customMinutes"
            ? `每 ${values?.["interval"]} 分钟`
            : id,
    };

    expect(
      describeAutomationCardSchedule(
        {
          cronExpr: "47 14 28 7 *",
          scheduleRule: {
            unit: "minute",
            interval: 4,
            hour: 14,
            minute: 47,
            anchorAt: new Date(2026, 6, 28, 14, 43).getTime(),
          },
          recurring: false,
          maxRuns: 1,
        },
        intl,
      ),
    ).toBe("Custom");

    expect(
      describeAutomationCardSchedule(
        {
          cronExpr: "*/4 * * * *",
          scheduleRule: {
            unit: "minute",
            interval: 4,
            hour: 14,
            minute: 47,
            anchorAt: new Date(2026, 6, 28, 14, 43).getTime(),
          },
          recurring: false,
          maxRuns: 3,
        },
        intl,
      ),
    ).toBe("Every 4 minutes");
  });

  it("Scheduled task status display prioritizes terminal state over enabled", () => {
    expect(
      resolveAutomationStatusKind({
        lifecycleStatus: "completed",
        enabled: false,
      }),
    ).toBe("completed");
    expect(
      resolveAutomationStatusKind({
        lifecycleStatus: "failed",
        enabled: false,
      }),
    ).toBe("failed");
    expect(
      resolveAutomationStatusKind({
        lifecycleStatus: "active",
        enabled: false,
      }),
    ).toBe("paused");
    expect(
      resolveAutomationStatusKind({
        lifecycleStatus: "active",
        enabled: true,
      }),
    ).toBe("active");
  });

  it("Actual run or dispatch error puts task card into failed state", () => {
    expect(
      hasAutomationFailureState({
        lifecycleStatus: "active",
        lastError: "Provider request failed",
      }),
    ).toBe(true);
    expect(
      hasAutomationFailureState({
        lifecycleStatus: "active",
        dispatchStatus: "failed_to_dispatch",
      }),
    ).toBe(true);
    expect(hasAutomationFailureState({ lifecycleStatus: "active" })).toBe(false);
  });

  it("Show queued badge only when actually entering backoff retry queue", () => {
    expect(
      hasAutomationRetryQueueState({
        lifecycleStatus: "active",
        dispatchStatus: "failed_to_dispatch",
        dispatchAttempts: 2,
        retryAt: Date.now() + 1_000,
      }),
    ).toBe(true);
    expect(
      hasAutomationRetryQueueState({
        lifecycleStatus: "failed",
        dispatchStatus: "failed_to_dispatch",
        dispatchAttempts: 3,
      }),
    ).toBe(false);
  });

  it("Card next run displays relative time within one month and absolute time beyond one month", () => {
    const now = new Date(2026, 6, 17, 8, 0, 0, 0).getTime();
    const timeIntl = {
      formatMessage: ({ id }: { id: string }, values?: Record<string, string>) => {
        if (id === "automations.time.days") return `${values?.["value"]}d`;
        if (id === "automations.time.in") return `in ${values?.["amount"]}`;
        return id;
      },
    };

    expect(formatAutomationCardNextRun(now + 29 * 24 * 60 * 60 * 1000, now, timeIntl)).toBe(
      "in 29d",
    );
    expect(formatAutomationCardNextRun(now + 31 * 24 * 60 * 60 * 1000, now, timeIntl)).toBe(
      "2026-08-17 08:00",
    );
    expect(formatAutomationCardNextRun(now, now, timeIntl)).toBeNull();
    expect(formatAutomationCardNextRun(now - 1, now, timeIntl)).toBeNull();
    expect(formatAutomationCardNextRun(undefined, now, timeIntl)).toBeNull();
  });
});
