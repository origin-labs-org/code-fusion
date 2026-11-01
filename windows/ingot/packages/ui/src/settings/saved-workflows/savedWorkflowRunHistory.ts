import type { CfSavedWorkflowRun, CfSavedWorkflowRunStatus } from "@origin-ai/cf-shared";

export function lastRunByWorkflowName(
  runs: readonly CfSavedWorkflowRun[],
): Map<string, CfSavedWorkflowRun> {
  const byName = new Map<string, CfSavedWorkflowRun>();
  const sorted = [...runs].sort((left, right) => right.updatedAt - left.updatedAt);
  for (const run of sorted) {
    if (run.name === undefined || byName.has(run.name)) continue;
    byName.set(run.name, run);
  }
  return byName;
}

type SavedWorkflowRunBadgeKind = "completed" | "errored" | "running" | "stopped" | "never";

export function savedWorkflowRunBadgeKind(
  status: CfSavedWorkflowRunStatus | "errored" | "stopped" | "failed" | "cancelled" | undefined,
): SavedWorkflowRunBadgeKind {
  switch (status) {
    case undefined:
      return "never";
    case "pending":
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "errored":
    case "failed":
      return "errored";
    case "stopped":
    case "cancelled":
      return "stopped";
  }
}

export function formatSavedWorkflowRunArgs(args: Record<string, unknown> | undefined): string[] {
  if (!args) return [];
  return Object.entries(args).map(
    ([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`,
  );
}

export function savedWorkflowRunDurationMs(run: CfSavedWorkflowRun, now: number): number {
  const end = run.status === "pending" || run.status === "running" ? now : run.updatedAt;
  return Math.max(0, end - run.createdAt);
}

export function formatSavedWorkflowTokens(spent: number): string {
  if (!Number.isFinite(spent)) return "—";
  if (spent >= 1_000_000) return `${(spent / 1_000_000).toFixed(1)}M`;
  if (spent >= 1_000) return `${(spent / 1_000).toFixed(1)}k`;
  return String(Math.round(spent));
}
