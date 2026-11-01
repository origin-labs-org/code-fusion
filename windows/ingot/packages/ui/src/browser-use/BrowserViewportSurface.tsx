import { useCallback, type RefObject } from "react";
import { BROWSER_VIEW_RESTORE_BOOTSTRAP_URL, type BrowserViewportSize } from "@origin-ai/cf-shared";
import { TID_BROWSER_WEBVIEW } from "@origin-ai/cf-shared/test-ids";
import { TriangleAlertIcon } from "lucide-react";
import { ResponsiveBrowserViewport } from "@/browser-use/ResponsiveBrowserViewport.js";
import {
  resolveResponsiveBrowserGuestLayout,
  type BrowserViewportZoom,
} from "@/browser-use/browserViewportZoom.js";
import { cn } from "@/components/lib/utils.js";
import {
  BrowserEmptyState,
  BrowserGuestFailureState,
  BrowserLoadErrorState,
} from "@/EmbeddedBrowserPaneParts.js";
import {
  DEFAULT_BROWSER_URL,
  isCertificateBrowserLoadErrorCode,
  type BrowserState,
} from "@/embeddedBrowserHelpers.js";

export function BrowserViewportSurface({
  browserRegionRef,
  browserState,
  desktopZoomFactor,
  isResidencyRestore,
  formatMessage,
  isEmptyBrowserState,
  isComposed,
  isResponsiveMode,
  isViewportEmulated = isResponsiveMode,
  onRetryGuest,
  onRetryLoad,
  onViewportResize,
  onViewportSizeChange,
  onWebviewRef,
  shouldMountWebview = true,
  showResizeWarning,
  webviewGeneration,
  viewportSize,
  viewportZoom,
}: {
  browserRegionRef: RefObject<HTMLDivElement | null>;
  browserState: BrowserState;
  desktopZoomFactor: number;
  isResidencyRestore: boolean;
  formatMessage: (descriptor: { id: string }, values?: Record<string, number | string>) => string;
  isEmptyBrowserState: boolean;
  isComposed: boolean;
  isResponsiveMode: boolean;
  isViewportEmulated?: boolean;
  onRetryGuest: () => void;
  onRetryLoad: () => void;
  onViewportResize: () => void;
  onViewportSizeChange: (viewportSize: BrowserViewportSize) => void;
  onWebviewRef: (node: ElectronWebviewTag | null) => void;
  shouldMountWebview?: boolean;
  showResizeWarning: boolean;
  webviewGeneration: number;
  viewportSize: BrowserViewportSize;
  viewportZoom: BrowserViewportZoom;
}): React.JSX.Element {
  const { guestFailure } = browserState;
  const loadError = !guestFailure && browserState.errorMessage ? browserState.errorMessage : null;
  const responsiveGuestLayout = resolveResponsiveBrowserGuestLayout(desktopZoomFactor);
  const responsiveGuestLayoutScale = isViewportEmulated ? responsiveGuestLayout.layoutScale : 1;
  const responsiveGuestTransformScale = isViewportEmulated
    ? responsiveGuestLayout.transformScale
    : 1;
  const needsResponsiveGuestLayout = isResponsiveMode && responsiveGuestLayoutScale !== 1;
  const responsiveGuestLayoutSize = `calc(100% * ${responsiveGuestLayoutScale})`;
  const handleWebviewRef = useCallback(
    (node: ElectronWebviewTag | null) => {
      onWebviewRef(node);
    },
    [onWebviewRef],
  );

  return (
    <div
      ref={browserRegionRef}
      className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-background"
    >
      {showResizeWarning ? (
        <div
          role="status"
          aria-live="polite"
          data-browser-resize-warning="visible"
          className="pointer-events-none absolute top-2 right-2 left-2 z-20 mx-auto flex w-fit max-w-full items-center gap-2 rounded-xl border border-popover-border bg-popover px-3 py-2 text-ui-base font-medium text-foreground shadow-md"
        >
          <span
            aria-hidden="true"
            data-browser-resize-warning-accent="visible"
            className="h-5 w-0.5 shrink-0 rounded-full bg-warning"
          />
          <TriangleAlertIcon aria-hidden="true" className="size-4 shrink-0 text-warning" />
          <span>{formatMessage({ id: "browser.resizeDuringOperationWarning" })}</span>
        </div>
      ) : null}
      <ResponsiveBrowserViewport
        active={isResponsiveMode}
        desktopZoomFactor={desktopZoomFactor}
        isComposed={isComposed}
        onResize={onViewportResize}
        onViewportSizeChange={onViewportSizeChange}
        viewportSize={viewportSize}
        zoom={viewportZoom}
      >
        {guestFailure ? (
          <BrowserGuestFailureState
            formatMessage={formatMessage}
            guestFailure={guestFailure}
            onRetry={onRetryGuest}
          />
        ) : loadError ? (
          <BrowserLoadErrorState
            errorMessage={loadError}
            formatMessage={formatMessage}
            isCertificateError={isCertificateBrowserLoadErrorCode(browserState.loadErrorCode)}
            onRetry={onRetryLoad}
          />
        ) : isEmptyBrowserState ? (
          <BrowserEmptyState
            key="empty-state"
            browserState={browserState}
            formatMessage={formatMessage}
            isGuestStarting={shouldMountWebview && !browserState.isReady}
          />
        ) : null}
        {}
        {shouldMountWebview ? (
          <webview
            key={`webview:${webviewGeneration}`}
            ref={handleWebviewRef}
            allowpopups={"" as unknown as boolean}
            src={isResidencyRestore ? BROWSER_VIEW_RESTORE_BOOTSTRAP_URL : DEFAULT_BROWSER_URL}
            partition="persist:cf-embedded-browser"
            nodeintegrationinsubframes="true"
            data-browser-compositor-scale={isResponsiveMode ? desktopZoomFactor : undefined}
            data-browser-layout-scale={isResponsiveMode ? responsiveGuestLayoutScale : undefined}
            data-browser-transform-scale={
              isResponsiveMode ? responsiveGuestTransformScale : undefined
            }
            data-testid={TID_BROWSER_WEBVIEW}
            data-browser-resize-dimmed={showResizeWarning ? "true" : undefined}
            className={cn(
              "browser-use-viewport h-full min-h-0 w-full",
              isEmptyBrowserState || guestFailure || loadError ? "hidden" : "inline-flex",
            )}
            style={{
              backgroundColor: "#fff",
              ...(isEmptyBrowserState ? { visibility: "hidden" as const } : {}),
              ...(isResponsiveMode
                ? {
                    ...(needsResponsiveGuestLayout
                      ? {
                          height: responsiveGuestLayoutSize,
                          left: 0,
                          position: "absolute" as const,
                          top: 0,
                          width: responsiveGuestLayoutSize,
                        }
                      : {}),
                    ...(responsiveGuestTransformScale !== 1
                      ? {
                          transform: `scale(${responsiveGuestTransformScale})`,
                          transformOrigin: "top left",
                        }
                      : {}),
                  }
                : {}),
            }}
          />
        ) : null}
      </ResponsiveBrowserViewport>
    </div>
  );
}
