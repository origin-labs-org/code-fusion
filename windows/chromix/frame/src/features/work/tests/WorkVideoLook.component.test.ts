import "$styles/global.css";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import type { WorkEnvironmentSnapshot } from "$shared/ipc/bindings";
import type { MediaAssetV1 } from "$domain/resources";
import WorkCanvas from "../components/WorkCanvas.svelte";
import { environmentItems } from "../lib/project-environment";

/** A stand-in for YouTube's hqdefault poster: 4:3 with the letterbox bars it really has. */
function poster(): string {
  const canvas = document.createElement("canvas");
  canvas.width = 480;
  canvas.height = 360;
  const draw = canvas.getContext("2d")!;
  draw.fillStyle = "#000";
  draw.fillRect(0, 0, 480, 360);
  const sky = draw.createLinearGradient(0, 45, 480, 315);
  sky.addColorStop(0, "#1d3b6b");
  sky.addColorStop(1, "#d9775a");
  draw.fillStyle = sky;
  draw.fillRect(0, 45, 480, 270);
  draw.fillStyle = "#f4e9d8";
  draw.beginPath();
  draw.arc(340, 150, 48, 0, Math.PI * 2);
  draw.fill();
  draw.fillStyle = "#13233d";
  draw.fillRect(0, 250, 480, 65);
  draw.fillStyle = "#fff";
  draw.font = "600 30px sans-serif";
  draw.fillText("Designing calm canvases", 28, 110);
  return canvas.toDataURL("image/png");
}
const drawn = { src: "" };
vi.mock("$domain/resources", async (original) => ({
  ...(await original<typeof import("$domain/resources")>()),
  mediaUrl: () => drawn.src,
}));
vi.mock("$shared/ipc/bindings", async () => {
  const { mockBindings } = await import("$shared/testing/bindings");
  return mockBindings({ faviconProbe: async () => true });
});

const shots = "../../../../../target/work-video";
const url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

function scene(title: string, pictured: boolean): WorkEnvironmentSnapshot {
  return {
    version: 1,
    profile: "p",
    id: "env",
    space: "s",
    title: "Videos",
    revision: "1",
    lifecycle: "active",
    areas: [],
    view: { revision: "1", x: 0, y: 0, zoom_milli: 1000, placements: [] },
    elements: [
      { id: "link", area: null, reference: { kind: "link", url, title } },
      ...(pictured
        ? [{ id: "picture", area: null, reference: { kind: "resource" as const, resource: "r" } }]
        : []),
    ],
    relations: pictured
      ? [{ id: "u", from: "link", to: "picture", kind: "uses", origin: { kind: "user" } }]
      : [],
  };
}
const asset: MediaAssetV1 = {
  version: 1,
  kind: "image",
  mime: "image/jpeg",
  bytes: 1,
  digest: "f".repeat(64),
  name: "hqdefault.jpg",
  origin: { kind: "fetched", url: "https://i.ytimg.com/vi/x/hqdefault.jpg", observed_at: "x" },
};

test.each([
  ["named", "Designing calm canvases — a talk\nCalm Studio", true],
  [
    "long",
    "Designing calm canvases for people who live in their browser all day, a long talk about quiet interfaces and the work of leaving things out\nCalm Studio with a rather long channel name",
    true,
  ],
  ["pasted", "youtube.com", true],
  ["waiting", "youtube.com", false],
] as const)(
  "a video card (%s) is its poster, its name and YouTube's mark",
  async (name, title, pictured) => {
    drawn.src = poster();
    await page.viewport(900, 600);
    const items = environmentItems(
      scene(title, pictured),
      [],
      [],
      new Map(),
      new Map([["r", asset]]),
    );
    const screen = await render(WorkCanvas, {
      items,
      links: [],
      authoritative: new Set(["link"]),
      initialView: { positions: { link: { x: 40, y: 40 } }, viewport: { x: 0, y: 0, zoom: 1 } },
      oninspect: () => {},
    });
    screen.container.style.width = "900px";
    screen.container.style.height = "600px";
    const node = () => screen.container.querySelector<HTMLElement>('[data-id="link"]');
    await expect.poll(() => !!node()?.querySelector(".media.video")).toBe(true);
    if (pictured)
      await expect
        .poll(() => node()!.querySelector<HTMLImageElement>(".media.video img")?.complete)
        .toBe(true);
    const [named, channel] = title.split("\n");
    const caption = node()!.querySelector("figcaption")?.textContent ?? "";
    expect(caption).toContain(title === "youtube.com" ? "YouTube video" : named);
    if (channel) expect(caption).toContain(channel);
    else expect(node()!.querySelector(".channel")).toBeNull();
    for (const theme of ["dark", "light"]) {
      document.documentElement.dataset.theme = theme;
      await new Promise((settled) => setTimeout(settled, 120));
      await page.elementLocator(node()!).screenshot({ path: `${shots}/${name}-${theme}.png` });
    }
    document.documentElement.dataset.theme = "dark";
    await screen.unmount();
  },
);
