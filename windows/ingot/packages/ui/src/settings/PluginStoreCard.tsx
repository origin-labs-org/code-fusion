import {
  Crown,
  Download,
  Loader2,
  MoreHorizontal,
  Power,
  TriangleAlert,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Switch } from "@/components/ui/switch.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { PluginStoreAvatar } from "@/settings/PluginStoreAvatar.js";
import {
  canUpdatePluginItem,
  isItemBusy,
  isUiPluginItem,
  resolveItemDescription,
  resolveItemDisplayName,
  type StorePluginItem,
} from "@/settings/pluginStoreListing.js";
import { runUserAction } from "@/lib/userActionTelemetry.js";

export interface PluginStoreActions {
  onOpenDetail: (pluginId: string) => void;
  onOpenUi?: (item: StorePluginItem) => void;
  
  onInstall: (item: StorePluginItem) => void;
  onUninstall: (pluginId: string) => void;
  onSetEnabled?: (pluginId: string, enabled: boolean) => void;
  
  onResetConfig?: (pluginId: string) => void;
  onUpdate: (pluginId: string) => void;
  activeOperations: ReadonlyArray<{ id: string }>;
  togglingPluginId: string | null;
}

export function PluginStorePaidPlanBadge({
  item,
}: {
  item: Pick<StorePluginItem, "id" | "listing">;
}) {
  const { intl } = useCfIntl();
  if (!item.listing?.requiresPaidPlan) return null;
  const label = intl.formatMessage({ id: "settings.plugins.store.requiresPaidPlan" });
  const badgeLabel = intl.formatMessage({ id: "settings.plugins.store.paidPlanBadge" });
  return (
    <ControlHintTooltip title={label}>
      <span
        data-testid="plugin-store-paid-plan-badge"
        data-plugin-id={item.id}
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--color-plugin-paid-plan-badge)] px-1.5 py-0.5 text-ui-sm leading-none whitespace-nowrap text-[var(--color-plugin-paid-plan-badge-foreground)]"
        aria-label={label}
      >
        <Crown className="size-3" aria-hidden="true" />
        {badgeLabel}
      </span>
    </ControlHintTooltip>
  );
}

export function PluginStoreEnabledSwitch({
  item,
  actions,
}: {
  item: StorePluginItem;
  actions: PluginStoreActions;
}) {
  const { intl } = useCfIntl();
  if (!item.info || !actions.onSetEnabled) return null;
  const enabled = item.info.enabled;
  return (
    <Switch
      data-testid="plugin-store-enabled-switch"
      data-plugin-id={item.id}
      checked={enabled}
      disabled={actions.togglingPluginId === item.id}
      aria-label={
        enabled
          ? intl.formatMessage({ id: "settings.plugins.store.menu.disable" })
          : intl.formatMessage({ id: "settings.plugins.store.menu.enable" })
      }
      onClick={(event) => event.stopPropagation()}
      onCheckedChange={(checked) => actions.onSetEnabled?.(item.id, checked)}
    />
  );
}

export function PluginStoreItemMenu({
  item,
  actions,
  triggerClassName,
  triggerVariant = "ghost",
  triggerSize = "icon-md",
}: {
  item: StorePluginItem;
  actions: PluginStoreActions;
  triggerClassName?: string;
  triggerVariant?: "ghost" | "outline";
  triggerSize?: "icon-md" | "icon-lg";
}) {
  const { intl } = useCfIntl();
  const enabled = item.info?.enabled ?? false;
  const busy = isItemBusy(item, actions);
  const canToggleEnabled = Boolean(item.info && actions.onSetEnabled);
  const hasActionsBeforeUninstall = canToggleEnabled;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {}
        <Button
          type="button"
          data-testid="plugin-store-item-menu"
          data-plugin-id={item.id}
          variant={triggerVariant}
          size={triggerSize}
          className={triggerClassName}
          aria-label={intl.formatMessage({ id: "settings.plugins.store.menu.label" })}
          onClick={(event) => event.stopPropagation()}
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <MoreHorizontal className="size-4" aria-hidden="true" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
        {canToggleEnabled ? (
          <DropdownMenuItem
            data-testid="plugin-store-menu-enabled"
            data-plugin-id={item.id}
            disabled={busy}
            onSelect={() => actions.onSetEnabled?.(item.id, !enabled)}
          >
            <Power className="size-4" aria-hidden="true" />
            {enabled
              ? intl.formatMessage({ id: "settings.plugins.store.menu.disable" })
              : intl.formatMessage({ id: "settings.plugins.store.menu.enable" })}
          </DropdownMenuItem>
        ) : null}
        {item.installed ? (
          <>
            {hasActionsBeforeUninstall ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem
              data-testid="plugin-store-menu-uninstall"
              data-plugin-id={item.id}
              variant="destructive"
              disabled={busy}
              onSelect={() => actions.onUninstall(item.id)}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              {intl.formatMessage({ id: "settings.plugins.detail.uninstall" })}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function PluginStoreInstallButton({
  item,
  actions,
  size = "sm",
}: {
  item: StorePluginItem;
  actions: PluginStoreActions;
  size?: "sm" | "default" | "lg";
}) {
  const { intl } = useCfIntl();
  const installing =
    actions.activeOperations.some(
      (operation) => operation.id === `plugin:install:${item.name}@${item.marketplace}`,
    ) || actions.activeOperations.some((operation) => operation.id === `plugin:restore:${item.id}`);
  return (
    <Button
      type="button"
      data-testid="plugin-store-install"
      data-plugin-id={item.id}
      variant="secondary"
      size={size}
      className="rounded-full"
      disabled={installing}
      onClick={(event) => {
        event.stopPropagation();
        runUserAction({
          input: { featureId: "extension.plugin", action: "install", trigger: "button" },
          operation: () => actions.onInstall(item),
          completed: { resultSource: "optimistic_projection" },
          failureStage: "plugin_install",
        });
      }}
    >
      {installing ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
      {installing
        ? intl.formatMessage({ id: "settings.plugins.marketplace.installing" })
        : intl.formatMessage({ id: "settings.plugins.store.install" })}
    </Button>
  );
}

export function PluginStoreUpdateBadge({
  item,
}: {
  item: Pick<StorePluginItem, "id" | "installedMeta" | "orphaned"> | null | undefined;
}) {
  const { intl } = useCfIntl();
  if (!canUpdatePluginItem(item)) return null;
  const label = intl.formatMessage({ id: "settings.plugins.list.updateAvailable" });
  return (
    <span
      data-testid="plugin-store-update-badge"
      data-plugin-id={item?.id}
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success/14 px-1.5 py-0.5 text-ui-sm leading-none whitespace-nowrap text-success dark:bg-success/18"
      aria-label={label}
    >
      <Download className="size-3" aria-hidden="true" />
      {label}
    </span>
  );
}

export function PluginStoreUpdateButton({
  item,
  actions,
  size = "sm",
}: {
  item: StorePluginItem | null | undefined;
  actions: PluginStoreActions;
  size?: "sm" | "default" | "lg";
}) {
  const { intl } = useCfIntl();
  if (!item || !canUpdatePluginItem(item)) return null;
  const updating = actions.activeOperations.some(
    (operation) => operation.id === `plugin:update:${item.id}`,
  );
  return (
    <Button
      type="button"
      data-testid="plugin-store-card-update"
      data-plugin-id={item.id}
      variant="secondary"
      size={size}
      className="rounded-full"
      disabled={isItemBusy(item, actions)}
      onClick={(event) => {
        event.stopPropagation();
        actions.onUpdate(item.id);
      }}
    >
      {updating ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
      ) : (
        <Download className="size-3.5" aria-hidden="true" />
      )}
      {intl.formatMessage({ id: "settings.plugins.detail.update" })}
    </Button>
  );
}

export function PluginStoreCard({
  item,
  actions,
  locale,
}: {
  item: StorePluginItem;
  actions: PluginStoreActions;
  locale: string;
}) {
  const { intl } = useCfIntl();
  const displayName = resolveItemDisplayName(item, locale);
  const description = resolveItemDescription(item, locale);
  const open = () => actions.onOpenDetail(item.id);
  return (
    <div
      role="button"
      tabIndex={0}
      data-testid="plugin-store-card"
      data-plugin-id={item.id}
      className="group/card flex min-w-0 cursor-pointer items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-input-border-focused"
      onClick={open}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      }}
    >
      <PluginStoreAvatar item={item} className="size-10" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate text-ui-base font-semibold text-foreground">
            {displayName}
          </span>
          <PluginStorePaidPlanBadge item={item} />
          <PluginStoreUpdateBadge item={item} />
        </div>
        {item.orphaned ? (
          <div
            data-testid="plugin-store-source-degraded"
            data-plugin-id={item.id}
            className="mt-0.5 flex items-center gap-1 truncate text-ui-sm text-warning"
          >
            <TriangleAlert className="size-3 shrink-0" aria-hidden="true" />
            <span className="truncate">
              {intl.formatMessage({ id: "settings.plugins.store.sourceMissing" })}
            </span>
          </div>
        ) : null}
        {description ? (
          <div className="mt-0.5 truncate text-ui-sm text-foreground-subtle">{description}</div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {item.installed ? (
          <>
            <PluginStoreOpenUiButton item={item} actions={actions} />
            <PluginStoreUpdateButton item={item} actions={actions} />
            {}
            <PluginStoreItemMenu item={item} actions={actions} />
          </>
        ) : (
          <PluginStoreInstallButton item={item} actions={actions} />
        )}
      </div>
    </div>
  );
}

export function PluginStoreOpenUiButton({
  item,
  actions,
}: {
  item: StorePluginItem;
  actions: PluginStoreActions;
}) {
  const { intl } = useCfIntl();
  if (!item.installed || !isUiPluginItem(item) || !actions.onOpenUi) return null;
  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      data-testid="plugin-store-open-ui"
      data-plugin-id={item.id}
      disabled={isItemBusy(item, actions)}
      onClick={(event) => {
        event.stopPropagation();
        actions.onOpenUi?.(item);
      }}
    >
      {intl.formatMessage({
        id:
          (item.info?.enabled ?? item.installedMeta?.enabled)
            ? "settings.plugins.store.ui.open"
            : "settings.plugins.store.menu.enable",
      })}
    </Button>
  );
}
