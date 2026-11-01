import type { Scene } from "./scenes";

const themed = (): Scene => (document.documentElement.dataset.theme === "light" ? "day" : "night");

// Read from the document as this module loads and kept in step with it from
// then on, so reading the scene never writes state: it is read inside
// derivations, where a write is refused.
let current = $state<Scene>(themed());
new MutationObserver(() => (current = themed())).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["data-theme"],
});

/** Day over a light page, night over a dark one, following the theme. */
export const scene = (): Scene => current;
