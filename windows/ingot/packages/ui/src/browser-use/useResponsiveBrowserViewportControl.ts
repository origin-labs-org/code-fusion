import { useCallback, useEffect, useRef, useState } from "react";
import type {
  BrowserViewportSize,
  BrowserViewportZoom,
  EmbeddedBrowserViewportPreference,
} from "@origin-ai/cf-shared";
import { DEFAULT_BROWSER_VIEWPORT_ZOOM } from "@/browser-use/browserViewportZoom.js";
import { DEFAULT_RESPONSIVE_BROWSER_VIEWPORT_SIZE } from "@/browser-use/ResponsiveBrowserViewport.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { logger } from "@/logger.js";

export type HumanBrowserViewportPreferenceChangeSource = "mode" | "viewport" | "zoom";

export function useResponsiveBrowserViewportControl({
  browserKey,
  desktopZoomFactor,
  onAgentViewportChange,
  onViewportSynchronized,
  onViewportResize,
  initialHumanViewportPreference,
  onHumanViewportPreferenceChange,
  sessionId,
}: {
  browserKey: string;
  desktopZoomFactor: number;
  onAgentViewportChange: (willChangeResponsiveMode: boolean) => void;
  onViewportSynchronized: () => void;
  onViewportResize: () => void;
  initialHumanViewportPreference?: EmbeddedBrowserViewportPreference;
  onHumanViewportPreferenceChange?: (
    preference: EmbeddedBrowserViewportPreference,
    source: HumanBrowserViewportPreferenceChangeSource,
  ) => void;
  sessionId?: string;
}) {
  const platform = usePlatform();
  const initialResponsiveMode = initialHumanViewportPreference?.mode === "responsive";
  const initialResponsiveViewportSize =
    initialHumanViewportPreference?.viewport ?? DEFAULT_RESPONSIVE_BROWSER_VIEWPORT_SIZE;
  const initialResponsiveViewportZoom =
    initialHumanViewportPreference?.zoom ?? DEFAULT_BROWSER_VIEWPORT_ZOOM;
  const [isResponsiveMode, setIsResponsiveMode] = useState(initialResponsiveMode);
  const [responsiveViewportSize, setResponsiveViewportSize] = useState<BrowserViewportSize>({
    ...initialResponsiveViewportSize,
  });
  const [responsiveViewportZoom, setResponsiveViewportZoom] = useState<BrowserViewportZoom>(
    initialResponsiveViewportZoom,
  );
  const isResponsiveModeRef = useRef(initialResponsiveMode);
  const responsiveViewportSizeRef = useRef<BrowserViewportSize>({
    ...initialResponsiveViewportSize,
  });
  const responsiveViewportZoomRef = useRef<BrowserViewportZoom>(initialResponsiveViewportZoom);
  const didSynchronizeInitialHumanViewportRef = useRef(false);
  const lastDesktopZoomFactorRef = useRef(desktopZoomFactor);
  const wasResponsiveModeForZoomRef = useRef(initialResponsiveMode);

  const reportHumanViewportPreference = useCallback(
    (source: HumanBrowserViewportPreferenceChangeSource) => {
      if (!initialHumanViewportPreference || !onHumanViewportPreferenceChange) return;
      onHumanViewportPreferenceChange(
        {
          mode: isResponsiveModeRef.current ? "responsive" : "normal",
          viewport: { ...responsiveViewportSizeRef.current },
          zoom: responsiveViewportZoomRef.current,
        },
        source,
      );
    },
    [initialHumanViewportPreference, onHumanViewportPreferenceChange],
  );

  const applyResponsiveMode = useCallback((nextMode: boolean) => {
    if (nextMode && !isResponsiveModeRef.current) {
      responsiveViewportZoomRef.current = DEFAULT_BROWSER_VIEWPORT_ZOOM;
      setResponsiveViewportZoom(DEFAULT_BROWSER_VIEWPORT_ZOOM);
    }
    isResponsiveModeRef.current = nextMode;
    setIsResponsiveMode(nextMode);
  }, []);

  const updateControlledViewport = useCallback(
    (viewport: BrowserViewportSize | null) => {
      const request = platform.browserViewUpdateViewport?.({ tabId: browserKey, viewport });
      if (!request) return;
      void request
        .then(() => {
          if (viewport) onViewportSynchronized();
        })
        .catch((error) => {
          logger.debug("[browser-use] 同步 tab viewport 失败", {
            error: error instanceof Error ? error.message : String(error),
          });
        });
    },
    [browserKey, onViewportSynchronized, platform],
  );

  useEffect(() => {
    const wasResponsiveMode = wasResponsiveModeForZoomRef.current;
    const zoomChanged = lastDesktopZoomFactorRef.current !== desktopZoomFactor;
    wasResponsiveModeForZoomRef.current = isResponsiveMode;
    lastDesktopZoomFactorRef.current = desktopZoomFactor;
    if (!isResponsiveMode || !wasResponsiveMode || !zoomChanged) return;
    updateControlledViewport(responsiveViewportSize);
  }, [desktopZoomFactor, isResponsiveMode, responsiveViewportSize, updateControlledViewport]);

  useEffect(() => {
    return platform.onBrowserViewViewportChanged?.((payload) => {
      if (payload.tabId !== browserKey) return;
      if (sessionId && payload.sessionId !== sessionId) return;
      const willChangeResponsiveMode = (payload.viewport !== null) !== isResponsiveModeRef.current;
      onAgentViewportChange(willChangeResponsiveMode);
      logger.debug("[browser-use] Model viewport change does not trigger subtle resize hint", {
        modeChanged: willChangeResponsiveMode,
        tabId: browserKey,
        viewport: payload.viewport,
      });
      if (payload.viewport) {
        responsiveViewportSizeRef.current = { ...payload.viewport };
        setResponsiveViewportSize({ ...payload.viewport });
        applyResponsiveMode(true);
        return;
      }
      applyResponsiveMode(false);
    });
  }, [applyResponsiveMode, browserKey, onAgentViewportChange, platform, sessionId]);

  const toggleResponsiveMode = useCallback(() => {
    onViewportResize();
    const nextMode = !isResponsiveModeRef.current;
    applyResponsiveMode(nextMode);
    updateControlledViewport(nextMode ? responsiveViewportSize : null);
    reportHumanViewportPreference("mode");
  }, [
    applyResponsiveMode,
    onViewportResize,
    reportHumanViewportPreference,
    responsiveViewportSize,
    updateControlledViewport,
  ]);

  const updateResponsiveViewportSize = useCallback(
    (viewportSize: BrowserViewportSize) => {
      responsiveViewportSizeRef.current = { ...viewportSize };
      setResponsiveViewportSize(viewportSize);
      updateControlledViewport(viewportSize);
      reportHumanViewportPreference("viewport");
    },
    [reportHumanViewportPreference, updateControlledViewport],
  );

  const updateResponsiveViewportZoom = useCallback(
    (zoom: BrowserViewportZoom) => {
      responsiveViewportZoomRef.current = zoom;
      setResponsiveViewportZoom(zoom);
      reportHumanViewportPreference("zoom");
    },
    [reportHumanViewportPreference],
  );

  const synchronizeInitialHumanViewport = useCallback(() => {
    if (
      !initialHumanViewportPreference ||
      initialHumanViewportPreference.mode !== "responsive" ||
      didSynchronizeInitialHumanViewportRef.current
    ) {
      return;
    }
    didSynchronizeInitialHumanViewportRef.current = true;
    updateControlledViewport(responsiveViewportSizeRef.current);
  }, [initialHumanViewportPreference, updateControlledViewport]);

  return {
    isResponsiveMode,
    responsiveViewportSize,
    responsiveViewportZoom,
    setResponsiveViewportZoom: updateResponsiveViewportZoom,
    synchronizeInitialHumanViewport,
    toggleResponsiveMode,
    updateResponsiveViewportSize,
  };
}
