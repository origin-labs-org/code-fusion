import { isWebRemoteControlThemeSeed, type WebRemoteControlThemeSeed } from "@origin-ai/cf-shared";

export const WEB_REMOTE_CONTROL_DEFAULT_THEME: WebRemoteControlThemeSeed = "cf-dark";

function normalizeWebRemoteControlThemeSeed(
  theme: WebRemoteControlThemeSeed,
): WebRemoteControlThemeSeed {
  if (theme === "dark") return "cf-dark";
  if (theme === "light") return "cf-light";
  return theme;
}

export function resolveWebRemoteControlInitialTheme({
  storedTheme,
  qrTheme,
  defaultTheme = WEB_REMOTE_CONTROL_DEFAULT_THEME,
}: {
  storedTheme?: string | null;
  qrTheme?: string | null;
  defaultTheme?: WebRemoteControlThemeSeed;
}): WebRemoteControlThemeSeed {
  if (isWebRemoteControlThemeSeed(storedTheme)) {
    return normalizeWebRemoteControlThemeSeed(storedTheme);
  }

  if (isWebRemoteControlThemeSeed(qrTheme)) {
    return normalizeWebRemoteControlThemeSeed(qrTheme);
  }

  return normalizeWebRemoteControlThemeSeed(defaultTheme);
}

export function seedWebRemoteControlThemePreference(qrTheme?: string | null): void {
  if (typeof localStorage === "undefined") {
    return;
  }

  const storedTheme = localStorage.getItem("cf-theme");
  const resolvedTheme = resolveWebRemoteControlInitialTheme({ storedTheme, qrTheme });
  if (!storedTheme && isWebRemoteControlThemeSeed(qrTheme)) {
    localStorage.setItem("cf-theme", resolvedTheme);
  }
}
