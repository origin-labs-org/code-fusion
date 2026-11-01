
import type { CfOffPeakTask } from "@origin-ai/cf-shared";
import {
  hasAutomationFailureState,
  resolveAutomationStatusKind,
} from "@/settings/automationFormat.js";

export type AutomationStatusFilter = "all" | "inProgress" | "completed" | "failed";
export type AutomationStatusFilterKind = Exclude<AutomationStatusFilter, "all">;

export const DEFAULT_AUTOMATION_STATUS_FILTER: AutomationStatusFilter = "all";

export const AUTOMATION_STATUS_FILTERS: readonly AutomationStatusFilter[] = [
  "all",
  "inProgress",
  "completed",
  "failed",
];

export function resolveOffPeakStatusFilterKind(
  task: Pick<CfOffPeakTask, "status">,
): AutomationStatusFilterKind {
  switch (task.status) {
    case "completed":
      return "completed";
    case "failed":
    case "cancelled":
      return "failed";
    default:
      return "inProgress";
  }
}

type AutomationFilterLike = Parameters<typeof resolveAutomationStatusKind>[0] &
  Parameters<typeof hasAutomationFailureState>[0];

export function resolveAutomationStatusFilterKind(
  automation: AutomationFilterLike,
): AutomationStatusFilterKind {
  if (hasAutomationFailureState(automation)) return "failed";
  return resolveAutomationStatusKind(automation) === "completed" ? "completed" : "inProgress";
}

export function filterOffPeakTasksByStatus<T extends Pick<CfOffPeakTask, "status">>(
  tasks: readonly T[],
  filter: AutomationStatusFilter,
): readonly T[] {
  if (filter === "all") return tasks;
  return tasks.filter((task) => resolveOffPeakStatusFilterKind(task) === filter);
}

export function filterAutomationsByStatus<T extends AutomationFilterLike>(
  automations: readonly T[],
  filter: AutomationStatusFilter,
): readonly T[] {
  if (filter === "all") return automations;
  return automations.filter(
    (automation) => resolveAutomationStatusFilterKind(automation) === filter,
  );
}

export interface AutomationTabState<Tab extends string> {
  tab: Tab;
  filter: AutomationStatusFilter;
}

export function resolveAutomationTabState<Tab extends string>(
  previous: AutomationTabState<Tab>,
  nextTab: Tab,
): AutomationTabState<Tab> {
  if (nextTab === previous.tab) return previous;
  return { tab: nextTab, filter: DEFAULT_AUTOMATION_STATUS_FILTER };
}
