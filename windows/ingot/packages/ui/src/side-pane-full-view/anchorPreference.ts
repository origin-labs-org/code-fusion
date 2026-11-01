import type { FloatingAnchor } from "@/side-pane-full-view/contract.js";
import { DEFAULT_FLOATING_ANCHOR, parseFloatingAnchor } from "@/side-pane-full-view/model.js";
import { logger } from "@/logger.js";

const FLOATING_ANCHOR_STORAGE_KEY = "cf:side-pane-full-view:floating-anchor";

export function readFloatingAnchorPreference(): FloatingAnchor {
  try {
    return (
      parseFloatingAnchor(window.localStorage.getItem(FLOATING_ANCHOR_STORAGE_KEY)) ??
      DEFAULT_FLOATING_ANCHOR
    );
  } catch {
    return DEFAULT_FLOATING_ANCHOR;
  }
}

export function writeFloatingAnchorPreference(anchor: FloatingAnchor): void {
  try {
    window.localStorage.setItem(FLOATING_ANCHOR_STORAGE_KEY, anchor);
  } catch (error) {
    logger.warn("[SidePaneFullView] Failed to write floating pane dock position", { anchor, error });
  }
}
