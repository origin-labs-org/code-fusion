import type { CfConfigOption } from "@origin-ai/cf-shared";
import type { ModelSelectionView } from "@origin-ai/cf-services";
import type { SessionConfigState } from "@origin-ai/cf-shared/cf-protocol-v4";
import { resolveModelThoughtOption } from "@/lib/modelThoughtOption.js";

export function resolveDraftDisplayedConfig(
  composer: Partial<SessionConfigState>,
): SessionConfigState | null {
  const selection = composer.modelSelection;
  if (!selection) return null;
  return {
    modelSelection: selection,
    provider: selection.providerId,
    model: selection.modelId,
    thought: selection.options?.reasoningLevel ?? "",
    thoughtLevels: [],
    followupMode: composer.followupMode ?? "queue",
    mode: composer.mode ?? "build",
  };
}

export function resolveDraftModelThoughtOption(
  providerId: string,
  modelId: string,
  modelSelectionView: ModelSelectionView | null,
): CfConfigOption | null {
  if (!modelSelectionView) return null;
  return resolveModelThoughtOption({
    modelSelectionView,
    providerId,
    modelId,
  });
}

export function resolveDraftThoughtCurrentValue(params: {
  thought: string | null | undefined;
  thoughtLevels: readonly string[];
}): string {
  const explicitThought = params.thought?.trim() ?? "";
  if (explicitThought && params.thoughtLevels.includes(explicitThought)) {
    return explicitThought;
  }

  return "";
}
