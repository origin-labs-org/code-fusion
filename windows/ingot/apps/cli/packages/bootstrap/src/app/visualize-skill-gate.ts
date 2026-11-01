import { CF_OFFICIAL_PLUGIN_MARKETPLACE, type SkillRoot } from "@origin-ai/cf-contracts";

const VISUALIZE_PLUGIN_ID = `visualize@${CF_OFFICIAL_PLUGIN_MARKETPLACE}`;

export function filterVisualizeSkillRoots(
  roots: readonly SkillRoot[],
  includeVisualize = false,
): SkillRoot[] {
  return roots.filter((root) => includeVisualize || root.pluginId !== VISUALIZE_PLUGIN_ID);
}
