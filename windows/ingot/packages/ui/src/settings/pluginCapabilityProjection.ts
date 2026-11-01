import {
  resolveManagedPluginDisplay,
  type StorePluginItem,
} from "@/settings/pluginStoreListing.js";
import type {
  SkillSummary,
  CfCommand,
  CfInstalledPluginSummary,
  CfPluginInfo,
  CfPluginScope,
} from "@origin-ai/cf-shared";
import { compareDocumentPluginPriority, isPluginCommand, isUserCommand } from "@origin-ai/cf-shared";
import { pluginSearchMatches } from "@/settings/pluginSearch.js";

function canonicalPluginName(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function needsMcpAttention(resource: {
  authorization?: { authorizationUrl?: string };
}): boolean {
  return Boolean(resource.authorization?.authorizationUrl);
}

export function selectBuiltInPlugins(
  plugins: readonly CfPluginInfo[],
  installedPlugins: readonly CfInstalledPluginSummary[],
): CfPluginInfo[] {
  const installedIds = new Set(installedPlugins.map((plugin) => plugin.id));
  return plugins.filter((plugin) => plugin.source === "official" && !installedIds.has(plugin.id));
}

export interface PluginSettingsGroups {
  installed: CfPluginInfo[];
  builtIn: CfPluginInfo[];
}

export function partitionPluginsForSettings(
  plugins: readonly CfPluginInfo[],
  builtInPluginIds: ReadonlySet<string>,
): PluginSettingsGroups {
  const materializedPlugins = plugins.filter((plugin) => plugin.packageStatus !== "missing");
  return {
    installed: materializedPlugins.filter((plugin) => !builtInPluginIds.has(plugin.id)),
    builtIn: materializedPlugins
      .filter((plugin) => builtInPluginIds.has(plugin.id))
      .toSorted((left, right) => compareDocumentPluginPriority(left.id, right.id)),
  };
}

export function filterPluginsByQuery(
  plugins: readonly CfPluginInfo[],
  query: string,
  itemsById?: ReadonlyMap<string, StorePluginItem>,
  locale = "en-US",
): CfPluginInfo[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [...plugins];
  return plugins.filter((plugin) => {
    const candidate = itemsById?.get(plugin.id);
    const item = candidate?.id === plugin.id ? candidate : undefined;
    const display = resolveManagedPluginDisplay(plugin, item, locale);
    return pluginSearchMatches(
      normalizedQuery,
      [plugin.name, plugin.id, plugin.marketplace, display.name, display.description],
      [
        plugin.name,
        item?.listing?.displayName,
        ...Object.values(item?.listing?.displayNameI18n ?? {}),
      ],
    );
  });
}

export function selectPluginsForScope(
  plugins: readonly CfPluginInfo[],
  _installedPlugins: readonly CfInstalledPluginSummary[],
  _scope: CfPluginScope,
): CfPluginInfo[] {
  return [...plugins];
}

export function selectSkillsForScope(
  skills: readonly SkillSummary[],
  scopedPlugins: readonly Pick<CfPluginInfo, "id" | "name" | "enabled">[],
  scope: CfPluginScope,
): SkillSummary[] {
  const enabledPlugins = scopedPlugins.filter((plugin) => plugin.enabled);
  const scopedPluginIds = new Set(enabledPlugins.map((plugin) => plugin.id));
  const scopedPluginIdsByName = new Map<string, string[]>();
  for (const plugin of enabledPlugins) {
    const name = canonicalPluginName(plugin.name);
    scopedPluginIdsByName.set(name, [...(scopedPluginIdsByName.get(name) ?? []), plugin.id]);
  }
  return skills.filter((skill) => {
    if (skill.scope !== "plugin") {
      return skill.scope === scope;
    }
    if (skill.pluginId) return scopedPluginIds.has(skill.pluginId);
    const matchingIds = skill.pluginName
      ? scopedPluginIdsByName.get(canonicalPluginName(skill.pluginName))
      : undefined;
    return matchingIds?.length === 1;
  });
}

export function selectCommandsForScope(
  commands: readonly CfCommand[],
  scopedPlugins: readonly Pick<CfPluginInfo, "id" | "name" | "enabled">[],
  scope: CfPluginScope,
): CfCommand[] {
  const enabledPlugins = scopedPlugins.filter((plugin) => plugin.enabled);
  const scopedPluginIds = new Set(enabledPlugins.map((plugin) => plugin.id));
  const scopedPluginIdsByName = new Map<string, string[]>();
  for (const plugin of enabledPlugins) {
    const name = canonicalPluginName(plugin.name);
    scopedPluginIdsByName.set(name, [...(scopedPluginIdsByName.get(name) ?? []), plugin.id]);
  }
  return commands.filter((command) => {
    if (isUserCommand(command)) {
      return command.location.scope === (scope === "user" ? "user" : "project");
    }
    if (!isPluginCommand(command)) return false;
    const marketplace = command.pluginMarketplace?.trim() ?? "";
    const pluginId = `${command.pluginName.trim()}@${marketplace}`;
    if (marketplace) return scopedPluginIds.has(pluginId);
    const matchingIds = scopedPluginIdsByName.get(canonicalPluginName(command.pluginName));
    return matchingIds?.length === 1;
  });
}

export interface SkillSourceGroup {
  id: string;
  label: string;
  pluginId?: string;
  skills: SkillSummary[];
  source: "direct" | "plugin";
}

export function groupScopedSkillsBySource(
  skills: readonly SkillSummary[],
  directLabel: string,
): SkillSourceGroup[] {
  const direct: SkillSummary[] = [];
  const pluginGroups = new Map<string, SkillSourceGroup>();
  for (const skill of skills) {
    if (skill.scope !== "plugin") {
      direct.push(skill);
      continue;
    }
    const pluginName = skill.pluginName?.trim();
    if (!pluginName) continue;
    const pluginId = skill.pluginId?.trim();
    const id = pluginId || canonicalPluginName(pluginName);
    const group = pluginGroups.get(id) ?? {
      id: `plugin:${id}`,
      label: pluginName,
      ...(pluginId ? { pluginId } : {}),
      skills: [],
      source: "plugin" as const,
    };
    group.skills.push(skill);
    pluginGroups.set(id, group);
  }
  return [
    ...(direct.length > 0
      ? [
          {
            id: "direct",
            label: directLabel,
            skills: direct,
            source: "direct" as const,
          },
        ]
      : []),
    ...Array.from(pluginGroups.values()).sort((left, right) =>
      left.label.localeCompare(right.label),
    ),
  ];
}
