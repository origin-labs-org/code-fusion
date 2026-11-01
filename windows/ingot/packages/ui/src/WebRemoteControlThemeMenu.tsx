import { Palette } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { useCfStore } from "@/store/StoreProvider.js";
import type { Theme } from "@/useTheme.js";

const MOBILE_THEME_OPTIONS: Theme[] = [
  "system",
  "cf-dark",
  "cf-light",
];

export function WebRemoteControlThemeMenu() {
  const { intl } = useCfIntl();
  const theme = useCfStore((state) => state.theme);
  const setTheme = useCfStore((state) => state.setTheme);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={intl.formatMessage({ id: "webRemoteControl.themeMenu.trigger" })}
        >
          <Palette className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(value) => {
            if (MOBILE_THEME_OPTIONS.includes(value as Theme)) {
              setTheme(value as Theme);
            }
          }}
        >
          {MOBILE_THEME_OPTIONS.map((option) => (
            <DropdownMenuRadioItem key={option} value={option}>
              {option === "system"
                ? intl.formatMessage({ id: "sidebar.settings.systemDefault" })
                : intl.formatMessage({ id: `sidebar.settings.theme.${option}` })}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
