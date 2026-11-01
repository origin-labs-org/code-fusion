
import { memo } from "react";
import { MonitorCogIcon } from "lucide-react";
import { TID_V4_COMPOSER_CUA_ENTRY } from "@origin-ai/cf-shared/test-ids";
import { Button } from "@/components/ui/button.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { useOptionalPlatform } from "@/hooks/usePlatform.js";
import { useOptionalServices } from "@/hooks/useServices.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import {
  supportsLocalMacCuaPermissionOnboarding,
  supportsLocalWindowsCuaEntry,
} from "@/lib/cuaPlatform.js";
import {
  useCuaComposerEntry,
  type UseCuaComposerEntryParams,
} from "@/hooks/useCuaComposerEntry.js";

export type V4ComposerCuaEntryProps = UseCuaComposerEntryParams;

function V4ComposerCuaEntryImpl(props: V4ComposerCuaEntryProps) {
  const platform = useOptionalPlatform();
  const services = useOptionalServices();
  const platformSupported =
    platform !== null &&
    services !== null &&
    (supportsLocalMacCuaPermissionOnboarding(platform) || supportsLocalWindowsCuaEntry(platform));
  if (!platformSupported) return null;
  return <V4ComposerCuaEntryMounted {...props} />;
}

function V4ComposerCuaEntryMounted(props: V4ComposerCuaEntryProps) {
  const { intl } = useCfIntl();
  const { view, onActivate } = useCuaComposerEntry(props);
  const label = intl.formatMessage({ id: "chat.toolbar.computerUse.label" });

  if (!view.visible) return null;
  const tooltip = intl.formatMessage({ id: view.tooltipMessageId });

  return (
    <ControlHintTooltip title={tooltip}>
      <Button
        type="button"
        variant="ghost"
        size="default"
        data-testid={TID_V4_COMPOSER_CUA_ENTRY}
        data-composer-collapse-priority="0"
        data-cua-state={view.uiState}
        data-cua-interaction-disabled={view.interactionDisabled ? "true" : "false"}
        aria-label={label}
        aria-disabled={view.interactionDisabled || undefined}
        onClick={view.clickAction === "open-settings" ? onActivate : undefined}
        className={
          "group/cua h-7 w-fit justify-center gap-1 rounded-lg px-1.5 py-1.5 text-ui-base data-[composer-compact=true]:size-7 data-[composer-compact=true]:gap-0 data-[composer-compact=true]:p-0 " +
          (view.interactionDisabled ? "opacity-50" : "")
        }
      >
        <MonitorCogIcon className="size-4 shrink-0" aria-hidden />
        <span
          className="inline-flex whitespace-nowrap group-data-[composer-compact=true]/cua:hidden"
          data-cua-label
        >
          {label}
        </span>
        {}
      </Button>
    </ControlHintTooltip>
  );
}

export const V4ComposerCuaEntry = memo(V4ComposerCuaEntryImpl);
