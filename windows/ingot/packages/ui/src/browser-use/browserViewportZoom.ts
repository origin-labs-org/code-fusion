import {
  BROWSER_VIEWPORT_ZOOM_OPTIONS,
  DEFAULT_BROWSER_VIEWPORT_ZOOM,
  type BrowserViewportSize,
  type BrowserViewportZoom,
} from "@origin-ai/cf-shared";

export { BROWSER_VIEWPORT_ZOOM_OPTIONS, DEFAULT_BROWSER_VIEWPORT_ZOOM };
export type { BrowserViewportZoom };

export const RESPONSIVE_BROWSER_CANVAS_PADDING_PX = 16;

export function resolveBrowserViewportScale({
  canvasSize,
  desktopZoomFactor = 1,
  viewportSize,
  zoom,
}: {
  canvasSize: BrowserViewportSize | null;
  desktopZoomFactor?: number;
  viewportSize: BrowserViewportSize;
  zoom: BrowserViewportZoom;
}): number {
  if (zoom !== "fit") {
    return Number(zoom) / 100;
  }
  if (!canvasSize || canvasSize.width <= 0 || canvasSize.height <= 0) {
    return 1;
  }

  const safeDesktopZoomFactor =
    Number.isFinite(desktopZoomFactor) && desktopZoomFactor > 0 ? desktopZoomFactor : 1;
  const availableWidth =
    Math.max(0, canvasSize.width - RESPONSIVE_BROWSER_CANVAS_PADDING_PX * 2) *
    safeDesktopZoomFactor;
  const availableHeight =
    Math.max(0, canvasSize.height - RESPONSIVE_BROWSER_CANVAS_PADDING_PX * 2) *
    safeDesktopZoomFactor;
  if (availableWidth === 0 || availableHeight === 0) {
    return 1;
  }

  return Math.min(1, availableWidth / viewportSize.width, availableHeight / viewportSize.height);
}

export function resolveBrowserViewportRendererScale({
  desktopZoomFactor,
  visualScale,
}: {
  desktopZoomFactor: number;
  visualScale: number;
}): number {
  const safeDesktopZoomFactor =
    Number.isFinite(desktopZoomFactor) && desktopZoomFactor > 0 ? desktopZoomFactor : 1;
  return visualScale / safeDesktopZoomFactor;
}

export function resolveResponsiveBrowserGuestLayout(desktopZoomFactor: number): {
  layoutScale: number;
  transformScale: number;
} {
  const safeDesktopZoomFactor =
    Number.isFinite(desktopZoomFactor) && desktopZoomFactor > 0 ? desktopZoomFactor : 1;

  return {
    layoutScale: 1 / safeDesktopZoomFactor,
    transformScale: safeDesktopZoomFactor,
  };
}
