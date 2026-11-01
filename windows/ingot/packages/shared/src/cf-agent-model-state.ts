// getCfAgentModeSelectOptions/getCfAgentAvailableModes/
// getCfAgentAvailableModes / getCfAgentModeSelectOptions / normalizeAvailableCfMode）。
import { formatModelPickerValue } from "./model-selection.js";
import type { CfSessionMode, CfSessionSettingsState } from "./cf-protocol/index.js";
import type { CfConfigOption, CfTaskModeInfo } from "./cf-task-types-core.js";
const MODEL_CONFIG_ID = "model";
const MODEL_CONFIG_CATEGORY = "model";
const MODE_CONFIG_ID = "mode";
const MODE_CONFIG_CATEGORY = "mode";
const THOUGHT_LEVEL_CONFIG_ID = "thought_level";
const THOUGHT_LEVEL_CONFIG_CATEGORY = "thought_level";
const CF_AGENT_MODE_OPTIONS = [
  {
    id: "build",
    name: "Ask before changes",
    description: "Ask before each file changes.",
  },
  {
    id: "guarded",
    name: "Autonomous mode",
    description: "Ask when there’s risk",
  },
  {
    id: "plan",
    name: "Plan mode",
    description: "Inspect the code and present a plan before editing.",
  },
  {
    id: "yolo",
    name: "Full access",
    description: "Edit and run commands with fewer confirmations.",
  },
] as const satisfies readonly CfTaskModeInfo[];
const CF_AGENT_MODE_ID_SET = new Set<string>([
  ...CF_AGENT_MODE_OPTIONS.map((mode) => mode.id),
  "edit",
]);

export function normalizeAvailableCfMode(mode: CfSessionMode): string {
  return CF_AGENT_MODE_ID_SET.has(mode) ? mode : "build";
}

export function getCfAgentModeSelectOptions(): NonNullable<CfConfigOption["options"]> {
  return CF_AGENT_MODE_OPTIONS.map((mode) => ({
    value: mode.id,
    name: mode.name,
    description: mode.description,
  }));
}

export function getCfAgentAvailableModes(): CfTaskModeInfo[] {
  return CF_AGENT_MODE_OPTIONS.map((mode) => ({ ...mode }));
}

export function cfSessionSettingsToCfConfigOptions(
  settings: CfSessionSettingsState,
): CfConfigOption[] {
  const configOptions: CfConfigOption[] = [
    {
      id: MODEL_CONFIG_ID,
      name: "Model",
      category: MODEL_CONFIG_CATEGORY,
      type: "select",
      currentValue: formatModelPickerValue(settings.model.current),
      options: settings.model.available.map((model) => {
        const modelThoughtLevels = model.reasoning?.levels.map((level) => level.value);
        const modelDefaultThoughtLevel =
          model.reasoning?.defaultLevel &&
          modelThoughtLevels?.includes(model.reasoning.defaultLevel)
            ? model.reasoning.defaultLevel
            : undefined;
        return {
          value: formatModelPickerValue(model.ref),
          name: model.label,
          description: model.description,
          modelProviderId: model.ref.providerId,
          modelProviderName: model.providerLabel ?? model.ref.providerId,
          ...(modelThoughtLevels ? { modelThoughtLevels } : {}),
          ...(modelDefaultThoughtLevel ? { modelDefaultThoughtLevel } : {}),
        };
      }),
    },
    {
      id: MODE_CONFIG_ID,
      name: "Mode",
      category: MODE_CONFIG_CATEGORY,
      type: "select",
      currentValue: normalizeAvailableCfMode(settings.mode.current),
      options: getCfAgentModeSelectOptions(),
    },
  ];
  if (settings.thoughtLevel.enabled) {
    const thoughtLevelValues = new Set(settings.thoughtLevel.available.map((level) => level.value));
    const defaultThoughtLevel =
      settings.thoughtLevel.defaultLevel &&
      thoughtLevelValues.has(settings.thoughtLevel.defaultLevel)
        ? settings.thoughtLevel.defaultLevel
        : undefined;
    configOptions.push({
      id: THOUGHT_LEVEL_CONFIG_ID,
      name: "Thought Level",
      category: THOUGHT_LEVEL_CONFIG_CATEGORY,
      type: "select",
      currentValue:
        settings.thoughtLevel.current ??
        defaultThoughtLevel ??
        settings.thoughtLevel.available[0]?.value ??
        "",
      options: settings.thoughtLevel.available.map((level) => ({
        value: level.value,
        name: level.label,
        description: level.description,
      })),
    });
  }
  return configOptions;
}
