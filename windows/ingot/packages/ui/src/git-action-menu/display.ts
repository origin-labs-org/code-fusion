import type { GitRepositorySummary } from "@origin-ai/cf-shared";

type GitActionMenuPrimaryActionId = "commit" | "push";

export function canRenderGitActionMenu(options: {
  actionAvailable: boolean;
  commitEnabled: boolean;
  pushEnabled: boolean;
}): boolean {
  return options.actionAvailable && (options.commitEnabled || options.pushEnabled);
}

export function canUseGitActionMenu(
  summary: Pick<GitRepositorySummary, "isGitAvailable" | "isRepository">,
): boolean {
  return summary.isGitAvailable && summary.isRepository;
}

export function resolveGitActionMenuPrimaryAction(options: {
  actionAvailable: boolean;
  commitEnabled: boolean;
  pushEnabled: boolean;
}): GitActionMenuPrimaryActionId | null {
  if (options.actionAvailable && options.commitEnabled) {
    return "commit";
  }

  if (options.actionAvailable && options.pushEnabled) {
    return "push";
  }

  return null;
}

export function canPushGitBranch(
  summary: Pick<
    GitRepositorySummary,
    "headRefType" | "branchName" | "trackingBranchName" | "ahead"
  >,
): boolean {
  const branchName = summary.branchName?.trim() ?? "";
  if (summary.headRefType !== "branch" || branchName.length === 0) {
    return false;
  }

  return !summary.trackingBranchName || summary.ahead > 0;
}
