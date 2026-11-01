import type {
  PluginStoreModeOrder,
  CfAvailablePluginSummary,
  CfInstalledPluginSummary,
  CfPluginInfo,
  CfPluginMarketplaceSummary,
  CfPluginStoreListing,
} from "@origin-ai/cf-shared";
import {
  sortPluginStoreEntries,
  compareDocumentPluginPriority,
  resolvePluginStoreCategory as resolveStoreCategory,
  FALLBACK_PLUGIN_STORE_CATEGORY as FALLBACK_CATEGORY,
  formatCanonicalPluginName,
  isPublicStoreMarketplaceId,
  resolveLocalizedText,
  resolvePluginDisplayName,
  CF_OFFICIAL_PLUGIN_MARKETPLACE_ID,
} from "@origin-ai/cf-shared";
import { DEFAULT_MARKETPLACE_ID } from "@/settings/recommendedPlugins.js";
import { pluginSearchMatches } from "@/settings/pluginSearch.js";

export {
  formatCanonicalPluginName,
  resolveLocalizedText,
  resolvePluginDisplayName,
} from "@origin-ai/cf-shared";

export { isPublicStoreMarketplaceId };
export { isTrustedImageUrl } from "@/lib/trustedImageUrl.js";

export function resolveUniquePluginListingByName(
  plugins: readonly Pick<CfAvailablePluginSummary, "name" | "listing">[],
  name: string,
): CfPluginStoreListing | undefined {
  const normalizedName = name.trim().toLocaleLowerCase();
  let match: CfPluginStoreListing | undefined;
  let count = 0;
  for (const plugin of plugins) {
    if (plugin.name.trim().toLocaleLowerCase() !== normalizedName) continue;
    count += 1;
    match = plugin.listing;
  }
  return count === 1 ? match : undefined;
}

export interface StorePluginItem {
  id: string;
  name: string;
  marketplace: string;
  installed: boolean;
  
  restorable: boolean;
  
  orphaned: boolean;
  listing?: CfPluginStoreListing;
  summary?: CfAvailablePluginSummary;
  
  info?: CfPluginInfo;
  installedMeta?: CfInstalledPluginSummary;
}

export function isItemBusy(
  item: StorePluginItem,
  actions: { activeOperations: ReadonlyArray<{ id: string }>; togglingPluginId: string | null },
): boolean {
  return (
    actions.activeOperations.some(
      (operation) => operation.id === `plugin:install:${item.name}@${item.marketplace}`,
    ) ||
    actions.activeOperations.some((operation) => operation.id === `plugin:restore:${item.id}`) ||
    actions.activeOperations.some((operation) => operation.id === `plugin:uninstall:${item.id}`) ||
    actions.activeOperations.some((operation) => operation.id === `plugin:update:${item.id}`) ||
    actions.activeOperations.some(
      (operation) => operation.id === `plugin:reset-config:${item.id}`,
    ) ||
    actions.activeOperations.some((operation) => operation.id === `plugin:configure:${item.id}`) ||
    actions.togglingPluginId === item.id
  );
}

export type PluginUpdateStatus = NonNullable<CfInstalledPluginSummary["updateStatus"]>;

export function isPluginUpdatePending(
  updateStatus: PluginUpdateStatus | undefined,
): updateStatus is Exclude<PluginUpdateStatus, "none"> {
  return updateStatus === "update-available" || updateStatus === "version-changed";
}

export function canUpdatePluginItem(
  item: Pick<StorePluginItem, "installedMeta" | "orphaned"> | null | undefined,
): boolean {
  return Boolean(item && !item.orphaned && isPluginUpdatePending(item.installedMeta?.updateStatus));
}

export function resolveLocalizedList(
  locale: string,
  base: string[] | undefined,
  i18n: Record<string, string[]> | undefined,
): string[] | undefined {
  if (i18n) {
    const exact = i18n[locale];
    if (exact && exact.length > 0) return exact;
    const language = locale.split("-")[0];
    if (language) {
      const match = Object.entries(i18n).find(([key]) => key.split("-")[0] === language);
      if (match?.[1] && match[1].length > 0) return match[1];
    }
  }
  return base && base.length > 0 ? base : undefined;
}

export function formatCanonicalMarketplaceName(name: string, locale: string): string {
  return formatCanonicalPluginName(name, locale);
}

export function resolveItemDisplayName(item: StorePluginItem, locale: string): string {
  return resolvePluginDisplayName(item, locale);
}

export function resolveItemDescription(item: StorePluginItem, locale: string): string | undefined {
  const base =
    item.summary?.description ?? item.info?.description ?? item.installedMeta?.description;
  return resolveLocalizedText(locale, base, item.listing?.descriptionI18n);
}

export function resolveManagedPluginDisplay(
  plugin: CfPluginInfo,
  item: StorePluginItem | undefined,
  locale: string,
): { name: string; description: string | undefined } {
  const matchingItem = item?.id === plugin.id ? item : undefined;
  return {
    name: resolvePluginDisplayName(matchingItem ?? plugin, locale),
    description: matchingItem ? resolveItemDescription(matchingItem, locale) : plugin.description,
  };
}

export const KNOWN_CATEGORY_LABEL_IDS: Record<string, string> = {
  "developer-tools": "settings.plugins.store.category.developerTools",
  productivity: "settings.plugins.store.category.productivity",
  utilities: "settings.plugins.store.category.utilities",
  legal: "settings.plugins.store.category.legal",
  template: "settings.plugins.store.category.template",
  finance: "settings.plugins.store.category.finance",
  other: "settings.plugins.store.category.other",
};

export {
  resolvePluginStoreCategory as resolveStoreCategory,
  FALLBACK_PLUGIN_STORE_CATEGORY as FALLBACK_CATEGORY,
  PLUGIN_STORE_CATEGORY_ORDER as KNOWN_CATEGORY_ORDER,
} from "@origin-ai/cf-shared";

export interface StoreCategoryGroup {
  category: string;
  items: StorePluginItem[];
}

export type PluginStoreSegment = "public" | "community" | "personal";

export function resolvePluginStoreSegment(item: StorePluginItem): PluginStoreSegment {
  if (!isPublicStoreMarketplaceId(item.marketplace)) return "personal";
  return item.listing?.publisherType === "community" ? "community" : "public";
}

export function isUiPluginItem(item: StorePluginItem): boolean {
  if (item.info) return Boolean(item.info.uiSurfaces?.length);
  return Boolean(
    (item.installedMeta?.componentTypes ?? item.summary?.componentTypes)?.includes("ui"),
  );
}

export interface PersonalMarketplaceGroup {
  marketplace: string;
  title: string;
  items: StorePluginItem[];
}

const OFFICIAL_MARKETPLACE_ORDER = [
  CF_OFFICIAL_PLUGIN_MARKETPLACE_ID,
  DEFAULT_MARKETPLACE_ID,
] as const;

export function sortMarketplaceSources(
  marketplaces: readonly CfPluginMarketplaceSummary[],
  locale: string,
): CfPluginMarketplaceSummary[] {
  const officialRank = new Map(OFFICIAL_MARKETPLACE_ORDER.map((id, index) => [id, index]));
  return marketplaces.toSorted((left, right) => {
    const leftRank = officialRank.get(left.id);
    const rightRank = officialRank.get(right.id);
    if (leftRank !== undefined || rightRank !== undefined) {
      if (leftRank === undefined) return 1;
      if (rightRank === undefined) return -1;
      return leftRank - rightRank;
    }

    const leftAt = left.lastUpdated ?? "";
    const rightAt = right.lastUpdated ?? "";
    if (leftAt !== rightAt) return rightAt.localeCompare(leftAt);
    const byName = left.name.localeCompare(right.name, locale);
    return byName !== 0 ? byName : left.id.localeCompare(right.id, locale);
  });
}

export function sortPersonalMarketplaceGroups(
  groups: PersonalMarketplaceGroup[],
  marketplaces: readonly CfPluginMarketplaceSummary[],
  locale: string,
): PersonalMarketplaceGroup[] {
  const lastUpdatedById = new Map(
    marketplaces.flatMap((marketplace) =>
      marketplace.lastUpdated ? ([[marketplace.id, marketplace.lastUpdated]] as const) : [],
    ),
  );
  return groups.toSorted((left, right) => {
    const leftAt = lastUpdatedById.get(left.marketplace) ?? "";
    const rightAt = lastUpdatedById.get(right.marketplace) ?? "";
    if (leftAt !== rightAt) return rightAt.localeCompare(leftAt);
    return left.title.localeCompare(right.title, locale);
  });
}

export function buildStoreItems(input: {
  marketplaces: CfPluginMarketplaceSummary[];
  marketplaceAvailabilityKnown: boolean;
  availablePlugins: CfAvailablePluginSummary[];
  installedPlugins: CfInstalledPluginSummary[];
  plugins: CfPluginInfo[];
  restorableBuiltins: CfAvailablePluginSummary[];
}): StorePluginItem[] {
  const infoById = new Map(input.plugins.map((plugin) => [plugin.id, plugin]));
  const metaById = new Map(input.installedPlugins.map((item) => [item.id, item]));
  const marketplaceIds = new Set(input.marketplaces.map((item) => item.id));
  const items = new Map<string, StorePluginItem>();

  for (const summary of input.availablePlugins) {
    const info = infoById.get(summary.id);
    items.set(summary.id, {
      id: summary.id,
      name: summary.name,
      marketplace: summary.marketplace,
      installed:
        info?.packageStatus === "missing" ? false : summary.installed || info !== undefined,
      restorable: false,
      orphaned: false,
      ...(summary.listing ? { listing: summary.listing } : {}),
      summary,
      ...(info ? { info } : {}),
      ...(metaById.get(summary.id) ? { installedMeta: metaById.get(summary.id) } : {}),
    });
  }
  for (const summary of input.restorableBuiltins) {
    const existing = items.get(summary.id);
    if (existing) {
      const hasMarketplaceOwnership =
        existing.installed || existing.installedMeta !== undefined || existing.info !== undefined;
      if (hasMarketplaceOwnership) continue;
      items.set(summary.id, {
        ...existing,
        installed: false,
        restorable: true,
        ...(existing.listing || summary.listing
          ? { listing: existing.listing ?? summary.listing }
          : {}),
        ...(existing.summary ? {} : { summary }),
      });
      continue;
    }
    items.set(summary.id, {
      id: summary.id,
      name: summary.name,
      marketplace: summary.marketplace,
      installed: false,
      restorable: true,
      orphaned: false,
      ...(summary.listing ? { listing: summary.listing } : {}),
      summary,
    });
  }
  for (const info of input.plugins) {
    if (items.has(info.id)) continue;
    if (info.packageStatus === "missing") continue;
    items.set(info.id, {
      id: info.id,
      name: info.name,
      marketplace: info.marketplace,
      installed: true,
      restorable: false,
      orphaned:
        input.marketplaceAvailabilityKnown &&
        info.source === "cache" &&
        !marketplaceIds.has(info.marketplace),
      info,
      ...(metaById.get(info.id) ? { installedMeta: metaById.get(info.id) } : {}),
    });
  }
  return [...items.values()];
}

export function selectFeaturedItems(
  publicItems: StorePluginItem[],
  marketplaces: CfPluginMarketplaceSummary[],
): StorePluginItem[] {
  const byName = new Map<string, StorePluginItem>();
  for (const item of publicItems) {
    if (!byName.has(item.name)) byName.set(item.name, item);
  }
  const featured: StorePluginItem[] = [];
  const seen = new Set<string>();
  for (const marketplace of marketplaces) {
    if (!isPublicStoreMarketplaceId(marketplace.id)) continue;
    for (const name of marketplace.featured ?? []) {
      const item = byName.get(name);
      if (item && !seen.has(item.id)) {
        seen.add(item.id);
        featured.push(item);
      }
    }
  }
  return featured;
}

export function groupItemsByCategory(
  items: StorePluginItem[],
  locale: string,
  order?: PluginStoreModeOrder,
): StoreCategoryGroup[] {
  const groups = new Map<string, StorePluginItem[]>();
  const sorted = sortPluginStoreEntries(
    items,
    (item) => ({
      id: item.id,
      category: item.listing?.category,
      displayName: resolveItemDisplayName(item, locale),
    }),
    locale,
    order,
  );
  for (const item of sorted) {
    const category = resolveStoreCategory(item.listing?.category) ?? FALLBACK_CATEGORY;
    const group = groups.get(category) ?? [];
    group.push(item);
    groups.set(category, group);
  }
  return [...groups.entries()].map(([category, items]) => ({ category, items }));
}

export function storeItemMatches(item: StorePluginItem, keyword: string, locale: string): boolean {
  return pluginSearchMatches(
    keyword,
    [
      item.name,
      item.id,
      item.marketplace,
      resolveItemDisplayName(item, locale),
      resolveItemDescription(item, locale) ?? "",
      item.listing?.category ?? "",
      item.listing?.author ?? "",
    ],
    [item.name, item.listing?.displayName, ...Object.values(item.listing?.displayNameI18n ?? {})],
  );
}

export function sortInstalledStripItems(
  items: StorePluginItem[],
  locale: string,
): StorePluginItem[] {
  return items.toSorted((left, right) => {
    const documentPriority = compareDocumentPluginPriority(left.id, right.id);
    if (documentPriority !== 0) return documentPriority;

    const leftIsBuiltin = Boolean(left.info && left.info.source !== "cache");
    const rightIsBuiltin = Boolean(right.info && right.info.source !== "cache");
    if (leftIsBuiltin !== rightIsBuiltin) return leftIsBuiltin ? -1 : 1;

    const compareByName = () =>
      resolveItemDisplayName(left, locale).localeCompare(
        resolveItemDisplayName(right, locale),
        locale,
      );
    if (leftIsBuiltin) return compareByName();

    const leftAt = left.installedMeta?.installedAt ?? "";
    const rightAt = right.installedMeta?.installedAt ?? "";
    if (leftAt !== rightAt) return rightAt.localeCompare(leftAt);
    return compareByName();
  });
}
