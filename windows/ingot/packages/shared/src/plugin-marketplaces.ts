export interface DefaultPluginMarketplace {
  id: string;
  source: string;
  name: string;
  description: string;
  pluginCount: number;
  lastUpdated?: string;
}

export const CF_OFFICIAL_PLUGIN_MARKETPLACE_ID = "cf-plugins-official";

export const CLAUDE_OFFICIAL_PLUGIN_MARKETPLACE_ID = "claude-plugins-official";

export const DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS: ReadonlySet<string> = new Set([
  "browser-use@cf-plugins-official",
  "image-search@cf-plugins-official",
  "documents@cf-plugins-official",
  "pdf@cf-plugins-official",
  "presentations@cf-plugins-official",
  "spreadsheets@cf-plugins-official",
  "node-repl-host@cf-plugins-official",
  "skill-creator@cf-plugins-official",
  "plugin-creator@cf-plugins-official",
  "cf-guide@cf-plugins-official",
  "visualize@cf-plugins-official",
]);

export const DEFAULT_PLUGIN_MARKETPLACES: DefaultPluginMarketplace[] = [
  {
    id: CF_OFFICIAL_PLUGIN_MARKETPLACE_ID,
    source: "https://cdn-cf.z.ai/cf/official-plugin/marketplace.json",
    name: CF_OFFICIAL_PLUGIN_MARKETPLACE_ID,
    description: "Official CodeFusion plugins marketplace: built-in and community plugins for CodeFusion.",
    pluginCount: 0,
  },
  {
    id: CLAUDE_OFFICIAL_PLUGIN_MARKETPLACE_ID,
    source: "anthropics/claude-plugins-official",
    name: CLAUDE_OFFICIAL_PLUGIN_MARKETPLACE_ID,
    description:
      "Directory of popular Claude Code extensions including development tools, productivity plugins, and MCP integrations",
    pluginCount: 0,
  },
];

export const PUBLIC_STORE_MARKETPLACE_IDS = [CF_OFFICIAL_PLUGIN_MARKETPLACE_ID] as const;

export function isPublicStoreMarketplaceId(id: string): boolean {
  return (PUBLIC_STORE_MARKETPLACE_IDS as readonly string[]).includes(id);
}
