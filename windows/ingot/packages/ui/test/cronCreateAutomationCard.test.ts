import { describe, expect, it } from "vitest";
import { readCronCreateAutomationOutputSummary } from "@/ToolCallBlocks/renderers/cron-create.js";
import { describeAutomationCardSchedule } from "@/settings/automationCardSchedule.js";

describe("CronCreateAutomationCard output", () => {
  it("Preserve scheduleRule so long hour intervals are not displayed as hourly via compatibility cron", () => {
    const automation = readCronCreateAutomationOutputSummary(
      JSON.stringify({
        automation: {
          automation_id: "automation-31-hours",
          title: "Run every 31 hours",
          cron_expr: "49 * * * *",
          scheduleRule: {
            unit: "hourly",
            interval: 31,
            hour: 0,
            minute: 49,
            anchorAt: new Date(2026, 7, 5, 17, 49).getTime(),
          },
        },
      }),
    );

    expect(automation).toMatchObject({
      automationId: "automation-31-hours",
      title: "Run every 31 hours",
      cronExpr: "49 * * * *",
      scheduleRule: {
        unit: "hourly",
        interval: 31,
        minute: 49,
      },
    });

    const schedule = describeAutomationCardSchedule(
      {
        cronExpr: automation?.cronExpr ?? "",
        scheduleRule: automation?.scheduleRule,
      },
      {
        formatMessage: ({ id }, values) =>
          id === "automations.schedule.customHourly"
            ? `每 ${values?.["interval"]} 小时的第 ${values?.["time"]} 分`
            : id,
      },
    );

    expect(schedule).toBe("At minute 49 past every 31 hours");
  });
});
