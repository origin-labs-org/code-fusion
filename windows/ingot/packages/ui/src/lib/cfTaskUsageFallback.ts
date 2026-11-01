import type { CfUsage } from "@origin-ai/cf-shared";
import type { TaskUsageState } from "@/store/cfSessionStoreTypes.js";

interface TaskUsageKeyParams {
  workspacePath: string;
  workspaceIdentity?: string;
  taskId: string;
}

interface TaskContextUsageUpdateParams extends TaskUsageKeyParams {
  used: number;
  size: number;
}

interface BuildTaskContextUsageUpdateParams {
  currentUsage: TaskUsageState | null | undefined;
  incomingUsage: TaskUsageState;
  latestUserPrompt?: string | null;
}

const taskContextUsageUpdateKeys = new Set<string>();

function buildTaskUsageKey(params: TaskUsageKeyParams): string {
  const workspaceKey = params.workspaceIdentity?.trim() || params.workspacePath;
  return `${params.workspacePath}::${workspaceKey}::${params.taskId}`;
}

export function recordTaskContextUsageUpdate(params: TaskContextUsageUpdateParams) {
  if (!Number.isFinite(params.used) || params.used <= 0) {
    return;
  }
  if (!Number.isFinite(params.size) || params.size <= 0) {
    return;
  }
  taskContextUsageUpdateKeys.add(buildTaskUsageKey(params));
}

function isContextCompressionPrompt(prompt: string | null | undefined): boolean {
  const normalized = prompt?.trim() ?? "";
  return (
    normalized === "/compact" ||
    normalized.startsWith("/compact ") ||
    normalized === "/compress" ||
    normalized.startsWith("/compress ")
  );
}

export function buildTaskContextUsageFromUsageUpdate(
  params: BuildTaskContextUsageUpdateParams,
): TaskUsageState {
  const { currentUsage, incomingUsage, latestUserPrompt } = params;
  const usageWithRetainedBreakdown =
    !incomingUsage.breakdown &&
    currentUsage?.breakdown &&
    currentUsage.used === incomingUsage.used &&
    currentUsage.size === incomingUsage.size
      ? { ...incomingUsage, breakdown: currentUsage.breakdown }
      : incomingUsage;
  if (
    currentUsage &&
    Number.isFinite(currentUsage.used) &&
    currentUsage.used > 0 &&
    Number.isFinite(currentUsage.size) &&
    currentUsage.size > 0 &&
    (!Number.isFinite(incomingUsage.used) || incomingUsage.used <= 0) &&
    !isContextCompressionPrompt(latestUserPrompt)
  ) {
    return currentUsage;
  }

  return usageWithRetainedBreakdown;
}

export function buildPromptCompletionUsageFallback(
  params: TaskUsageKeyParams & {
    currentUsage: TaskUsageState | null | undefined;
    currentContextWindow?: number | null;
    usage?: CfUsage;
  },
): TaskUsageState | null {
  const { currentUsage, currentContextWindow, usage } = params;
  const contextWindow = currentContextWindow ?? currentUsage?.size ?? null;
  if (!contextWindow || contextWindow <= 0) {
    return null;
  }
  if (!usage || !Number.isFinite(usage.totalTokens) || usage.totalTokens <= 0) {
    return null;
  }
  if (taskContextUsageUpdateKeys.has(buildTaskUsageKey(params))) {
    return null;
  }

  return {
    ...currentUsage,
    size: contextWindow,
    used: Math.min(contextWindow, Math.max(currentUsage?.used ?? 0, usage.totalTokens)),
  };
}

export function resetTaskContextUsageUpdateRecordsForTest() {
  taskContextUsageUpdateKeys.clear();
}
