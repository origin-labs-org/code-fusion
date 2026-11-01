import { modelSelectionSchema } from "./model-selection.js";
import {
  migrateLegacyModelProviderId,
  migrateLegacyOfficialGlmModelId,
} from "./legacy-model-provider-identity.js";
import { parseSubagentMarkdownSelection } from "./subagent-markdown-selection.js";
import {
  parsePluginSubagentModelSelectionOverrides,
  type BuiltInSubagentModelSelectionOverrides,
  type PluginSubagentModelSelectionOverrides,
} from "./subagents-types.js";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function importSubagentStateSelections(input: Record<string, unknown>): Record<
  string,
  unknown
> & {
  builtInModelSelectionOverrides: BuiltInSubagentModelSelectionOverrides;
  pluginAgentModelSelectionOverrides: PluginSubagentModelSelectionOverrides;
} {
  const current = Object.hasOwn(input, "builtInModelSelectionOverrides");
  const selections: BuiltInSubagentModelSelectionOverrides = {};
  for (const name of ["Explore", "general-purpose"] as const) {
    const selection = current
      ? modelSelectionSchema.safeParse(record(input.builtInModelSelectionOverrides)[name]).data
      : parseSubagentMarkdownSelection({
          model: record(input.builtInModelOverrides)[name],
          thoughtLevel: record(input.builtInThoughtLevelOverrides)[name],
        });
    if (!selection) continue;
    const providerId =
      !current && selection.providerId.startsWith("builtin:")
        ? migrateLegacyModelProviderId(selection.providerId)
        : selection.providerId;
    selections[name] = providerId
      ? {
          ...selection,
          providerId,
          modelId: current
            ? selection.modelId
            : migrateLegacyOfficialGlmModelId(selection.providerId, selection.modelId),
        }
      : selection;
  }
  const pluginSelections = Object.hasOwn(input, "pluginAgentModelSelectionOverrides")
    ? parsePluginSubagentModelSelectionOverrides(input.pluginAgentModelSelectionOverrides)
    : Object.fromEntries(
        Object.entries(record(input.pluginAgentModelOverrides)).flatMap(([id, model]) => {
          const selection = parseSubagentMarkdownSelection({
            model,
            thoughtLevel: record(input.pluginAgentThoughtLevelOverrides)[id],
          });
          if (!id.startsWith("plugin:") || !selection) return [];
          const providerId = selection.providerId.startsWith("builtin:")
            ? migrateLegacyModelProviderId(selection.providerId)
            : selection.providerId;
          return [
            [
              id,
              providerId
                ? {
                    ...selection,
                    providerId,
                    modelId: migrateLegacyOfficialGlmModelId(
                      selection.providerId,
                      selection.modelId,
                    ),
                  }
                : selection,
            ],
          ];
        }),
      );
  return {
    ...input,
    builtInModelSelectionOverrides: selections,
    pluginAgentModelSelectionOverrides: pluginSelections,
  };
}
