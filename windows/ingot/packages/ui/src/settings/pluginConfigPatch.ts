import type { CfPluginInfo, CfPluginUserConfigOption } from "@origin-ai/cf-shared";

export type PluginOptionDraftValue = string | number | boolean | null;

export interface PluginConfigPatch {
  options: Record<string, string | number | boolean>;
  clearOptionKeys: string[];
}

export function buildPluginConfigPatch(
  plugin: Pick<CfPluginInfo, "userConfig">,
  drafts: Record<string, PluginOptionDraftValue | undefined>,
): PluginConfigPatch {
  const options: Record<string, string | number | boolean> = {};
  const clearOptionKeys: string[] = [];

  for (const [key, option] of Object.entries(plugin.userConfig ?? {}) as [
    string,
    CfPluginUserConfigOption,
  ][]) {
    const draft = drafts[key];
    if (draft === undefined) continue;
    if (draft === null) {
      clearOptionKeys.push(key);
      continue;
    }

    if (option.sensitive && draft === "") continue;

    if (option.type === "number") {
      const numeric = typeof draft === "number" ? draft : Number(draft);
      if (Number.isFinite(numeric)) options[key] = numeric;
      continue;
    }
    options[key] = draft;
  }

  return { options, clearOptionKeys };
}
