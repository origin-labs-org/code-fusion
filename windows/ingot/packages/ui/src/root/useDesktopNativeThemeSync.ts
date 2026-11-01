import { useEffect } from "react";
import type { IPlatformService } from "@origin-ai/cf-shared";
import { logger } from "@/logger.js";
import { resolveTheme, type Theme } from "@/useTheme.js";

export function useDesktopNativeThemeSync({
  enabled,
  isDesktop,
  platform,
  theme,
}: {
  enabled: boolean;
  isDesktop?: boolean;
  platform: IPlatformService;
  theme: Theme;
}) {
  useEffect(() => {
    if (!enabled || !isDesktop) {
      return;
    }

    let disposed = false;
    const titleBarTheme = theme === "system" ? "system" : resolveTheme(theme);

    platform.setTitleBarTheme(titleBarTheme).catch((error) => {
      if (disposed) {
        return;
      }
      logger.error("[Root] 同步标题栏主题失败", { titleBarTheme, error });
    });

    return () => {
      disposed = true;
    };
  }, [enabled, isDesktop, platform, theme]);
}
