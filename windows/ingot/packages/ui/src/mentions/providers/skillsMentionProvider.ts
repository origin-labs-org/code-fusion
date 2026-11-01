import { useMemo } from "react";
import type { Locale, SkillScope, CfProvider } from "@origin-ai/cf-shared";
import type { MentionCategoryResult, MentionItem } from "@/mentions/mentionTypes.js";
import { filterMentionItemsWithOptions } from "@/mentions/mentionSearch.js";
import { buildSkillMentionMarkdown } from "@/mentions/mentionMarkdown.js";
import { useSkills } from "@/hooks/useSkills.js";
import { filterSkillsForProvider } from "@/lib/skillSourceFilter.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { resolveSkillDisplayDescription, resolveSkillSourceLabel } from "@/lib/builtinSkillI18n.js";

export function mapSkillsToMentionItemsForTest(
  skills: Array<{
    id: string;
    name: string;
    description: string;
    path: string;
    scope: SkillScope;
    pluginName?: string;
  }>,
  locale?: Locale,
): MentionItem[] {
  const uniqueSkillsByName = new Map<string, (typeof skills)[number]>();
  const scopePriority: Record<SkillScope, number> = {
    workspace: 0,
    plugin: 1,
    user: 2,
  };
  for (const skill of skills) {
    const key = skill.name.trim().toLowerCase();
    const current = uniqueSkillsByName.get(key);
    if (!current || scopePriority[skill.scope] < scopePriority[current.scope]) {
      uniqueSkillsByName.set(key, skill);
    }
  }
  const uniqueSkills = [...uniqueSkillsByName.values()];

  return uniqueSkills.map((skill) => {
    const sourceLabel = resolveSkillSourceLabel(skill.scope, locale);
    const description = resolveSkillDisplayDescription(skill, locale);
    return {
      id: `skill:${skill.id}`,
      category: "skills",
      label: skill.name,
      description: description ? `${sourceLabel} · ${description}` : sourceLabel,
      value: skill.name,
      markdown: buildSkillMentionMarkdown(skill.name, skill.path),
      keywords: [...new Set([skill.name, skill.description, description, skill.scope])],
      data: {
        path: skill.path,
        scope: skill.scope,
      },
    };
  });
}

export function useSkillsMentionProvider(
  workspacePath: string,
  workspaceIdentity: string | undefined,
  sessionId: string | null,
  provider: CfProvider,
  query: string,
  enabled: boolean,
  requireQuery: boolean,
  emptyText: string,
  title: string,
): MentionCategoryResult {
  const { locale } = useCfIntl();
  const { skills, loading, error } = useSkills({
    workspacePath,
    workspaceIdentity,
    sessionId,
    enabled,
  });

  const allItems = useMemo(
    () =>
      mapSkillsToMentionItemsForTest(
        filterSkillsForProvider(skills, provider).filter((skill) => skill.enabled),
        locale,
      ),
    [locale, provider, skills],
  );

  const items = useMemo(
    () =>
      filterMentionItemsWithOptions(allItems, query, {
        requireQuery,
      }),
    [allItems, query, requireQuery],
  );

  return {
    items: enabled ? items : [],
    loading,
    error: error ? new Error(error) : null,
    emptyText,
    title,
  };
}
