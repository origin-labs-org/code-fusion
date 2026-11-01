import { page } from "vitest/browser";
import type { SidebarNodeView, TabView } from "$shared/ipc/bindings";
import { emitNativeEvent } from "$shared/testing/native-events";
import { revision, tabFixture } from "$shared/testing/fixtures";
import { favicons } from "$domain/favicons";
import { surface } from "$domain/surface";
import { tabs } from "$domain/tabs";
import { preferences } from "$domain/preferences";
import { theme } from "$domain/appearance";
import * as launch from "$session/motion.svelte";

const SITES: Record<string, { title: string; fill: string }> = {
  github: { title: "crynta (Crynta) · GitHub", fill: "#1f2328" },
  telegram: { title: "Telegram Messenger", fill: "#2aa3df" },
  spotify: { title: "Spotify - Web Player: Music for everyone", fill: "#1ed760" },
  ddg: { title: "crynta at DuckDuckGo", fill: "#de5833" },
  notion: { title: "Notion - Log in", fill: "#fff" },
  proton: { title: "The best VPN for speed and security", fill: "#6d4aff" },
  slack: { title: "Login | Slack", fill: "#4a154b" },
};

function raster(fill: string): string {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 32;
  const context = canvas.getContext("2d")!;
  context.fillStyle = fill;
  context.beginPath();
  context.roundRect(0, 0, 32, 32, 8);
  context.fill();
  const { data } = context.getImageData(0, 0, 32, 32);
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function tab(key: string): TabView {
  return tabFixture({
    id: key,
    title: SITES[key]!.title,
    url: `https://${key}.example/`,
    icon: { origin: `https://${key}.example`, revision: "a" },
  });
}

let projection = 10;
export async function paint() {
  launch.dispose();
  await preferences.init();
  await surface.init();
  await tabs.init();
  await favicons.init();
  const kept = ["telegram", "proton", "notion"].map(tab);
  const open = ["github", "spotify", "ddg", "slack"].map(tab);
  const node = (id: string, section: "favorites" | "today"): SidebarNodeView => ({
    id,
    parent_id: null,
    section,
    kind: { type: "tab", tab_id: id },
  });
  emitNativeEvent("favicons", {
    surface: "chrome",
    profile_id: "p",
    entries: Object.entries(SITES).map(([key, site]) => ({
      origin: `https://${key}.example`,
      revision: "a",
      rgba: raster(site.fill),
    })),
  });
  emitNativeEvent("itemsChanged", {
    projection_revision: revision((projection += 1)),
    profile: null,
    spaces: [],
    active_space_id: null,
    nodes: [
      ...kept.map((entry) => node(entry.id, "favorites")),
      ...open.map((entry) => node(entry.id, "today")),
    ],
    tabs: [...kept, ...open],
    active: "github",
    split_group: null,
  });
}

// The native glass is not in WebKit: a blurred wallpaper under the window and
// the effect view's own tint stand in for it, so the chrome is judged over
// the ground it actually sits on. The page rect is drawn white or dark like a
// live site.
export const WALLPAPERS = {
  mono: "radial-gradient(120% 90% at 85% 10%, #f4f4f4 0%, #d9d9d9 35%, #6b6b6b 62%, #121212 80%)",
  violet:
    "radial-gradient(90% 80% at 20% 15%, #8f7fd6 0%, #4b3f86 40%, #1d1838 75%), linear-gradient(#000, #000)",
};
// The glass's own frost, then the effect view's tint from material.rs.
const GLASS = {
  light: "linear-gradient(rgb(245 245 247 / 59%), rgb(245 245 247 / 59%)), rgb(255 255 255 / 30%)",
  dark: "linear-gradient(rgb(23 23 26 / 47%), rgb(23 23 26 / 47%)), rgb(0 0 0 / 12%)",
};

export function wallpaper(
  kind: keyof typeof WALLPAPERS,
  theme: "light" | "dark",
  site: string,
  options: { glass?: string; inset?: string } = {},
) {
  document.getElementById("wallpaper")?.remove();
  const ground = document.createElement("div");
  ground.id = "wallpaper";
  ground.style.cssText = `position:fixed;inset:0;z-index:-1;background:${WALLPAPERS[kind]};`;
  const glass = document.createElement("div");
  glass.style.cssText = `position:absolute;inset:0;backdrop-filter:blur(40px) saturate(1.6);background:${options.glass ?? GLASS[theme]};`;
  const page = document.createElement("div");
  page.style.cssText = `position:absolute;inset:${options.inset ?? "8px 8px 8px 256px"};border-radius:12px;background:${site};`;
  ground.append(glass, page);
  document.body.prepend(ground);
}

export const settle = () => new Promise((resolve) => setTimeout(resolve, 450));
export const shot = (name: string) =>
  page.screenshot({ path: `../../../../../target/look/premium/${name}.png` });

/** A theme on the root as the browser applies it, with the default type. */
export function themed(id: string) {
  theme.applyCustomization({
    theme: id,
    custom: "",
    level: "50",
    contrast: false,
    font: "system",
    fontSize: "13",
    codeFont: "system",
  });
}
