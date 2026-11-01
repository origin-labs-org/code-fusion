import { useEffect, useState, useCallback } from "react";

export type Theme = "light" | "dark" | "cf-light" | "cf-dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "cf-theme";
const BROWSER_THEME_SURFACE_ATTRIBUTE = "data-cf-browser-theme-surface";

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === "system") {
    return getSystemTheme();
  }

  return theme === "dark" || theme === "cf-dark" ? "dark" : "light";
}

export function normalizeThemePreference(theme: Theme): Theme {
  if (theme === "dark") return "cf-dark";
  if (theme === "light") return "cf-light";
  return theme;
}

function setThemeMetaContent(name: "theme-color" | "color-scheme", content: string) {
  let meta = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = name;
    document.head.append(meta);
  }
  meta.content = content;
}

function syncBrowserThemeSurface(resolved: ResolvedTheme) {
  const root = document.documentElement;
  if (
    typeof root.hasAttribute !== "function" ||
    !root.hasAttribute(BROWSER_THEME_SURFACE_ATTRIBUTE)
  ) {
    return;
  }

  root.setAttribute(BROWSER_THEME_SURFACE_ATTRIBUTE, resolved);
  root.style.colorScheme = resolved;
  setThemeMetaContent("color-scheme", resolved);

  const background = getComputedStyle(root).getPropertyValue("--color-background").trim();
  if (background) {
    setThemeMetaContent("theme-color", background);
  }
}

export function applyTheme(theme: Theme) {
  const resolved = resolveTheme(theme);
  const appliedTheme =
    theme === "system"
      ? resolved === "dark"
        ? "cf-dark"
        : "cf-light"
      : normalizeThemePreference(theme);
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.documentElement.classList.toggle("theme-cf-light", appliedTheme === "cf-light");
  document.documentElement.classList.toggle("theme-cf-dark", appliedTheme === "cf-dark");
  syncBrowserThemeSurface(resolved);
}

function isTheme(value: string | null): value is Theme {
  return (
    value === "light" ||
    value === "dark" ||
    value === "cf-light" ||
    value === "cf-dark" ||
    value === "system"
  );
}

// Settings saved before the theme rename still carry the old identifiers.
function migrateLegacyTheme(value: string | null): string | null {
  if (value === "zai-light") return "cf-light";
  if (value === "zai-dark") return "cf-dark";
  return value;
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = migrateLegacyTheme(localStorage.getItem(STORAGE_KEY));
    return isTheme(saved) ? normalizeThemePreference(saved) : "cf-light";
  });

  const setTheme = useCallback((t: Theme) => {
    const normalizedTheme = normalizeThemePreference(t);
    localStorage.setItem(STORAGE_KEY, normalizedTheme);
    setThemeState(normalizedTheme);
    applyTheme(normalizedTheme);
  }, []);

  useEffect(() => {
    applyTheme(theme);

    if (theme !== "system") return;

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  return { theme, setTheme } as const;
}
