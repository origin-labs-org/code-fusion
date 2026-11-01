import type { SpaceView, TabView } from "../ipc/bindings";

export const revision = (value: number): string => value.toString(16).padStart(32, "0");
export function tabFixture(overrides: Partial<TabView> = {}): TabView {
  return {
    id: "tab-1",
    projection_revision: revision(1),
    title: "Example",
    url: "https://example.com/",
    loading: false,
    can_go_back: false,
    can_go_forward: false,
    icon: null,
    ...overrides,
  };
}

export function spaceFixture(
  id: string,
  name: string,
  overrides: Partial<SpaceView> = {},
): SpaceView {
  return { id, name, icon: null, color: 0, theme: null, tabs: 0, previews: [], ...overrides };
}
