import type { WebContents } from "electron";

export const ARMS_BROWSER_PERF_LOAD_NUDGE_SCRIPT = `(function () {
  function dispatchLoad() {
    try {
      window.dispatchEvent(new Event("load"));
    } catch (e) {}
  }
  function tryNudge(attempt) {
    if (typeof window.RumSDK !== "undefined" && window.RumSDK.default) {
      if (document.readyState === "complete") {
        dispatchLoad();
      }
      return;
    }
    if (attempt < 80) {
      setTimeout(function () {
        tryNudge(attempt + 1);
      }, 25);
    }
  }
  if (document.readyState === "complete") {
    tryNudge(0);
  } else {
    window.addEventListener(
      "load",
      function () {
        tryNudge(0);
      },
      { once: true }
    );
  }
})();`;

export function scheduleArmsBrowserPerfLoadNudge(webContents: WebContents): void {
  const nudge = (): void => {
    if (webContents.isDestroyed()) {
      return;
    }
    void webContents.executeJavaScript(ARMS_BROWSER_PERF_LOAD_NUDGE_SCRIPT, true).catch(() => {
    });
  };

  webContents.on("did-finish-load", nudge);
  webContents.on("dom-ready", () => {
    setTimeout(nudge, 0);
    setTimeout(nudge, 150);
  });
}
