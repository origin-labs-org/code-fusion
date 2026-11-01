import type { CfProvider } from "@origin-ai/cf-shared";

type DraftWorkspacePrepareReason = "mount" | "select-provider";
type WorkspacePrepareReason =
  | DraftWorkspacePrepareReason
  | "retry"
  | "first-send";

interface ResolveDraftWorkspacePrepareReasonOptions {
  previousDraftProvider: CfProvider | null;
  previousTaskProvider: CfProvider | null;
  selectedProvider: CfProvider;
  returningFromTask: boolean;
}

export function resolveDraftWorkspacePrepareReason({
  previousDraftProvider,
  previousTaskProvider,
  selectedProvider,
  returningFromTask,
}: ResolveDraftWorkspacePrepareReasonOptions): DraftWorkspacePrepareReason {
  if (previousDraftProvider === null) {
    return "mount";
  }

  if (returningFromTask) {
    const taskProviderBeforeDraft = previousTaskProvider ?? previousDraftProvider;
    return taskProviderBeforeDraft === selectedProvider ? "mount" : "select-provider";
  }

  return previousDraftProvider === selectedProvider ? "mount" : "select-provider";
}

interface ShouldShowDraftWorkspacePrepareLoadingOptions {
  taskId: string | null;
  reason: WorkspacePrepareReason;
  hasHydratedConfigOptions: boolean;
}

export function shouldShowDraftWorkspacePrepareLoading({
  taskId,
  reason,
  hasHydratedConfigOptions,
}: ShouldShowDraftWorkspacePrepareLoadingOptions): boolean {
  if (taskId) {
    return false;
  }

  if (reason === "select-provider") {
    return true;
  }

  return reason === "mount" && !hasHydratedConfigOptions;
}
