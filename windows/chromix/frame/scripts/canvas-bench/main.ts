/**
 * The Work canvas built as the app ships it, over a seeded scene and a fake
 * native side; `run.ts` drives it through `window.bench` in the system WebKit.
 */
import "$styles/global.css";
import { createRawSnippet, flushSync, mount, unmount } from "svelte";
import Lift from "../../src/features/work/components/Lift.svelte";
import WorkCanvas from "../../src/features/work/components/WorkCanvas.svelte";
import { wakeupCounter } from "../../src/shared/testing/idle";
import {
  drawn,
  drive,
  scaleCanvas,
  settle,
  sweep,
  type ScaleMix,
} from "../../src/features/work/tests/scale-fixtures";

const counter = wakeupCounter();
const pictures = new Map<string, string>();
(globalThis as { __benchPictures?: Map<string, string> }).__benchPictures = pictures;

let callbackId = 0;
const answers: Record<string, unknown> = {
  favicon_probe: true,
  work_release_memory: true,
};
(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  invoke: async (command: string) => {
    if (command === "plugin:event|listen") return ++callbackId;
    if (command in answers) return answers[command];
    throw new Error(`unmocked ${command}`);
  },
  transformCallback: () => ++callbackId,
  unregisterCallback() {},
  metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
};

const host = document.getElementById("root")!;
let screen: Record<string, unknown> | null = null;
let center: (id: string) => void = () => {};
let count = 0;

const bench = {
  async open({ items: n, zoom, mix }: { items: number; zoom: number; mix?: ScaleMix }) {
    count = n;
    const canvas = scaleCanvas(n, (index) => `/photos/photo-${index}.jpg`, mix);
    pictures.clear();
    for (const [digest, url] of canvas.pictures) pictures.set(digest, url);
    const opened = performance.now();
    screen = mount(WorkCanvas, {
      target: host,
      props: {
        items: canvas.items,
        links: [],
        authoritative: new Set<string>(),
        initialView: { positions: canvas.positions, viewport: { x: 40, y: 40, zoom } },
        oninspect: () => {},
        expose: (api: { center: (id: string) => void }) => (center = api.center),
      },
    });
    flushSync();
    const mounted = performance.now() - opened;
    await settle(host);
    return { mountMs: Math.round(mounted), ...drawn(host) };
  },
  idle: () => counter.rest(2000),
  css(text: string) {
    document.getElementById("bench-css")?.remove();
    if (text)
      document.head.insertAdjacentHTML("beforeend", `<style id="bench-css">${text}</style>`);
  },
  pan: () => drive(host.querySelector(".svelte-flow__pane")!, 180, false),
  pinch: () => drive(host.querySelector(".svelte-flow__pane")!, 120, true),
  async sweep() {
    await sweep(center, count);
    await settle(host);
    return drawn(host);
  },
  async back() {
    center("item-0");
    await settle(host);
    return drawn(host);
  },
  /** A card in view opened centred and closed again: each frame's interval while it grows and returns. */
  async lift() {
    const bounds = host.getBoundingClientRect();
    const card = [...host.querySelectorAll<HTMLElement>("[data-card-id]")].find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return (
        rect.left > 0 && rect.top > 0 && rect.right < bounds.right && rect.bottom < bounds.bottom
      );
    });
    if (!card) return null;
    const frames = async (ms: number) => {
      const intervals: number[] = [];
      const start = performance.now();
      let last = start;
      while (last - start < ms) {
        await new Promise((done) => requestAnimationFrame(done));
        const now = performance.now();
        intervals.push(now - last);
        last = now;
      }
      return {
        frames: intervals.length,
        max: Math.round(Math.max(...intervals)),
        over25: intervals.filter((interval) => interval > 25).length,
      };
    };
    let closed = false;
    const layer = document.createElement("div");
    document.body.append(layer);
    const lifted = mount(Lift, {
      target: layer,
      props: {
        origin: card.getBoundingClientRect(),
        source: card.dataset.cardId ?? null,
        bounds,
        title: "Lifted",
        onclose: () => (closed = true),
        children: createRawSnippet(() => ({
          render: () => `<div style="block-size: 420px">Lifted</div>`,
        })),
      },
    }) as { close: () => void };
    const open = await frames(900);
    lifted.close();
    const close = await frames(900);
    void unmount(lifted);
    layer.remove();
    return { open, close, closed };
  },
  /** Pinches toward `zoom` around the middle of the view, a trackpad step a frame. */
  async zoomTo(zoom: number) {
    const viewport = host.querySelector<HTMLElement>(".svelte-flow__viewport")!;
    const pane = host.querySelector(".svelte-flow__pane")!;
    const current = () => Number(/scale\(([\d.]+)\)/u.exec(viewport.style.transform)?.[1] ?? 1);
    for (let step = 0; step < 300 && Math.abs(current() - zoom) > 0.03; step++) {
      pane.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: current() < zoom ? -4 : 4,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
          clientX: 720,
          clientY: 450,
        }),
      );
      await new Promise((done) => requestAnimationFrame(done));
    }
    return current();
  },
  close() {
    if (screen) void unmount(screen);
    screen = null;
  },
};
(window as unknown as { bench: typeof bench }).bench = bench;
