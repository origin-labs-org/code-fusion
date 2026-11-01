import type { SidebarNodeView, TabView } from "$shared/ipc/bindings";
import { tabFixture } from "$shared/testing/fixtures";
import { emitNativeEvent } from "$shared/testing/native-events";

/**
 * A tabs projection that behaves as native does for onboarding: keeping a
 * catalog site adds an unloaded Essentials tab and delivers the site's seeded
 * raster, closing one keeps it, and letting one go removes it.
 */
const URLS: Record<string, string> = {
  slack: "https://app.slack.com/client",
  notion: "https://www.notion.so/",
  github: "https://github.com/",
  figma: "https://www.figma.com/files",
  youtube: "https://www.youtube.com/",
  spotify: "https://open.spotify.com/",
  gmail: "https://mail.google.com/",
  linear: "https://linear.app/",
};
const PROFILE = "00000000000000000000000777";

const open = ["New Tab"].map((title, index) =>
  tabFixture({ id: `t${index}`, title, url: null, icon: null }),
);
let kept = $state<TabView[]>([]);
let name = $state("Personal");
let next = 0;
// The tab the window shows: the new tab of a fresh profile, or a page.
let active = $state<TabView | undefined>(open[0]);
let opened = 0;

const node = (id: string, section: "favorites" | "today"): SidebarNodeView => ({
  id,
  parent_id: null,
  section,
  kind: { type: "tab", tab_id: id },
});

async function seed(origin: string, site: string) {
  const bytes = new Uint8Array(
    await (
      await fetch(new URL(`../../../../../assets/kept-sites/${site}.rgba`, import.meta.url))
    ).arrayBuffer(),
  );
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  emitNativeEvent("favicons", {
    surface: "chrome",
    profile_id: PROFILE,
    entries: [{ origin, revision: site, rgba: btoa(binary) }],
  });
}

export const fakeTabs = {
  init: async () => {},
  dispose() {},
  profile: () => ({ id: PROFILE, name, kind: "default" as const }),
  tabs: () => [...kept, ...open],
  sidebarNodes: () => [
    ...kept.map((tab) => node(tab.id, "favorites")),
    ...open.map((tab) => node(tab.id, "today")),
  ],
  activeId: () => "t0",
  activeTab: () => active,
  open() {
    opened++;
  },
  opened: () => opened,
  showPage(url: string) {
    active = tabFixture({ id: "t9", title: "Page", url, icon: null });
  },
  activeSpaceId: () => "space",
  activeSpace: () => ({ id: "space", name: "Personal", icon: null, color: 0 }),
  splitGroup: () => null,
  dropTab() {},
  async keepSite(site: string) {
    const url = URLS[site];
    if (!url) return { outcome: "rejected" as const, disposition: null };
    const origin = url.split("/").slice(0, 3).join("/");
    await seed(origin, site);
    // As native can: the answer first, the projection that draws the site a
    // few frames after it.
    const tab = tabFixture({
      id: `k${next++}`,
      title: site,
      url,
      icon: { origin, revision: site },
    });
    setTimeout(() => (kept = [...kept, tab]), 60);
    return { outcome: "applied" as const, disposition: null };
  },
  // As native: closing an Essential ends its page and keeps the site.
  close() {},
  async releaseSite(site: string) {
    const url = URLS[site];
    if (!url) return { outcome: "rejected" as const, disposition: null };
    kept = kept.filter((tab) => tab.url !== url);
    return { outcome: "applied" as const, disposition: null };
  },
  async renameProfile(next: string) {
    name = next;
    return { outcome: "applied" as const, disposition: null };
  },
  openTabMenu() {},
  reset() {
    kept = [];
    name = "Personal";
    active = open[0];
    opened = 0;
  },
};
