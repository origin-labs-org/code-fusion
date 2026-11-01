import type { BrowserViewScreenshotSurfacePreparePayload } from "@origin-ai/cf-shared";
import type { CSSProperties } from "react";
import { UnifiedBrowserView } from "@/browser-use/UnifiedBrowserView.js";
import { cn } from "@/components/lib/utils.js";
import { TabsContent } from "@/components/ui/tabs.js";
import type { BrowserSidePaneMetadata, BrowserUseSidePaneTab } from "@/lib/workspaceSidePane.js";

export interface BrowserUseSidePaneContentProps {
  tab: BrowserUseSidePaneTab;
  onOpenPermissionSettings?: (origin: string) => void;
  isPanelVisible: boolean;
  isSelected: boolean;
  isCurrentTask: boolean;
  screenshotSurfaceRequest: BrowserViewScreenshotSurfacePreparePayload | null;
  initialUrl?: string;
  workspacePath: string;
  workspaceIdentity?: string;
  residencyGeneration?: number;
  onUrlChange(url: string): void;
  onPageMetadataChange(metadata: BrowserSidePaneMetadata): void;
}

export function BrowserUseSidePaneContent({
  tab,
  onOpenPermissionSettings,
  isPanelVisible,
  isSelected,
  isCurrentTask,
  screenshotSurfaceRequest,
  initialUrl,
  workspacePath,
  workspaceIdentity,
  residencyGeneration,
  onUrlChange,
  onPageMetadataChange,
}: BrowserUseSidePaneContentProps): React.JSX.Element {
  const screenshotSurfaceStyle: CSSProperties | undefined = screenshotSurfaceRequest
    ? {
        position: "fixed",
        left: 0,
        top: 0,
        width: `${screenshotSurfaceRequest.viewport.width}px`,
        height: `${screenshotSurfaceRequest.viewport.height + 48}px`,
        maxWidth: screenshotSurfaceRequest.surfaceScaleMode === "unscaled" ? undefined : "100vw",
        maxHeight: screenshotSurfaceRequest.surfaceScaleMode === "unscaled" ? undefined : "100vh",
        pointerEvents: "none",
        opacity: 0.001,
      }
    : undefined;

  return (
    <TabsContent
      value={tab.id}
      forceMount
      aria-hidden={!isSelected}
      inert={!isSelected ? true : undefined}
      data-browser-use-tab-id={tab.tabId}
      data-browser-screenshot-surface-state={screenshotSurfaceRequest ? "preparing" : undefined}
      className={cn(
        "h-full min-h-0 bg-background",
        isSelected
          ? "relative z-10 flex"
          : screenshotSurfaceRequest
            ? "pointer-events-none fixed z-0 flex overflow-hidden"
            : "hidden",
      )}
      style={screenshotSurfaceStyle}
    >
      <UnifiedBrowserView
        browserKey={tab.tabId}
        onOpenPermissionSettings={onOpenPermissionSettings}
        isResidencyRestore={tab.residency === "restoring"}
        isVisible={isPanelVisible && isSelected}
        isSelected={isSelected}
        isCurrentTask={isCurrentTask}
        screenshotSurfaceRequest={screenshotSurfaceRequest}
        initialUrl={initialUrl}
        faviconUrl={tab.faviconUrl}
        workspacePath={workspacePath}
        workspaceIdentity={workspaceIdentity}
        workspaceKey={tab.workspaceKey ?? (workspaceIdentity?.trim() || workspacePath)}
        remoteSessionId={tab.remoteSessionId ?? undefined}
        sessionId={tab.sessionId}
        residencyGeneration={tab.residencyGeneration ?? residencyGeneration}
        browserUseOperationUntil={tab.browserUseOperationUntil}
        browserResizeBaselineVersion={tab.browserUseResizeBaselineVersion}
        onUrlChange={onUrlChange}
        onPageMetadataChange={onPageMetadataChange}
      />
    </TabsContent>
  );
}
