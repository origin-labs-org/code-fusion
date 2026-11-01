import recommendedPluginsConfig from "@/settings/recommendedPlugins.json" with { type: "json" };

export const DEFAULT_MARKETPLACE_ID = (recommendedPluginsConfig as { marketplace: string })
  .marketplace;
