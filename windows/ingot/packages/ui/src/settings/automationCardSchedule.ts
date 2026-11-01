import type { CfAutomationScheduleRule } from "@origin-ai/cf-shared";
import {
  describeCron,
  describeCronBuilder,
  type CronBuilderState,
  type IntlLike,
} from "@/settings/automationFormat.js";

function scheduleRuleToBuilder(rule: CfAutomationScheduleRule): CronBuilderState {
  return {
    frequency: "custom",
    hour: rule.hour,
    minute: rule.minute,
    weekdays: rule.weekdays ?? [1],
    dayOfMonth: rule.monthDays?.[0] ?? 1,
    rawExpr: "",
    customInterval: rule.interval,
    customUnit: rule.unit,
    customWeekdays: rule.weekdays ?? [1],
    customMonthDays: rule.monthDays ?? [1],
    customMonth: rule.months?.[0] ?? new Date(rule.anchorAt).getMonth() + 1,
    customMonthlyMode: rule.monthlyMode ?? "date",
  };
}

export function describeAutomationCardSchedule(
  automation: {
    cronExpr: string;
    scheduleRule?: CfAutomationScheduleRule;
    recurring?: boolean;
    maxRuns?: number;
  },
  intl: IntlLike,
): string {
  if (automation.recurring === false && (automation.maxRuns ?? 1) <= 1) {
    return intl.formatMessage({ id: "automations.frequency.custom" });
  }
  if (automation.scheduleRule) {
    return describeCronBuilder(scheduleRuleToBuilder(automation.scheduleRule), intl);
  }
  return describeCron(automation.cronExpr, intl);
}
