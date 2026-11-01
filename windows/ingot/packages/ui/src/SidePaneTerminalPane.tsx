import { useCallback } from "react";
import type { IServiceAccessor } from "@origin-ai/cf-services";
import { TerminalSession } from "@/terminal/TerminalSession.js";

export function SidePaneTerminalPane({
  services,
  sessionId,
  workspaceKey,
  cwd,
  isVisible,
  isWindowsDesktop = false,
  onOpenBrowserUrl,
}: {
  services: IServiceAccessor;
  
  sessionId: string;
  
  workspaceKey?: string;
  cwd?: string;
  isVisible: boolean;
  isWindowsDesktop?: boolean;
  onOpenBrowserUrl: (url: string) => void;
}) {
  const handleShellLabelChange = useCallback(() => {
  }, []);

  return (
    <section className="h-full min-h-0 overflow-hidden bg-background p-3">
      <TerminalSession
        sessionId={sessionId}
        persistentKey={sessionId}
        workspaceKey={workspaceKey}
        services={services}
        cwd={cwd}
        isVisible={isVisible}
        isWindowsDesktop={isWindowsDesktop}
        onShellLabelChange={handleShellLabelChange}
        onOpenBrowserUrl={onOpenBrowserUrl}
      />
    </section>
  );
}
