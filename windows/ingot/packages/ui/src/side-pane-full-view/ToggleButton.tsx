import { Maximize2Icon, Minimize2Icon } from "lucide-react";
import { TID_SIDE_PANE_FULL_VIEW_TOGGLE } from "@origin-ai/cf-shared/test-ids";
import { cn } from "@/components/lib/utils.js";
import { Button } from "@/components/ui/button.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";

export function SidePaneFullViewToggleButton({
  active,
  onToggle,
  shortcutLabel,
}: {
  active: boolean;
  onToggle: () => void;
  shortcutLabel?: string;
}) {
  const { intl } = useCfIntl();
  const label = intl.formatMessage({
    id: active ? "sidePane.fullView.exit" : "sidePane.fullView.enter",
  });
  const Icon = active ? Minimize2Icon : Maximize2Icon;
  return (
    <ControlHintTooltip title={label} side="bottom" align="end" shortcut={shortcutLabel}>
      <Button
        type="button"
        variant="ghost"
        size="icon-md"
        data-testid={TID_SIDE_PANE_FULL_VIEW_TOGGLE}
        data-active={active ? "true" : "false"}
        aria-label={label}
        aria-pressed={active}
        className={cn("text-foreground hover:bg-hover hover:text-foreground [app-region:no-drag]")}
        onClick={onToggle}
      >
        <Icon className="size-4" />
      </Button>
    </ControlHintTooltip>
  );
}
