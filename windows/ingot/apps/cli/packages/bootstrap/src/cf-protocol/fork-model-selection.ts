import type { ModelSelection } from "@origin-ai/cf-contracts";
import { isHighspeedProviderId } from "@origin-ai/cf-shared";

export function cloneModelSelection(
  selection: ModelSelection | undefined,
): ModelSelection | undefined {
  if (!selection) return undefined;
  return {
    providerId: selection.providerId,
    modelId: selection.modelId,
    ...(selection.options ? { options: { ...selection.options } } : {}),
  };
}

export function modelSelectionWithOptionFallback(
  selection: ModelSelection | undefined,
  fallback: ModelSelection | undefined,
): ModelSelection | undefined {
  if (!selection) return fallback && cloneModelSelection(fallback);
  const reasoningLevel = selection.options?.reasoningLevel ?? fallback?.options?.reasoningLevel;
  return {
    providerId: selection.providerId,
    modelId: selection.modelId,
    ...(reasoningLevel !== undefined ? { options: { reasoningLevel } } : {}),
  };
}

export function derivedSessionModelSelection(
  messageSelection: ModelSelection | undefined,
  sessionSelection: ModelSelection | undefined,
): ModelSelection | undefined {
  const inheritable =
    messageSelection && isHighspeedProviderId(messageSelection.providerId)
      ? undefined
      : messageSelection;
  return modelSelectionWithOptionFallback(inheritable, sessionSelection);
}
