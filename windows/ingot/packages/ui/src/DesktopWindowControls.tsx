import { useEffect, useState } from "react";
import { DesktopCommandIds } from "@origin-ai/cf-shared";
import { MinusIcon, XIcon } from "lucide-react";
import { WindowMaximizeIcon, WindowRestoreIcon } from "@/components/icons/windowIcons.js";
import { Button } from "@/components/ui/button.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";

export function DesktopWindowControls() {
  const platform = usePlatform();
  const { intl } = useCfIntl();
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    let disposed = false;
    let receivedEvent = false;
    const unsubscribe = platform.onDesktopWindowChromeStateChanged?.((state) => {
      receivedEvent = true;
      if (!disposed) setMaximized(state.isMaximized);
    });
    void platform
      .getDesktopWindowChromeState?.()
      .then((state) => {
        if (!disposed && !receivedEvent) setMaximized(state.isMaximized);
      })
      .catch((error) => logger.warn("Failed to read custom window button state", { error }));
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [platform]);
  const items = [
    {
      id: "minimize",
      label: "titleBar.window.minimize",
      command: DesktopCommandIds.MinimizeWindow,
      Icon: MinusIcon,
    },
    {
      id: "maximize",
      label: "titleBar.window.toggleMaximize",
      command: DesktopCommandIds.ToggleMaximizeWindow,
      Icon: maximized ? WindowRestoreIcon : WindowMaximizeIcon,
    },
    {
      id: "close",
      label: "titleBar.menu.file.closeWindow",
      command: DesktopCommandIds.CloseWindow,
      Icon: XIcon,
    },
  ] as const;
  return (
    <div
      data-testid="desktop-window-controls"
      className="flex shrink-0 items-center gap-0.5 [app-region:no-drag]"
    >
      {items.map(({ id, label, command, Icon }) => (
        <Button
          key={id}
          type="button"
          variant="ghost"
          size="icon-md"
          data-testid={`window-control-${id}`}
          data-maximized={id === "maximize" ? maximized : undefined}
          className={`text-foreground [app-region:no-drag] ${id === "close" ? "hover:bg-destructive hover:text-destructive-foreground" : "hover:bg-hover hover:text-foreground"}`}
          aria-label={intl.formatMessage({ id: label })}
          onClick={() => {
            void platform
              .executeDesktopCommand(command)
              .catch((error) => logger.warn("Failed to perform window action", { command, error }));
          }}
        >
          <Icon className="size-4" />
        </Button>
      ))}
    </div>
  );
}
