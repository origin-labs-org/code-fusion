import { useEffect, type RefObject } from "react";
import {
  EmbeddedBrowserWebviewChannels,
  type EmbeddedBrowserWheelBoundaryPayload,
} from "@origin-ai/cf-shared";
import { logger } from "@/logger.js";

function validatedDelta(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function useEmbeddedBrowserWheelChain({
  browserRegionRef,
  isResponsiveMode,
  webview,
}: {
  browserRegionRef: RefObject<HTMLDivElement | null>;
  isResponsiveMode: boolean;
  webview: ElectronWebviewTag | null;
}): void {
  useEffect(() => {
    if (!webview) return;

    const handleGuestIpcMessage = (event: ElectronWebviewIpcMessageEvent): void => {
      if (!isResponsiveMode || event.channel !== EmbeddedBrowserWebviewChannels.WheelBoundary) {
        return;
      }
      const payload = event.args[0] as Partial<EmbeddedBrowserWheelBoundaryPayload> | undefined;
      const deltaX = validatedDelta(payload?.deltaX);
      const deltaY = validatedDelta(payload?.deltaY);
      if (deltaX === 0 && deltaY === 0) return;

      const responsiveCanvas = browserRegionRef.current?.querySelector<HTMLElement>(
        '[data-responsive-browser-mode="active"]',
      );
      if (!responsiveCanvas) return;
      responsiveCanvas.scrollBy({ behavior: "auto", left: deltaX, top: deltaY });
      logger.debug("[browser-use] guest wheel continues free-size canvas", {
        deltaX,
        deltaY,
        scrollLeft: responsiveCanvas.scrollLeft,
        scrollTop: responsiveCanvas.scrollTop,
      });
    };

    webview.addEventListener("ipc-message", handleGuestIpcMessage);
    return () => webview.removeEventListener("ipc-message", handleGuestIpcMessage);
  }, [browserRegionRef, isResponsiveMode, webview]);
}
