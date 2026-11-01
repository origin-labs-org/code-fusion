import { createRoot } from "react-dom/client";
import type {
  NetworkCaptureBridge,
  ResourceUsageSnapshot,
  StorageManagementBridge,
} from "@origin-ai/cf-shared";
import "@origin-ai/cf-ui/styles.css";
import {
  ResourceManagerApp,
  CfIntlProvider,
  applyUiFontSizePx,
  loadUiFontSizePx,
  subscribeToUiFontSizeStorageChanges,
} from "@origin-ai/cf-ui";

declare global {
  interface Window {
    resourceManager?: {
      getSnapshot: () => Promise<ResourceUsageSnapshot>;
      setSamplingActive: (active: boolean) => void;
      storage?: StorageManagementBridge;
      network?: NetworkCaptureBridge;
    };
  }
}

type Theme = "light" | "dark" | "cf-light" | "cf-dark" | "system";

function resolveTheme(theme: Theme): "light" | "dark" {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return theme === "dark" || theme === "cf-dark" ? "dark" : "light";
}

function applyResourceManagerTheme(): void {
  const savedTheme = (localStorage.getItem("cf-theme") as Theme | null) ?? "cf-dark";
  const resolvedTheme = resolveTheme(savedTheme);
  const appliedTheme =
    savedTheme === "system"
      ? resolvedTheme === "dark"
        ? "cf-dark"
        : "cf-light"
      : savedTheme === "dark"
        ? "cf-dark"
        : savedTheme === "light"
          ? "cf-light"
          : savedTheme;
  document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
  document.documentElement.classList.toggle("theme-cf-light", appliedTheme === "cf-light");
  document.documentElement.classList.toggle("theme-cf-dark", appliedTheme === "cf-dark");
}

applyResourceManagerTheme();
applyUiFontSizePx(loadUiFontSizePx());
subscribeToUiFontSizeStorageChanges();

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <CfIntlProvider>
      <ResourceManagerApp
        setSamplingActive={window.resourceManager?.setSamplingActive}
        getSnapshot={
          window.resourceManager ? () => window.resourceManager!.getSnapshot() : undefined
        }
        storage={window.resourceManager?.storage}
        network={window.resourceManager?.network}
      />
    </CfIntlProvider>,
  );
}
