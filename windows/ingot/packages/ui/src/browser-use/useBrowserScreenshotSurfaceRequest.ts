import { useEffect, useRef, useState } from "react";
import type {
  BrowserViewScreenshotSurfacePreparePayload,
  BrowserViewScreenshotSurfaceReleasePayload,
} from "@origin-ai/cf-shared";
import { usePlatform } from "@/hooks/usePlatform.js";
import type { BrowserUseSidePaneTab, WorkspaceSidePaneTab } from "@/lib/workspaceSidePane.js";
import { logger } from "@/logger.js";

function matchesTab(
  tab: BrowserUseSidePaneTab,
  payload: BrowserViewScreenshotSurfacePreparePayload,
): boolean {
  return (
    tab.workspaceKey === payload.workspaceKey &&
    tab.sessionId === payload.sessionId &&
    tab.browserId === payload.browserId &&
    tab.browserGeneration === payload.browserGeneration &&
    tab.tabId === payload.tabId
  );
}

function matchesTabLoose(
  tab: BrowserUseSidePaneTab,
  payload: BrowserViewScreenshotSurfacePreparePayload,
): boolean {
  return (
    tab.workspaceKey === payload.workspaceKey &&
    tab.sessionId === payload.sessionId &&
    tab.tabId === payload.tabId
  );
}

function matchesRequest(
  request: BrowserViewScreenshotSurfacePreparePayload,
  payload: BrowserViewScreenshotSurfaceReleasePayload,
): boolean {
  return (
    request.requestId === payload.requestId &&
    request.workspaceKey === payload.workspaceKey &&
    request.sessionId === payload.sessionId &&
    request.tabId === payload.tabId &&
    request.webContentsId === payload.webContentsId
  );
}

export function findScreenshotSurfaceTab(
  tabs: readonly WorkspaceSidePaneTab[],
  payload: BrowserViewScreenshotSurfacePreparePayload,
): BrowserUseSidePaneTab | undefined {
  return tabs.find(
    (tab): tab is BrowserUseSidePaneTab => tab.type === "browser-use" && matchesTab(tab, payload),
  );
}

export function findScreenshotSurfaceTabForRender(
  tabs: readonly WorkspaceSidePaneTab[],
  payload: BrowserViewScreenshotSurfacePreparePayload,
): BrowserUseSidePaneTab | undefined {
  return (
    findScreenshotSurfaceTab(tabs, payload) ??
    tabs.find(
      (tab): tab is BrowserUseSidePaneTab =>
        tab.type === "browser-use" && matchesTabLoose(tab, payload),
    )
  );
}

export function findScreenshotSurfaceTabForPrepare(
  tabs: readonly WorkspaceSidePaneTab[],
  payload: BrowserViewScreenshotSurfacePreparePayload,
): BrowserUseSidePaneTab | undefined {
  return findScreenshotSurfaceTabForRender(tabs, payload);
}

export function useBrowserScreenshotSurfaceRequest(
  tabs: readonly WorkspaceSidePaneTab[],
): BrowserViewScreenshotSurfacePreparePayload | null {
  const platform = usePlatform();
  const [request, setRequest] = useState<BrowserViewScreenshotSurfacePreparePayload | null>(null);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  useEffect(() => {
    const disposePrepare = platform.onBrowserViewScreenshotSurfacePrepare?.((payload) => {
      if (!findScreenshotSurfaceTabForPrepare(tabsRef.current, payload)) {
        logger.debug("[browser-use] 忽略非当前 renderer tab 的截图 surface prepare", {
          requestId: payload.requestId,
          tabId: payload.tabId,
        });
        return;
      }
      logger.debug("[browser-use] 接收截图 surface prepare", {
        requestId: payload.requestId,
        tabId: payload.tabId,
        webContentsId: payload.webContentsId,
      });
      setRequest((current) => {
        if (current && current.requestId !== payload.requestId) {
          logger.debug("[browser-use] Retaining screenshot surface request still preparing", {
            requestId: current.requestId,
            tabId: current.tabId,
          });
          return current;
        }
        return payload;
      });
    });
    const disposeRelease = platform.onBrowserViewScreenshotSurfaceRelease?.((payload) => {
      setRequest((current) => {
        if (!current || !matchesRequest(current, payload)) {
          return current;
        }
        return null;
      });
    });
    return () => {
      disposePrepare?.();
      disposeRelease?.();
    };
  }, [platform]);

  return request;
}
