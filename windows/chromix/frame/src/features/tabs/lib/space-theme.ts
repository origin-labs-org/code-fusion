import type { SpaceThemeView } from "$shared/ipc/bindings";
import { reducedMotion } from "$shared/lib/motion";

/** The `ui.theme` and `ui.theme-custom` values a space's own theme stands in for. */
export function spaceThemeValues(
  own: SpaceThemeView | null,
  app: { theme: string; custom: string },
) {
  if (own === null) return app;
  return own.kind === "preset"
    ? { theme: own.id, custom: app.custom }
    : { theme: "custom", custom: own.seeds };
}

let shownSpace: string | null = null;
let shownKey = "";

/**
 * Applies the window's customization. Moving to a space that wears another
 * theme crossfades the whole window instead of snapping; a change made in
 * Appearance applies as it always has. Moving between spaces that dress the
 * window the same way applies nothing, so a switch repaints no chrome.
 */
export function applySpaceTheme(space: string | null, key: string, apply: () => void) {
  const moved = space !== shownSpace;
  const changed = key !== shownKey;
  const first = shownSpace === null;
  const crossfade =
    !first &&
    moved &&
    changed &&
    !reducedMotion() &&
    typeof document.startViewTransition === "function";
  shownSpace = space;
  shownKey = key;
  if (!first && moved && !changed) return;
  if (crossfade) document.startViewTransition(apply);
  else apply();
}
