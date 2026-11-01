import { useEffect } from "react";
import {
  BROWSER_SCREENSHOT_SURFACE_PREPARE_TIMEOUT_MS,
  type BrowserViewportSize,
  type BrowserViewScreenshotSurfacePreparePayload,
} from "@origin-ai/cf-shared";
import { safeWebviewCall } from "@/embeddedBrowserHelpers.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { logger } from "@/logger.js";

function roundViewport(width: number, height: number): BrowserViewportSize | null {
  const viewport = { width: Math.round(width), height: Math.round(height) };
  return viewport.width > 0 && viewport.height > 0 ? viewport : null;
}

function withinOnePixel(left: BrowserViewportSize, right: BrowserViewportSize): boolean {
  return Math.abs(left.width - right.width) <= 1 && Math.abs(left.height - right.height) <= 1;
}

const SURFACE_SCALE_EPSILON = 0.001;

//
//
const SURFACE_VERIFY_FALLBACK_MS = 100;
const SURFACE_VERIFY_RELEASE_GRACE_MS = 1_000;

function resolveSurfacePrepareTimeoutMs(timeoutMs: number | undefined): number {
  return typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : BROWSER_SCREENSHOT_SURFACE_PREPARE_TIMEOUT_MS;
}

interface StableScreenshotSurface {
  surfaceScale: number;
  viewport: BrowserViewportSize;
}

function readBrowserLayoutScale(webview: ElectronWebviewTag): number {
  const layoutScale = Number(webview.dataset.browserLayoutScale);
  return Number.isFinite(layoutScale) && layoutScale > 0 ? layoutScale : 1;
}

function readSurfaceScale(webview: ElectronWebviewTag): number {
  const responsiveViewport = webview.closest<HTMLElement>("[data-responsive-scale]");
  const surfaceScale = Number(responsiveViewport?.dataset.responsiveScale);
  return Number.isFinite(surfaceScale) && surfaceScale > 0 ? surfaceScale : 1;
}

function sameSurface(left: StableScreenshotSurface, right: StableScreenshotSurface): boolean {
  return (
    withinOnePixel(left.viewport, right.viewport) &&
    Math.abs(left.surfaceScale - right.surfaceScale) <= SURFACE_SCALE_EPSILON
  );
}

function readSurfaceViewport(
  webview: ElectronWebviewTag,
  expected: BrowserViewportSize,
): BrowserViewportSize | null {
  const rect = webview.getBoundingClientRect();
  const transformed = roundViewport(rect.width, rect.height);
  const layoutScale = readBrowserLayoutScale(webview);
  const layout = roundViewport(
    webview.offsetWidth / layoutScale,
    webview.offsetHeight / layoutScale,
  );
  if (transformed && withinOnePixel(transformed, expected)) return transformed;
  if (layout && withinOnePixel(layout, expected)) return layout;
  return transformed ?? layout;
}

export function useBrowserScreenshotSurfaceReady({
  request,
  webview,
}: {
  request: BrowserViewScreenshotSurfacePreparePayload | null;
  webview: ElectronWebviewTag | null;
}): void {
  const platform = usePlatform();

  useEffect(() => {
    logger.debug("[browser-use] 截图 surface ready effect", {
      requestId: request?.requestId,
      tabId: request?.tabId,
      hasWebview: Boolean(webview),
      hasResizeObserver: typeof ResizeObserver !== "undefined",
    });
    if (!request || !webview || typeof ResizeObserver === "undefined") {
      logger.debug("[browser-use] Screenshot surface ready not starting yet", {
        requestId: request?.requestId,
        tabId: request?.tabId,
        hasWebview: Boolean(webview),
        hasResizeObserver: typeof ResizeObserver !== "undefined",
      });
      return;
    }

    const activeRequest = request;
    const activeWebview = webview;

    let disposed = false;
    let reported = false;
    let firstFrame: StableScreenshotSurface | null = null;
    let rafId: number | null = null;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    let mismatchLogged = false;
    let verificationVersion = 0;
    const prepareTimeoutMs = resolveSurfacePrepareTimeoutMs(activeRequest.timeoutMs);
    const verifyDeadlineMs = prepareTimeoutMs + SURFACE_VERIFY_RELEASE_GRACE_MS;
    const deadline = Date.now() + verifyDeadlineMs;
    const cancelPendingVerification = () => {
      verificationVersion += 1;
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (fallbackTimer !== null) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
    };
    function verify(): void {
      if (disposed || reported) return;
      cancelPendingVerification();
      const version = verificationVersion;
      const run = () => {
        if (disposed || reported || version !== verificationVersion) return;
        cancelPendingVerification();
        runVerification();
      };
      rafId = window.requestAnimationFrame(run);
      fallbackTimer = setTimeout(run, SURFACE_VERIFY_FALLBACK_MS);
    }
    function retry(): void {
      if (Date.now() >= deadline) {
        logger.warn("[browser-use] Screenshot surface wait timed out, stopping retries", {
          requestId: activeRequest.requestId,
          tabId: activeRequest.tabId,
          expectedViewport: activeRequest.viewport,
          prepareTimeoutMs,
          verifyDeadlineMs,
        });
        return;
      }
      verify();
    }
    function runVerification(): void {
      const guestId = safeWebviewCall(() => activeWebview.getWebContentsId(), 0);
      if (guestId !== activeRequest.webContentsId) {
        logger.debug("[browser-use] 截图 surface 等待当前 guest", {
          requestId: activeRequest.requestId,
          expectedGuestId: activeRequest.webContentsId,
          guestId,
        });
        retry();
        return;
      }
      const viewport = readSurfaceViewport(activeWebview, activeRequest.viewport);
      if (!viewport || !withinOnePixel(viewport, activeRequest.viewport)) {
        if (!mismatchLogged) {
          mismatchLogged = true;
          logger.debug("[browser-use] 截图 surface viewport 尚未对齐", {
            requestId: activeRequest.requestId,
            expectedViewport: activeRequest.viewport,
            viewport,
          });
        }
        retry();
        return;
      }
      const current = { surfaceScale: readSurfaceScale(activeWebview), viewport };
      if (!firstFrame || !sameSurface(firstFrame, current)) {
        firstFrame = current;
        retry();
        return;
      }
      if (disposed) return;
      logger.debug("[browser-use] Screenshot surface is stable", {
        requestId: activeRequest.requestId,
        tabId: activeRequest.tabId,
        surfaceScale: current.surfaceScale,
        viewport: current.viewport,
      });
      reported = true;
      platform.browserViewScreenshotSurfaceReady?.({
        ...activeRequest,
        surfaceScale: current.surfaceScale,
        viewport: current.viewport,
      });
    }
    function restartVerification(): void {
      if (disposed || reported) return;
      firstFrame = null;
      mismatchLogged = false;
      cancelPendingVerification();
      verify();
    }
    const observer = new ResizeObserver(() => {
      restartVerification();
    });
    const handleDomReady = () => {
      restartVerification();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      restartVerification();
    };
    observer.observe(activeWebview);
    activeWebview.addEventListener("dom-ready", handleDomReady);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    verify();
    return () => {
      disposed = true;
      observer.disconnect();
      activeWebview.removeEventListener("dom-ready", handleDomReady);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      cancelPendingVerification();
    };
  }, [platform, request, webview]);
}
