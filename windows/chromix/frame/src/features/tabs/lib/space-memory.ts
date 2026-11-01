import type { SidebarNodeView, SpaceView, TabView } from "$shared/ipc/bindings";

/** What a space showed the last time it was the window's: enough to draw it
 *  again, as a neighbour sliding in, before native has switched to it. */
export type SpaceSheet = {
  nodes: readonly SidebarNodeView[];
  tabs: readonly TabView[];
  active: string | null;
};

const sheets = new Map<string, SpaceSheet>();

/** Keeps the space's current list; spaces that are gone are forgotten. */
export function remember(id: string, sheet: SpaceSheet, spaces: readonly SpaceView[]) {
  sheets.set(id, sheet);
  if (sheets.size <= spaces.length) return;
  const live = new Set(spaces.map((space) => space.id));
  for (const key of sheets.keys()) if (!live.has(key)) sheets.delete(key);
}

export const recall = (id: string): SpaceSheet | undefined => sheets.get(id);
