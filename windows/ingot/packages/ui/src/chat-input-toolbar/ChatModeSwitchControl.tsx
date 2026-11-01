import type { RefObject } from "react";
import type { CfConfigOption, CfProvider } from "@origin-ai/cf-shared";
import { SlidersHorizontalIcon } from "lucide-react";
import { ConfigSelect } from "@/chat-input-toolbar/display.js";
import type { useCfIntl } from "@/i18n/IntlProvider.js";

export function ChatModeSwitchControl({
  compactIconOnly = false,
  disabled,
  disabledReason,
  intl,
  labelVisibilityClassName,
  modeOption,
  modeShortcutLabel,
  modeTriggerRef,
  onConfigValueChange,
  open,
  onOpenChange,
  restoreFocusSelector,
  selectedProvider,
}: {
  compactIconOnly?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  intl: ReturnType<typeof useCfIntl>["intl"];
  labelVisibilityClassName?: string;
  modeOption: CfConfigOption;
  modeShortcutLabel: string;
  modeTriggerRef: RefObject<HTMLSpanElement | null>;
  onConfigValueChange: (option: CfConfigOption, value: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  restoreFocusSelector?: string | null;
  selectedProvider: CfProvider;
}) {
  return (
    <ConfigSelect
      option={modeOption}
      onValueChange={(value) => onConfigValueChange(modeOption, value)}
      open={open}
      onOpenChange={onOpenChange}
      disabled={disabled}
      tooltipTitle={
        disabledReason ?? intl.formatMessage({ id: "chat.toolbar.mode.label" })
      }
      shortcutLabel={modeShortcutLabel}
      triggerRef={modeTriggerRef}
      triggerSize="default"
      triggerClassName={
        compactIconOnly
          ?
            "size-7 justify-center gap-0 rounded-lg p-0 text-ui-base @xl/composer:h-7 @xl/composer:w-fit @xl/composer:justify-between @xl/composer:gap-1 @xl/composer:pl-2 @xl/composer:pr-1.5"
          : "gap-1 rounded-lg pl-2 pr-1.5 text-ui-base"
      }
      indicatorClassName={
        compactIconOnly ? "hidden @xl/composer:block" : undefined
      }
      leadingIcon={SlidersHorizontalIcon}
      labelVisibilityClassName={labelVisibilityClassName}
      provider={selectedProvider}
      restoreFocusSelector={restoreFocusSelector}
    />
  );
}
