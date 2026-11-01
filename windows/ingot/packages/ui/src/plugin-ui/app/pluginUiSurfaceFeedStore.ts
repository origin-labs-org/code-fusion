import {
  EMPTY_PLUGIN_UI_SURFACE_FEED,
  mergePluginUiSurfaceFeed,
  type PluginUiSurfaceFeed,
} from "../domain/pluginUiToolFeed.js";

const feeds = new Map<string, PluginUiSurfaceFeed>();
const listeners = new Set<() => void>();

export function getPluginUiSurfaceFeed(key: string): PluginUiSurfaceFeed {
  return feeds.get(key) ?? EMPTY_PLUGIN_UI_SURFACE_FEED;
}

export function offerPluginUiSurfaceFeed(
  key: string,
  candidate: PluginUiSurfaceFeed,
): PluginUiSurfaceFeed {
  const current = getPluginUiSurfaceFeed(key);
  const next = mergePluginUiSurfaceFeed(current, candidate);
  if (next === current) return current;
  feeds.set(key, next);
  for (const listener of listeners) listener();
  return next;
}

export function subscribePluginUiSurfaceFeeds(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetPluginUiSurfaceFeedsForTest(): void {
  feeds.clear();
  listeners.clear();
}

export function clearPluginUiSurfaceFeed(key: string): void {
  feeds.delete(key);
}
