import { memo, type ReactNode } from "react";
import { cn } from "@/components/lib/utils.js";

export const DesktopWindowFrame = memo(function DesktopWindowFrameComponent({
  title: _title,
  children,
  actions: _actions,
  tabBar: _tabBar,
  isDesktop = false,
  isMacDesktop = false,
  isWindowsDesktop = false,
  headerTestId: _headerTestId,
  showHeader: _showHeader = isDesktop,
}: {
  title: string;
  children: ReactNode;
  topBar?: ReactNode;
  actions?: ReactNode;
  
  tabBar?: ReactNode;
  isDesktop?: boolean;
  isMacDesktop?: boolean;
  isWindowsDesktop?: boolean;
  headerTestId?: string;
  showHeader?: boolean;
}) {
  const isLinuxDesktop = isDesktop && !isMacDesktop && !isWindowsDesktop;
  const usesOpaqueRootSurface = !isDesktop || isWindowsDesktop || isLinuxDesktop;

  return (
    <div
      className={cn(
        "flex h-dvh flex-col overflow-hidden border-border text-foreground",
        isLinuxDesktop &&
          "rounded-[16px] [clip-path:inset(0_round_16px)] platform-linux-window-maximized:rounded-none platform-linux-window-maximized:[clip-path:inset(0)]",
        usesOpaqueRootSurface ? "bg-background-win-alt" : "bg-background-alt",
      )}
      data-desktop-window-frame="true"
    >
      <div className="relative flex-1 min-h-0 w-full">{children}</div>
    </div>
  );
});
