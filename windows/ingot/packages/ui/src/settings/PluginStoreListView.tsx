import { useUiPluginRecommendations } from "@/plugin-ui/index.js";
import { useIsOfficeMode } from "@/hooks/useInterfaceMode.js";

import { useMemo, useState } from "react";
import type { PluginStoreOrder, CfPluginMarketplaceSummary } from "@origin-ai/cf-shared";
import { CF_OFFICIAL_PLUGIN_MARKETPLACE_ID } from "@origin-ai/cf-shared";
import { cn } from "@/components/lib/utils.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { PluginStoreAvatar } from "@/settings/PluginStoreAvatar.js";
import { PluginStoreCard, type PluginStoreActions } from "@/settings/PluginStoreCard.js";
import { SettingsSearchInput } from "@/settings/SettingsSearchInput.js";
import {
  FALLBACK_CATEGORY,
  KNOWN_CATEGORY_LABEL_IDS,
  groupItemsByCategory,
  resolvePluginStoreSegment,
  isUiPluginItem,
  resolveItemDisplayName,
  selectFeaturedItems,
  sortPersonalMarketplaceGroups,
  storeItemMatches,
  type PersonalMarketplaceGroup,
  type StorePluginItem,
} from "@/settings/pluginStoreListing.js";
import { resolveMarketplaceDisplayName } from "@/settings/pluginSourceLabel.js";

const CATEGORY_VISIBLE_LIMIT = 6;
const RETIRED_STORE_PLUGIN_ID = `restore-legacy-sessions@${CF_OFFICIAL_PLUGIN_MARKETPLACE_ID}`;

export type { PluginStoreSegment } from "@/settings/pluginStoreListing.js";
import type { PluginStoreSegment } from "@/settings/pluginStoreListing.js";

export function PluginStoreListView({
  items: allItems,
  order,
  marketplaces,
  actions,
  loading,
  query,
  onQueryChange,
  onSearchSubmit,
  segment,
  onSegmentChange,
}: {
  items: StorePluginItem[];
  order?: PluginStoreOrder | null;
  marketplaces: CfPluginMarketplaceSummary[];
  actions: PluginStoreActions;
  loading: boolean;
  query: string;
  onSearchSubmit?: () => void;
  onQueryChange: (query: string) => void;
  segment: PluginStoreSegment;
  onSegmentChange: (segment: PluginStoreSegment) => void;
}) {
  const { intl, locale } = useCfIntl();
  const isOfficeMode = useIsOfficeMode();
  const modeOrder = isOfficeMode ? order?.work : order?.code;
  const keyword = query.trim().toLowerCase();
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const items = useMemo(
    () => allItems.filter((item) => item.id !== RETIRED_STORE_PLUGIN_ID),
    [allItems],
  );

  const segmentItems = useMemo(
    () => items.filter((item) => resolvePluginStoreSegment(item) === segment),
    [items, segment],
  );
  const { recommendations } = useUiPluginRecommendations(true);
  const uiItems = useMemo(() => {
    const ranks = new Map<string, number>();
    for (const { pluginId } of recommendations) {
      if (!ranks.has(pluginId)) ranks.set(pluginId, ranks.size);
    }
    return segmentItems
      .filter(isUiPluginItem)
      .sort(
        (left, right) => (ranks.get(left.id) ?? ranks.size) - (ranks.get(right.id) ?? ranks.size),
      );
  }, [segmentItems, recommendations]);
  const publicItems = useMemo(
    () => segmentItems.filter((item) => !isUiPluginItem(item)),
    [segmentItems],
  );
  const personalItems = publicItems;
  const resolveCategoryLabel = useMemo(() => {
    return (category: string): string => {
      const labelId = KNOWN_CATEGORY_LABEL_IDS[category];
      return labelId ? intl.formatMessage({ id: labelId }) : category;
    };
  }, [intl]);

  const featuredItems = useMemo(
    () => selectFeaturedItems(publicItems, marketplaces),
    [marketplaces, publicItems],
  );
  const categoryGroups = useMemo(
    () => groupItemsByCategory(publicItems, locale, modeOrder),
    [locale, publicItems, modeOrder],
  );

  const personalGroups = useMemo(() => {
    const claudeCodePlugins = intl.formatMessage({
      id: "settings.plugins.marketplace.claudeCodePlugins",
    });
    const groups = new Map<string, StorePluginItem[]>();
    for (const item of personalItems) {
      const group = groups.get(item.marketplace) ?? [];
      group.push(item);
      groups.set(item.marketplace, group);
    }
    const titled: PersonalMarketplaceGroup[] = [...groups.entries()].map(
      ([marketplace, groupItems]) => ({
        marketplace,
        title: resolveMarketplaceDisplayName(marketplace, marketplaces, claudeCodePlugins),
        items: groupItems.toSorted((left, right) =>
          resolveItemDisplayName(left, locale).localeCompare(
            resolveItemDisplayName(right, locale),
            locale,
          ),
        ),
      }),
    );
    return sortPersonalMarketplaceGroups(titled, marketplaces, locale);
  }, [intl, locale, marketplaces, personalItems]);

  const searchResults = useMemo(() => {
    if (!keyword) return [];
    return segmentItems
      .filter((item) => storeItemMatches(item, keyword, locale))
      .toSorted((left, right) =>
        resolveItemDisplayName(left, locale).localeCompare(
          resolveItemDisplayName(right, locale),
          locale,
        ),
      );
  }, [segmentItems, keyword, locale]);

  const toggleGroup = (key: string) => {
    setExpandedGroups((current) => ({ ...current, [key]: !(current[key] ?? true) }));
  };

  return (
    <div className="space-y-6" data-testid="plugin-store-list">
      {}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <SegmentPill
            active={segment === "public"}
            testId="plugin-store-segment-public"
            label={intl.formatMessage({
              id: "settings.plugins.store.segment.public",
            })}
            onClick={() => onSegmentChange("public")}
          />
          <SegmentPill
            active={segment === "community"}
            testId="plugin-store-segment-community"
            label={intl.formatMessage({ id: "settings.plugins.store.segment.community" })}
            onClick={() => onSegmentChange("community")}
          />
          <SegmentPill
            active={segment === "personal"}
            testId="plugin-store-segment-personal"
            label={intl.formatMessage({
              id: "settings.plugins.store.segment.personal",
            })}
            onClick={() => onSegmentChange("personal")}
          />
        </div>
        <SettingsSearchInput
          data-testid="plugin-store-search"
          containerClassName="ml-auto min-w-0 flex-[1_1_14rem] sm:max-w-xs"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) onSearchSubmit?.();
          }}
          placeholder={intl.formatMessage({ id: "settings.plugins.store.searchPlaceholder" })}
        />
      </div>

      {!keyword && uiItems.length > 0 ? (
        <section data-testid="plugin-store-ui-section">
          <div className="pb-2">
            <h2 className="text-ui-lg font-semibold">
              {intl.formatMessage({ id: "settings.plugins.store.ui.title" })}
            </h2>
          </div>
          <div aria-hidden="true" className="h-px bg-surface" />
          <div className="mt-2">
            {}
            <CollapsibleCardGroup
              groupKey={`ui:${segment}`}
              items={uiItems}
              expanded={expandedGroups[`ui:${segment}`] ?? true}
              onToggle={toggleGroup}
              actions={actions}
              locale={locale}
            />
          </div>
        </section>
      ) : null}

      {keyword ? (
        <StoreSection
          key="search"
          title={intl.formatMessage(
            { id: "settings.plugins.store.searchResults" },
            { count: String(searchResults.length) },
          )}
        >
          {searchResults.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-3 text-ui-base text-foreground-subtle">
              {intl.formatMessage({ id: "settings.plugins.store.searchEmpty" })}
            </p>
          ) : (
            <CardGrid items={searchResults} actions={actions} locale={locale} />
          )}
        </StoreSection>
      ) : segment !== "personal" ? (
        <>
          {segment === "community" && segmentItems.length === 0 && !loading ? (
            <p
              data-testid="plugin-store-community-empty"
              className="py-8 text-center text-ui-base text-foreground-subtle"
            >
              {intl.formatMessage({ id: "settings.plugins.store.communityEmpty" })}
            </p>
          ) : null}
          {loading ||
          categoryGroups.length > 0 ||
          featuredItems.length > 0 ||
          (segment === "public" && uiItems.length === 0) ? (
            <PublicSegment
              actions={actions}
              categoryGroups={categoryGroups}
              expandedGroups={expandedGroups}
              featuredItems={featuredItems}
              loading={loading}
              locale={locale}
              resolveCategoryLabel={resolveCategoryLabel}
              onToggleGroup={toggleGroup}
            />
          ) : null}
        </>
      ) : (
        <PersonalSegment
          actions={actions}
          expandedGroups={expandedGroups}
          groups={personalGroups}
          locale={locale}
          onToggleGroup={toggleGroup}
        />
      )}
    </div>
  );
}

export function SegmentPill({
  active,
  label,
  onClick,
  testId,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={active}
      className={cn(
        "rounded-full px-3 py-1 text-ui-base font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-input-border-focused",
        active
          ? "bg-selected text-foreground"
          : "text-foreground-subtle hover:bg-hover hover:text-foreground",
      )}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function StoreSection({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      <div className="pb-2">
        <h2 className="text-ui-lg font-semibold text-foreground">{title}</h2>
      </div>
      <div aria-hidden="true" className="h-px bg-surface" />
      <div className="mt-2">{children}</div>
    </section>
  );
}

function CardGrid({
  items,
  actions,
  locale,
}: {
  items: StorePluginItem[];
  actions: PluginStoreActions;
  locale: string;
}) {
  return (
    <div className="grid gap-x-6 gap-y-1 @min-[40rem]/plugin-store:grid-cols-2">
      {items.map((item) => (
        <PluginStoreCard key={item.id} item={item} actions={actions} locale={locale} />
      ))}
    </div>
  );
}

function CollapsibleCardGroup({
  groupKey,
  items,
  expanded,
  onToggle,
  actions,
  locale,
}: {
  groupKey: string;
  items: StorePluginItem[];
  expanded: boolean;
  onToggle: (key: string) => void;
  actions: PluginStoreActions;
  locale: string;
}) {
  const { intl } = useCfIntl();
  const visible = expanded ? items : items.slice(0, CATEGORY_VISIBLE_LIMIT);
  const hidden = expanded ? [] : items.slice(CATEGORY_VISIBLE_LIMIT);
  const hiddenNames = hidden.slice(0, 2).map((item) => resolveItemDisplayName(item, locale));
  return (
    <div>
      <CardGrid items={visible} actions={actions} locale={locale} />
      {hidden.length > 0 ? (
        <button
          type="button"
          data-testid="plugin-store-group-toggle"
          data-group-key={groupKey}
          className="mt-2 flex w-full min-w-0 items-center gap-2 rounded-xl px-2 py-2 text-left text-ui-base text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-input-border-focused"
          onClick={() => onToggle(groupKey)}
        >
          <span className="flex shrink-0 items-center gap-1.5" aria-hidden="true">
            {hidden.slice(0, 3).map((item) => (
              <PluginStoreAvatar
                key={item.id}
                item={item}
                className="size-5 rounded-md"
                iconClassName="size-2.5"
              />
            ))}
          </span>
          <span className="min-w-0 truncate">
            {hidden.length > hiddenNames.length
              ? intl.formatMessage(
                  { id: "settings.plugins.store.viewMore" },
                  {
                    names: hiddenNames.join(intl.formatMessage({ id: "common.listSeparator" })),
                    count: String(hidden.length - hiddenNames.length),
                  },
                )
              : intl.formatMessage(
                  { id: "settings.plugins.store.viewMoreFew" },
                  {
                    names: hiddenNames.join(intl.formatMessage({ id: "common.listSeparator" })),
                  },
                )}
          </span>
        </button>
      ) : expanded && items.length > CATEGORY_VISIBLE_LIMIT ? (
        <button
          type="button"
          data-testid="plugin-store-group-toggle"
          data-group-key={groupKey}
          className="mt-2 rounded-xl px-2 py-2 text-ui-base text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-input-border-focused"
          onClick={() => onToggle(groupKey)}
        >
          {intl.formatMessage({ id: "settings.plugins.store.showLess" })}
        </button>
      ) : null}
    </div>
  );
}

function PublicSegment({
  actions,
  categoryGroups,
  expandedGroups,
  featuredItems,
  loading,
  locale,
  resolveCategoryLabel,
  onToggleGroup,
}: {
  actions: PluginStoreActions;
  categoryGroups: ReturnType<typeof groupItemsByCategory>;
  expandedGroups: Record<string, boolean>;
  featuredItems: StorePluginItem[];
  loading: boolean;
  locale: string;
  resolveCategoryLabel: (category: string) => string;
  onToggleGroup: (key: string) => void;
}) {
  const { intl } = useCfIntl();
  const isEmpty = featuredItems.length === 0 && categoryGroups.length === 0;
  if (isEmpty) {
    return (
      <p className="rounded-xl border border-dashed border-border px-4 py-3 text-ui-base text-foreground-subtle">
        {loading
          ? intl.formatMessage({
              id: "settings.plugins.marketplace.catalogLoading",
            })
          : intl.formatMessage({
              id: "settings.plugins.marketplacePlugins.empty",
            })}
      </p>
    );
  }
  return (
    <div>
      {featuredItems.length > 0 ? (
        <StoreSection
          title={intl.formatMessage({ id: "settings.plugins.store.featured" })}
          className="py-4 first:pt-0 last:pb-0"
        >
          <CardGrid items={featuredItems} actions={actions} locale={locale} />
        </StoreSection>
      ) : null}
      {categoryGroups.map((group) => (
        <StoreSection
          key={group.category}
          className="py-4 first:pt-0 last:pb-0"
          title={
            group.category === FALLBACK_CATEGORY
              ? intl.formatMessage({
                  id: "settings.plugins.store.category.other",
                })
              : resolveCategoryLabel(group.category)
          }
        >
          <CollapsibleCardGroup
            groupKey={`category:${group.category}`}
            items={group.items}
            expanded={expandedGroups[`category:${group.category}`] ?? true}
            onToggle={onToggleGroup}
            actions={actions}
            locale={locale}
          />
        </StoreSection>
      ))}
    </div>
  );
}

function PersonalSegment({
  actions,
  expandedGroups,
  groups,
  locale,
  onToggleGroup,
}: {
  actions: PluginStoreActions;
  expandedGroups: Record<string, boolean>;
  groups: PersonalMarketplaceGroup[];
  locale: string;
  onToggleGroup: (key: string) => void;
}) {
  const { intl } = useCfIntl();
  if (groups.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border px-4 py-3 text-ui-base text-foreground-subtle">
        {intl.formatMessage({ id: "settings.plugins.store.personalEmpty" })}
      </p>
    );
  }
  return (
    <div>
      {groups.map((group) => (
        <StoreSection
          key={group.marketplace}
          title={group.title}
          className="py-4 first:pt-0 last:pb-0"
        >
          <CollapsibleCardGroup
            groupKey={`marketplace:${group.marketplace}`}
            items={group.items}
            expanded={expandedGroups[`marketplace:${group.marketplace}`] ?? true}
            onToggle={onToggleGroup}
            actions={actions}
            locale={locale}
          />
        </StoreSection>
      ))}
    </div>
  );
}
