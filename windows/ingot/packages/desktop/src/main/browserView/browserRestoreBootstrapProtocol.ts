import { BROWSER_VIEW_RESTORE_BOOTSTRAP_URL } from "@origin-ai/cf-shared";

const RESPONSE_DELAY_MS = 60_000;
const installedProtocols = new WeakSet<object>();

interface BrowserRestoreProtocol {
  handle(scheme: string, handler: () => Promise<Response>): void;
}

export function installBrowserRestoreBootstrapProtocol(
  protocol: BrowserRestoreProtocol,
  responseDelayMs = RESPONSE_DELAY_MS,
): void {
  if (installedProtocols.has(protocol)) return;
  installedProtocols.add(protocol);
  const scheme = new URL(BROWSER_VIEW_RESTORE_BOOTSTRAP_URL).protocol.slice(0, -1);
  protocol.handle(scheme, async () => {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, responseDelayMs);
      timer.unref?.();
    });
    return new Response("", { headers: { "content-type": "text/html; charset=utf-8" } });
  });
}
