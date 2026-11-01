

type ExpiryClockWindow = Pick<
  Window & typeof globalThis,
  "setTimeout" | "clearTimeout" | "addEventListener" | "removeEventListener"
>;

type ExpiryClockDocument = Pick<
  Document,
  "visibilityState" | "addEventListener" | "removeEventListener"
>;

export interface HighspeedFooterExpiryClockDeps {
  windowTarget?: ExpiryClockWindow;
  documentTarget?: ExpiryClockDocument;
  now?: () => number;
}

export function armHighspeedFooterExpiryClock(
  nextExpiryMs: number,
  onExpire: () => void,
  deps: HighspeedFooterExpiryClockDeps = {},
): () => void {
  const windowTarget = deps.windowTarget ?? window;
  const documentTarget = deps.documentTarget ?? document;
  const now = deps.now ?? Date.now;

  const delayMs = Math.max(0, nextExpiryMs - now()) + 20;
  const timer = windowTarget.setTimeout(onExpire, delayMs);

  const catchUpFromWindowWake = () => {
    if (documentTarget.visibilityState === "hidden") return;
    onExpire();
  };
  documentTarget.addEventListener("visibilitychange", catchUpFromWindowWake);
  windowTarget.addEventListener("focus", catchUpFromWindowWake);

  return () => {
    windowTarget.clearTimeout(timer);
    documentTarget.removeEventListener("visibilitychange", catchUpFromWindowWake);
    windowTarget.removeEventListener("focus", catchUpFromWindowWake);
  };
}
