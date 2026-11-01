import type { WebRemoteControlWindowBootstrapResult } from "@origin-ai/cf-shared";

interface WebRemoteControlVersionGuardOptions {
  
  requestBootstrap(): Promise<WebRemoteControlWindowBootstrapResult>;
  onAccepted?(result: WebRemoteControlWindowBootstrapResult): void;
  getUrl(): string;
  isPageReady(): boolean;
  navigate(url: string): void;
  onMismatch(desktopVersion: string): void;
}

export function createWebRemoteControlVersionGuard(options: WebRemoteControlVersionGuardOptions) {
  let generation = 0;
  let disposed = false;
  let pendingUrl: string | undefined;
  let navigated = false;
  let inFlight: Promise<WebRemoteControlWindowBootstrapResult | undefined> | undefined;

  const confirm = () => {
    if (disposed || navigated || !pendingUrl) return;
    navigated = true;
    options.navigate(pendingUrl);
  };

  const invalidate = () => {
    generation += 1;
    inFlight = undefined;
  };

  return {
    isBlocked: () => pendingUrl !== undefined,
    confirm,
    invalidate,
    dispose() {
      disposed = true;
      invalidate();
    },
    check(): Promise<WebRemoteControlWindowBootstrapResult | undefined> {
      if (disposed || pendingUrl) return Promise.resolve(undefined);
      if (inFlight) return inFlight;
      const requestGeneration = generation;
      const request = Promise.resolve()
        .then(() => options.requestBootstrap())
        .then((result) => {
          if (disposed || requestGeneration !== generation) return undefined;
          const version = result.desktopAppVersion?.trim();
          if (version) {
            const url = new URL(options.getUrl());
            if (
              url.pathname.replace(/\/+$/, "") === "/remote/v4" &&
              url.searchParams.get("app_version") !== version
            ) {
              url.searchParams.set("app_version", version);
              pendingUrl = url.toString();
              if (options.isPageReady()) options.onMismatch(version);
              else confirm();
              return undefined;
            }
          }
          options.onAccepted?.(result);
          return result;
        })
        .catch((error: unknown) => {
          if (disposed || requestGeneration !== generation) return undefined;
          throw error;
        })
        .finally(() => {
          if (inFlight === request) inFlight = undefined;
        });
      inFlight = request;
      return request;
    },
  };
}
