import type {
  CfConfigOption,
  CfMessageWithParts,
  ModelSelection,
  CfSessionMode,
  CfSessionSettingsState,
  CfSessionStateSnapshot,
  CfTaskModeInfo,
} from "@origin-ai/cf-shared";
import {
  formatModelPickerValue as formatSharedModelSelection,
  getCfAgentAvailableModes as getSharedCfAgentAvailableModes,
  normalizeAvailableCfMode as normalizeSharedAvailableCfMode,
  cfSessionSettingsToCfConfigOptions,
} from "@origin-ai/cf-shared";

export const MODEL_CONFIG_ID = "model";
export const MODE_CONFIG_ID = "mode";
export const THOUGHT_LEVEL_CONFIG_ID = "thought_level";

export function formatModelPickerValue(ref: ModelSelection | undefined): string {
  return formatSharedModelSelection(ref);
}

function resolveLatestMessageModelSelection(
  messages: readonly CfMessageWithParts[],
): ModelSelection | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const model = messages[index]?.info.model;
    if (model) {
      return model;
    }
  }
  return undefined;
}

function resolveTaskMetaModelSelectionFromSnapshot(
  snapshot: Pick<CfSessionStateSnapshot, "messages" | "settings">,
): ModelSelection | undefined {
  return resolveLatestMessageModelSelection(snapshot.messages) ?? snapshot.settings.model.current;
}

export function formatTaskMetaModelSelectionFromSnapshot(
  snapshot: Pick<CfSessionStateSnapshot, "messages" | "settings">,
): string {
  return formatModelPickerValue(resolveTaskMetaModelSelectionFromSnapshot(snapshot));
}

export function normalizeAvailableCfMode(mode: CfSessionMode): string {
  return normalizeSharedAvailableCfMode(mode);
}

export function getCfAgentAvailableModes(): CfTaskModeInfo[] {
  return getSharedCfAgentAvailableModes();
}

export function settingsToConfigOptions(settings: CfSessionSettingsState): CfConfigOption[] {
  return cfSessionSettingsToCfConfigOptions(settings);
}
