import { isHighspeedProviderId } from "@origin-ai/cf-shared";
import { modelSelectionSchema, type ModelSelection } from "@origin-ai/cf-shared/model-selection";
import { submissionModeSchema, type SubmissionMode } from "@origin-ai/cf-shared/cf-protocol-v4";
import type { ModelSelectionView } from "@origin-ai/cf-services";
import { logger } from "@/logger.js";
import { composerScopeKey, type ComposerScope } from "@/v4/composer/composerDraftStore.js";

const COMPOSER_RECENT_KEY_PREFIX = "cf-model-selection-recent-v1";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface ComposerRecent {
  readonly modelSelection?: ModelSelection;
  readonly mode?: SubmissionMode;
}

export interface ComposerRecentReceipt {
  scope: ComposerScope;
  selection: { modelSelection: ModelSelection; mode: SubmissionMode };
  order: number;
}
let lastReceiptOrder = 0;
export function prepareComposerRecentReceipt(
  scope: ComposerScope,
  selection: ComposerRecentReceipt["selection"],
): ComposerRecentReceipt {
  lastReceiptOrder = Math.max(Date.now() * 1000, lastReceiptOrder + 1);
  return {
    scope: { ...scope },
    selection: JSON.parse(JSON.stringify(selection)),
    order: lastReceiptOrder,
  };
}
export function acceptComposerRecentReceipt(
  receipt: ComposerRecentReceipt,
  storage: StorageLike | null = browserStorage(),
): boolean {
  if (!storage) return false;
  const selection = modelSelectionSchema.safeParse(receipt.selection.modelSelection);
  const mode = submissionModeSchema.safeParse(receipt.selection.mode);
  if (!selection.success || !mode.success || isHighspeedProviderId(selection.data.providerId))
    return true;
  const key = resolveComposerRecentKey("", undefined, receipt.scope);
  try {
    let previous: { order?: number } | null = null;
    try {
      previous = JSON.parse(storage.getItem(key) ?? "null");
    } catch {
      
    }
    if (typeof previous?.order === "number" && previous.order >= receipt.order) return true;
    storage.setItem(
      key,
      JSON.stringify({ modelSelection: selection.data, mode: mode.data, order: receipt.order }),
    );
    return true;
  } catch (error) {
    logger.warn("[ComposerRecent] Failed to accept config handoff, keeping command recovery clue", error);
    return false;
  }
}

let submissionSequence = 0;
const acceptedSequences = new WeakMap<StorageLike, Map<string, number>>();

function resolveComposerRecentKey(
  workspacePath: string,
  workspaceIdentity?: string,
  scope?: ComposerScope,
): string {
  if (scope) return `cf-composer-recent:v2:${composerScopeKey(scope)}`;
  const workspaceKey = workspaceIdentity?.trim() || workspacePath;
  return `${COMPOSER_RECENT_KEY_PREFIX}:${workspaceKey}`;
}

export function readComposerRecent(
  workspacePath: string,
  workspaceIdentity?: string,
  storage: StorageLike | null = browserStorage(),
  scope?: ComposerScope,
): ComposerRecent | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(resolveComposerRecentKey(workspacePath, workspaceIdentity, scope));
    if (!raw) return null;
    const record: unknown = JSON.parse(raw);
    if (!record || typeof record !== "object" || Array.isArray(record)) return null;
    const selection = modelSelectionSchema.safeParse(
      "modelSelection" in record ? record.modelSelection : record,
    );
    const mode = submissionModeSchema.safeParse("mode" in record ? record.mode : undefined);
    const healedSelection =
      selection.success && !isHighspeedProviderId(selection.data.providerId)
        ? selection.data
        : undefined;
    if (!healedSelection && !mode.success) return null;
    return {
      ...(healedSelection ? { modelSelection: healedSelection } : {}),
      ...(mode.success ? { mode: mode.data } : {}),
    };
  } catch {
    return null;
  }
}

export function captureComposerRecentSubmission(
  workspacePath: string,
  submission: { readonly modelSelection: ModelSelection; readonly mode: SubmissionMode },
  workspaceIdentity?: string,
  storage: StorageLike | null = browserStorage(),
  scope?: ComposerScope,
): () => void {
  if (!storage) return () => {};
  const key = resolveComposerRecentKey(workspacePath, workspaceIdentity, scope);
  const mode = submissionModeSchema.safeParse(submission.mode);
  const modelSelection = normalizeSparseModelSelection(submission.modelSelection);
  if (modelSelection && isHighspeedProviderId(modelSelection.providerId)) {
    logger.warn("[ComposerRecent] Submission targets accelerator card Provider, skipping preference recording", {
      workspacePath,
      workspaceIdentity,
    });
    return () => {};
  }
  if (!mode.success || !modelSelection) {
    logger.warn("[ComposerRecent] Invalid format for recent submission config, skipping preference recording", {
      workspacePath,
      workspaceIdentity,
    });
    return () => {};
  }
  const sequence = ++submissionSequence;
  const recent = {
    modelSelection,
    mode: mode.data,
  };
  let accepted = acceptedSequences.get(storage);
  if (!accepted) {
    accepted = new Map();
    acceptedSequences.set(storage, accepted);
  }
  return () => {
    if (sequence <= (accepted.get(key) ?? 0)) return;
    accepted.set(key, sequence);
    try {
      storage.setItem(key, JSON.stringify(recent));
    } catch (error) {
      logger.warn("[ComposerRecent] 保存最近提交配置失败", {
        workspacePath,
        workspaceIdentity,
        error,
      });
    }
  };
}

export function resolveDraftInitialModelSelection(
  view: ModelSelectionView | null,
  recent: ModelSelection | null,
): { readonly selection: ModelSelection | null; readonly invalidated: boolean } {
  if (!view) return { selection: recent, invalidated: false };
  if (recent) {
    const model = findModel(view, recent);
    if (!model) return { selection: null, invalidated: true };
    const reasoning = recent.options?.reasoningLevel;
    if (
      reasoning === undefined ||
      !model.config.optionSpecs.reasoningLevel.values.includes(reasoning)
    ) {
      return {
        selection: { providerId: recent.providerId, modelId: recent.modelId },
        invalidated: true,
      };
    }
    return { selection: recent, invalidated: false };
  }
  return {
    selection:
      view.preferredSelection && isSelectionInView(view, view.preferredSelection)
        ? view.preferredSelection
        : null,
    invalidated: recent !== null,
  };
}

export function isSelectionInView(view: ModelSelectionView, selection: ModelSelection): boolean {
  const model = findModel(view, selection);
  if (!model) return false;
  const reasoning = selection.options?.reasoningLevel;
  const reasoningSpec = model.config.optionSpecs.reasoningLevel;
  return reasoning !== undefined && reasoningSpec.values.includes(reasoning);
}

function findModel(view: ModelSelectionView, selection: ModelSelection) {
  return view.providers
    .find((provider) => provider.providerId === selection.providerId)
    ?.models.find((candidate) => candidate.modelId === selection.modelId);
}

function normalizeSparseModelSelection(selection: ModelSelection): ModelSelection | null {
  const candidate =
    selection && typeof selection === "object" && !Array.isArray(selection) ? selection : null;
  const options = candidate?.options;
  const normalizedOptions =
    options?.reasoningLevel !== undefined ? { reasoningLevel: options.reasoningLevel } : {};
  const parsed = modelSelectionSchema.safeParse({
    providerId: candidate?.providerId,
    modelId: candidate?.modelId,
    ...(Object.keys(normalizedOptions).length > 0 ? { options: normalizedOptions } : {}),
  });
  return parsed.success ? parsed.data : null;
}

function browserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
