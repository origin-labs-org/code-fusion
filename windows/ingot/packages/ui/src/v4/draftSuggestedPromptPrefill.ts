import type { CfPluginReferenceCatalogEntry } from "@origin-ai/cf-shared";
import { buildPluginMentionMarkdown } from "@/mentions/mentionMarkdown.js";
import type { ComposerMentionPrefill } from "@/store/cfSessionStoreTypes.js";

export interface DraftSuggestedPromptPluginReference {
  stableId: string;
  label: string;
}

export interface DraftSuggestedPromptPrefill {
  text: string;
  mention?: ComposerMentionPrefill;
  pluginUnavailable?: true;
}

export function buildDraftSuggestedPluginMention(
  plugin: DraftSuggestedPromptPluginReference,
  icon?: string,
): ComposerMentionPrefill {
  const markdown = buildPluginMentionMarkdown(plugin.label, plugin.stableId);
  return {
    id: `plugin:${plugin.stableId}`,
    category: "plugins",
    label: plugin.label,
    value: plugin.stableId,
    markdown,
    data: {
      pluginId: plugin.stableId,
      ...(icon ? { icon } : {}),
    },
  };
}

export async function buildDraftSuggestedPromptPrefill({
  prompt,
  plugin,
  loadPluginCatalog,
  onCatalogError,
}: {
  prompt: string;
  plugin?: DraftSuggestedPromptPluginReference;
  loadPluginCatalog: () => Promise<readonly CfPluginReferenceCatalogEntry[]>;
  onCatalogError?: (error: unknown) => void;
}): Promise<DraftSuggestedPromptPrefill> {
  const text = prompt.trim();
  if (!plugin) {
    return { text };
  }

  let catalog: readonly CfPluginReferenceCatalogEntry[];
  try {
    catalog = await loadPluginCatalog();
  } catch (error) {
    onCatalogError?.(error);
    return { text };
  }

  const entry = catalog.find(
    (candidate) => candidate.pluginId === plugin.stableId,
  );
  if (!entry || !entry.enabled) {
    return { text, pluginUnavailable: true };
  }
  if (entry.conflictingPluginIds.length > 0) {
    return { text };
  }

  const mention = buildDraftSuggestedPluginMention(plugin, entry.icon);
  const markdown = mention.markdown;

  return {
    text: text ? `${markdown} ${text}` : markdown,
    mention,
  };
}
