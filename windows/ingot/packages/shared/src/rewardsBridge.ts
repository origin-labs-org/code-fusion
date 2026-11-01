import { rewardsContextSchema, type RewardsContext } from "./rewardsEmbedded.js";

export function installRewardsPageBridge() {
  const storage = (globalThis as unknown as { localStorage: { removeItem: (key: string) => void } })
    .localStorage;
  for (const key of ["oauth:zai:access_token", "oauth:bigmodel:access_token", "cfjwttoken"])
    storage.removeItem(key);
  const window = (
    globalThis as unknown as {
      window: { addEventListener: (event: string, callback: (event: Event) => void) => void };
    }
  ).window;
  let current: RewardsContext | null = null;
  const listeners = {
    theme: new Set<(value: unknown) => void>(),
    locale: new Set<(value: unknown) => void>(),
    auth: new Set<(value: unknown) => void>(),
  };
  window.addEventListener("cf-rewards-context", (event) => {
    const next = (event as CustomEvent).detail;
    if (
      !next ||
      !["cf-light", "cf-dark"].includes(next.theme) ||
      !["zh-CN", "en-US"].includes(next.locale) ||
      !next.auth ||
      !["ready", "anonymous"].includes(next.auth.status) ||
      ![null, "zai", "bigmodel"].includes(next.auth.provider) ||
      !Number.isSafeInteger(next.auth.revision) ||
      next.auth.revision < 0
    )
      return;
    const previous = current;
    current = next;
    for (const key of ["theme", "locale", "auth"] as const) {
      if (JSON.stringify(previous?.[key]) !== JSON.stringify(next[key])) {
        for (const callback of listeners[key]) callback(next[key]);
      }
    }
  });
  Object.defineProperty(window, "cfBridge", {
    configurable: false,
    writable: false,
    value: {
      getTheme() {
        return current?.theme ?? null;
      },
      getLang() {
        return current?.locale ?? null;
      },
      getAuthState() {
        return current?.auth ?? null;
      },
      onThemeChange(callback: (value: unknown) => void) {
        listeners.theme.add(callback);
        return () => listeners.theme.delete(callback);
      },
      onLangChange(callback: (value: unknown) => void) {
        listeners.locale.add(callback);
        return () => listeners.locale.delete(callback);
      },
      onAuthChange(callback: (value: unknown) => void) {
        listeners.auth.add(callback);
        return () => listeners.auth.delete(callback);
      },
    },
  });
}

export function createRewardsInjectionScript(
  context: RewardsContext,
  credentials: { oauth?: string | null; jwt?: string | null },
  expectedUrl?: string,
): string {
  const snapshot = rewardsContextSchema.parse(context);
  const values =
    snapshot.auth.status === "ready"
      ? {
          [`oauth:${snapshot.auth.provider}:access_token`]: credentials.oauth?.trim() || null,
          cfjwttoken: credentials.jwt?.trim() || null,
        }
      : {};
  return `(() => {
    ${expectedUrl ? `if (window.location.href !== ${JSON.stringify(expectedUrl)}) return;` : ""}
    for (const key of ["oauth:zai:access_token", "oauth:bigmodel:access_token", "cfjwttoken"]) localStorage.removeItem(key);
    for (const [key, value] of Object.entries(${JSON.stringify(values)})) if (value) localStorage.setItem(key, value);
    window.dispatchEvent(new CustomEvent("cf-rewards-context", { detail: ${JSON.stringify(snapshot)} }));
  })()`;
}
