
import {
  useCallback,
  useMemo,
  type ComponentProps,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import {
  type CfApiRetryStatus,
  type CfConfigOption,
  type CfConfigSelectValue,
  type CfProvider,
} from "@origin-ai/cf-shared";
import {
  TID_CHAT_MODE_SELECT_ITEM,
  TID_CHAT_MODE_SELECT_TRIGGER,
  TID_CHAT_THOUGHT_LEVEL_SELECT_ITEM,
  TID_CHAT_THOUGHT_LEVEL_SELECT_TRIGGER,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import {
  isCoarseTouchDevice,
  shouldRestoreChatInputFocusAfterPickerClose,
} from "@/lib/pickerFocus.js";
import { cn } from "@/components/lib/utils.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import {
  ChevronDownIcon,
  HandIcon,
  NotepadText,
  ShieldAlertIcon,
  ShieldCheckIcon,
  type LucideIcon,
} from "lucide-react";
import {
  CF_MODE_OPTION_DESCRIPTION_IDS,
  CF_MODE_OPTION_LABEL_IDS,
} from "./display-help.js";
import { RollingToolbarLabel } from "@/chat-input-toolbar/RollingToolbarLabel.js";

export {
  ChatContextUsage,
  getContextCompressionCommand,
  getRenderableTaskUsage,
} from "@/chat-input-toolbar/contextUsage.js";

type ConfigSelectTriggerSize = ComponentProps<typeof SelectTrigger>["size"];
type ConfigSelectTriggerVariant = ComponentProps<
  typeof SelectTrigger
>["variant"];

export function isConfigSelectValueInOptions(
  option: CfConfigOption,
  value: string,
): boolean {
  return option.options?.some((entry) => String(entry.value) === value) ?? false;
}

const HIGH_PERMISSION_MODE_VALUES = new Set([
  "bypassPermissions",
  "full-access",
  "agent-full-access",
  "yolo",
]);

function getConfigSelectTriggerTestId(
  option: CfConfigOption,
): string | undefined {
  if (option.category === "thought_level") {
    return TID_CHAT_THOUGHT_LEVEL_SELECT_TRIGGER;
  }
  if (option.category === "mode") {
    return TID_CHAT_MODE_SELECT_TRIGGER;
  }

  return undefined;
}

function getConfigSelectItemTestId(
  option: CfConfigOption,
  entry: CfConfigSelectValue,
): string | undefined {
  if (option.category === "thought_level") {
    return testId(TID_CHAT_THOUGHT_LEVEL_SELECT_ITEM, entry.value);
  }
  if (option.category === "mode") {
    return testId(TID_CHAT_MODE_SELECT_ITEM, entry.value);
  }

  return undefined;
}

export function buildModelSearchText({
  itemName,
}: {
  itemName: string;
}): string {
  return itemName.trim();
}

export function matchesModelDisplayNameSearch(
  modelDisplayName: string,
  searchText: string,
): boolean {
  const normalizedSearchText = searchText.trim().toLocaleLowerCase();
  if (normalizedSearchText.length === 0) {
    return true;
  }

  return modelDisplayName
    .trim()
    .toLocaleLowerCase()
    .includes(normalizedSearchText);
}

export function ChatApiRetryStatus({
  apiRetry,
  intl,
  locale,
}: {
  apiRetry: CfApiRetryStatus | null;
  intl: ReturnType<typeof useCfIntl>["intl"];
  locale: string;
}) {
  const retryLabel = useMemo(() => {
    if (!apiRetry) {
      return null;
    }

    const formatter = new Intl.NumberFormat(locale);
    return intl.formatMessage(
      { id: "chat.apiRetryStatus" },
      {
        attempt: formatter.format(apiRetry.attempt),
        maxRetries: formatter.format(apiRetry.maxRetries),
      },
    );
  }, [apiRetry, intl, locale]);

  if (!apiRetry || !retryLabel) {
    return null;
  }

  const retryTitle =
    apiRetry.errorStatus == null
      ? retryLabel
      : `${retryLabel} · HTTP ${apiRetry.errorStatus}`;

  return (
    <span
      className="inline-flex h-7 items-center whitespace-nowrap px-1 text-ui-base"
      title={retryTitle}
    >
      {}
      <span className="animated-gradient-text animated-gradient-text-subtle font-medium">
        {retryLabel}
      </span>
    </span>
  );
}

export function getModeOptionDisplayLabel(
  intl: ReturnType<typeof useCfIntl>["intl"],
  provider: CfProvider | undefined,
  entry: Pick<CfConfigSelectValue, "name" | "value">,
): string {
  const labelMessageId = getModeOptionLabelMessageId(provider, entry);
  if (!labelMessageId) {
    return entry.name;
  }

  return intl.formatMessage({ id: labelMessageId });
}

export function getModeOptionLabelMessageId(
  provider: CfProvider | undefined,
  entry: Pick<CfConfigSelectValue, "value">,
): string | null {
  if (!provider) {
    return null;
  }

  return CF_MODE_OPTION_LABEL_IDS[provider]?.[entry.value] ?? null;
}

export function getModeOptionDescriptionMessageId(
  provider: CfProvider | undefined,
  entry: Pick<CfConfigSelectValue, "value">,
): string | null {
  if (!provider) {
    return null;
  }

  return CF_MODE_OPTION_DESCRIPTION_IDS[provider]?.[entry.value] ?? null;
}

export function getConfigOptionEntryLabel(
  intl: ReturnType<typeof useCfIntl>["intl"],
  provider: CfProvider | undefined,
  option: CfConfigOption,
  entry: CfConfigSelectValue,
): string {
  if (option.category === "mode") {
    return getModeOptionDisplayLabel(intl, provider, entry);
  }

  return entry.name;
}

export function getConfigOptionEntryDescription(
  intl: ReturnType<typeof useCfIntl>["intl"],
  provider: CfProvider | undefined,
  option: CfConfigOption,
  entry: CfConfigSelectValue,
): string | undefined {
  if (option.category !== "mode") {
    return entry.description;
  }

  const descriptionMessageId = getModeOptionDescriptionMessageId(
    provider,
    entry,
  );
  if (descriptionMessageId) {
    return intl.formatMessage({ id: descriptionMessageId });
  }

  return entry.description;
}

export function isHighPermissionModeValue(value: unknown): boolean {
  return typeof value === "string" && HIGH_PERMISSION_MODE_VALUES.has(value);
}

export function resolveModeOptionIcon(value: unknown): LucideIcon {
  if (isHighPermissionModeValue(value)) {
    return ShieldAlertIcon;
  }

  if (typeof value === "string" && /^(default|build)$/i.test(value))
    return HandIcon;
  if (typeof value === "string" && value.toLocaleLowerCase() === "plan")
    return NotepadText;

  if (
    typeof value === "string" &&
    /^(auto|acceptEdits|agent|autoEdit|dontAsk|edit|guarded)$/i.test(value)
  ) {
    return ShieldCheckIcon;
  }

  return HandIcon;
}

export function ConfigSelect({
  option,
  onValueChange,
  open,
  onOpenChange,
  disabled,
  tooltipTitle,
  shortcutLabel,
  triggerRef,
  triggerClassName,
  indicatorClassName,
  triggerVariant = "ghost",
  triggerSize = "lg",
  leadingIcon: LeadingIcon,
  labelVisibilityClassName = "hidden @xl/composer:inline-flex",
  provider,
  restoreFocusSelector = '[data-testid="chat-input"]',
}: {
  option: CfConfigOption;
  onValueChange: (value: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  tooltipTitle: string;
  shortcutLabel?: string;
  triggerRef?: RefObject<HTMLSpanElement | null>;
  triggerClassName?: string;
  indicatorClassName?: string;
  triggerVariant?: ConfigSelectTriggerVariant;
  triggerSize?: ConfigSelectTriggerSize;
  leadingIcon?: LucideIcon;
  labelVisibilityClassName?: string;
  provider?: CfProvider;
  restoreFocusSelector?: string | null;
}) {
  const { intl } = useCfIntl();

  const handleContentKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Tab") {
        return;
      }

      const highlightedItem =
        event.currentTarget.querySelector<HTMLElement>(
          '[data-slot="select-item"][data-highlighted]',
        ) ??
        event.currentTarget.querySelector<HTMLElement>(
          '[data-slot="select-item"][data-state="checked"]',
        ) ??
        event.currentTarget.querySelector<HTMLElement>(
          '[data-slot="select-item"]',
        );

    if (!highlightedItem) {
      return;
    }

      event.preventDefault();
      highlightedItem.click();
    },
    [],
  );

  if (option.type !== "select" || !option.options?.length) {
    return null;
  }

  const shouldUseToolbarFloatingSelect =
    option.category === "mode" || option.category === "thought_level";
  const shouldShowHighPermissionModeIcon =
    option.category === "mode" &&
    isHighPermissionModeValue(option.currentValue);
  const ResolvedLeadingIcon =
    option.category === "mode"
      ? resolveModeOptionIcon(option.currentValue)
      : LeadingIcon;
  const resolvedTriggerClassName = cn(
    triggerClassName,
    shouldShowHighPermissionModeIcon &&
      "text-warning hover:text-warning aria-expanded:text-warning",
    option.category === "mode" &&
      option.currentValue === "guarded" &&
      "text-icon-blue hover:text-icon-blue aria-expanded:text-icon-blue",
  );
  const resolvedLeadingIconClassName = cn(
    "pointer-events-none size-4 text-current",
    shouldShowHighPermissionModeIcon && "text-warning",
  );

  const selectContentProps = shouldUseToolbarFloatingSelect
    ? {
        position: "popper" as const,
        side: "top" as const,
        align: "start" as const,
        sideOffset: 4,
        collisionPadding: 8,
        className: option.category === "mode" ? "w-64" : undefined,
      }
    : undefined;
  const triggerTestId = getConfigSelectTriggerTestId(option);
  const currentEntry = option.options.find(
    (entry) => entry.value === option.currentValue,
  );
  const currentValueLabel = currentEntry
    ? getConfigOptionEntryLabel(intl, provider, option, currentEntry)
    : option.category === "mode"
      ? getModeOptionDisplayLabel(intl, provider, {
          value: String(option.currentValue ?? ""),
          name: String(option.currentValue ?? ""),
        })
    : String(option.currentValue ?? "");
  const thoughtLevelTextClassName =
    option.category === "thought_level" ? "first-letter:uppercase" : undefined;

  return (
    <Select
      open={open}
      onOpenChange={onOpenChange}
      value={String(option.currentValue)}
      onValueChange={(value) => {
        if (!isConfigSelectValueInOptions(option, value)) {
          logger.warn("[ConfigSelect] Ignore selection callback outside allowed values", {
            category: option.category,
            value,
          });
          return;
        }
        onValueChange(value);
      }}
      disabled={disabled}
    >
      <ControlHintTooltip
        title={tooltipTitle}
        shortcut={shortcutLabel}
        triggerRef={triggerRef}
      >
        <SelectTrigger
          variant={triggerVariant}
          size={triggerSize}
          className={resolvedTriggerClassName}
          indicator={
            <ChevronDownIcon
              className={cn(
                "pointer-events-none size-3.5 text-foreground-subtle",
                indicatorClassName,
              )}
            />
          }
          aria-label={tooltipTitle}
          data-testid={triggerTestId}
        >
          {ResolvedLeadingIcon ? (
            <ResolvedLeadingIcon className={resolvedLeadingIconClassName} />
          ) : null}
          <span className={labelVisibilityClassName}>
            {}
            {option.category === "mode" ? (
              <RollingToolbarLabel label={currentValueLabel} />
            ) : (
              <SelectValue>
                <span className={thoughtLevelTextClassName}>
                  {currentValueLabel}
                </span>
              </SelectValue>
            )}
          </span>
        </SelectTrigger>
      </ControlHintTooltip>
      <SelectContent
        {...selectContentProps}
        onKeyDown={handleContentKeyDown}
        onCloseAutoFocus={(event) => {
          if (!restoreFocusSelector) {
            return;
          }
          event.preventDefault();
          if (
            !shouldRestoreChatInputFocusAfterPickerClose({
              isCoarseTouchDevice: isCoarseTouchDevice(),
            })
          ) {
            return;
          }
          const input =
            document.querySelector<HTMLElement>(restoreFocusSelector);
          logger.debug("[ConfigSelect] picker focus handoff", {
            category: option.category,
            restoreFocusSelector,
            targetFound: Boolean(input),
          });
          input?.focus();
        }}
      >
        {option.category === "mode"
          ? option.options.map((entry) => {
              const ModeIcon = resolveModeOptionIcon(entry.value);
              const optionLabel = getConfigOptionEntryLabel(
                intl,
                provider,
                option,
                entry,
              );
              const optionDescription = getConfigOptionEntryDescription(
                intl,
                provider,
                option,
                entry,
              );

              return (
                <SelectItem
                  key={entry.value}
                  value={entry.value}
                  className="min-h-13 items-start gap-3 py-2 pl-2 pr-8"
                  data-testid={getConfigSelectItemTestId(option, entry)}
                >
                  <span className="flex min-w-0 items-start gap-3">
                    <ModeIcon className="mt-0.5 size-4.5 shrink-0 text-foreground" />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate text-ui-base/relaxed text-foreground">
                        {optionLabel}
                      </span>
                      {optionDescription?.trim() ? (
                        <span className="line-clamp-2 text-ui-sm/relaxed text-foreground-subtle whitespace-nowrap">
                          {optionDescription}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </SelectItem>
              );
            })
          : option.options.map((entry) => (
              <SelectItem
                key={entry.value}
                value={entry.value}
                data-testid={getConfigSelectItemTestId(option, entry)}
              >
                <span className={thoughtLevelTextClassName}>
                  {getConfigOptionEntryLabel(intl, provider, option, entry)}
                </span>
              </SelectItem>
            ))}
      </SelectContent>
    </Select>
  );
}
