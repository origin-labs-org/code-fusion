import type { CfPluginStoreListing } from "./cf-protocol/index.js";

const CANONICAL_PLUGIN_NAME_ACRONYMS: Readonly<Record<string, string>> = {
  aws: "AWS",
  mcp: "MCP",
  cf: "CodeFusion",
};

export function resolveLocalizedText(
  locale: string,
  base: string | undefined,
  i18n: Record<string, string> | undefined,
): string | undefined {
  if (i18n) {
    const exact = i18n[locale];
    if (exact) return exact;
    const language = locale.split("-")[0];
    if (language) {
      const match = Object.entries(i18n).find(([key]) => key.split("-")[0] === language);
      if (match?.[1]) return match[1];
    }
  }
  return base;
}

export function formatCanonicalPluginName(name: string, locale: string): string {
  return name
    .trim()
    .split(/[-_]+/u)
    .filter(Boolean)
    .map(
      (part) =>
        CANONICAL_PLUGIN_NAME_ACRONYMS[part.toLowerCase()] ??
        `${part.charAt(0).toLocaleUpperCase(locale)}${part.slice(1)}`,
    )
    .join(" ");
}

export function resolvePluginDisplayName(
  plugin: { name: string; listing?: CfPluginStoreListing },
  locale: string,
): string {
  return (
    resolveLocalizedText(locale, plugin.listing?.displayName, plugin.listing?.displayNameI18n) ??
    formatCanonicalPluginName(plugin.name, locale)
  );
}
