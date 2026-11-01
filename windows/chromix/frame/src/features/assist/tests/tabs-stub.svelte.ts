import type { TabView } from "$shared/ipc/bindings";

type StubTab = Pick<TabView, "id" | "url" | "title" | "icon">;

const world = $state<{ tabs: StubTab[]; active: string | null; space: string | null }>({
  tabs: [],
  active: null,
  space: null,
});

/** The parts of `$domain/tabs` the panel reads, driven by the test. */
export const tabs = {
  tabs: () => world.tabs,
  activeId: () => world.active,
  activeSpaceId: () => world.space,
  activeTab: () => world.tabs.find((tab) => tab.id === world.active),
  activate: (id: string) => {
    world.active = id;
  },
};

export function setTabs(next: Partial<typeof world>) {
  Object.assign(world, next);
}

export const tab = (id: string, url: string, title = ""): StubTab => ({
  id,
  url,
  title,
  icon: null,
});
