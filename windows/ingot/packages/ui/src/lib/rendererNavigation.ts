export interface RendererNavigationEntry {
  readonly type?: string;
}

function readRendererNavigationEntries(): RendererNavigationEntry[] {
  try {
    if (typeof globalThis.performance?.getEntriesByType !== "function") {
      return [];
    }
    return globalThis.performance.getEntriesByType("navigation") as RendererNavigationEntry[];
  } catch {
    return [];
  }
}

export function isRendererReloadNavigation(
  entries: readonly RendererNavigationEntry[] = readRendererNavigationEntries(),
): boolean {
  return entries[0]?.type === "reload";
}
