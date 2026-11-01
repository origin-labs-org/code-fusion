import type { CfPluginMarketplaceSummary } from "@origin-ai/cf-shared";
import { DEFAULT_MARKETPLACE_ID } from "@/settings/recommendedPlugins.js";

const MARKETPLACE_INSTALLED_SOURCE = "cache";

export function resolveMarketplaceDisplayName(
  marketplaceId: string,
  marketplaces: readonly CfPluginMarketplaceSummary[],
  claudeCodePluginsLabel: string,
): string {
  if (marketplaceId === DEFAULT_MARKETPLACE_ID) {
    return claudeCodePluginsLabel;
  }
  const matched = marketplaces.find((marketplace) => marketplace.id === marketplaceId);
  return matched?.name ?? marketplaceId;
}

export function resolvePluginSourceLabel(input: {
  source: string;
  marketplace: string;
  marketplaces: readonly CfPluginMarketplaceSummary[];
  builtinLabel: string;
  claudeCodePluginsLabel: string;
  formatFromMarketplace: (marketplaceName: string) => string;
}): string {
  if (input.source !== MARKETPLACE_INSTALLED_SOURCE) {
    return input.builtinLabel;
  }
  const marketplaceName = resolveMarketplaceDisplayName(
    input.marketplace,
    input.marketplaces,
    input.claudeCodePluginsLabel,
  );
  return input.formatFromMarketplace(marketplaceName);
}
