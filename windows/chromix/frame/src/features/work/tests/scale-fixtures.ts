import type { MediaAssetV1 } from "$domain/resources";
import { defaultSize, type CanvasItem, type CanvasPosition } from "../lib/canvas-model";
import type { ObjectView } from "../lib/board/types";
import { allObjects } from "./object-fixtures";

/**
 * A seeded canvas for measuring the Work canvas at scale, shared by the
 * component bench (Playwright's WebKit) and scripts/canvas-bench (the system
 * WebKit in a window, production build). Pictures are distinct photo-sized
 * JPEGs, so no two cards share one decoded image.
 */
export type ScaleMix = "mixed" | "plain" | "objects" | "notes" | "media";

const PROFILE = "01J8Z7V6Q5N4M3K2H1G0F9E8D7";
const digestOf = (index: number) => index.toString(16).padStart(64, "0");

export type ScaleCanvas = {
  items: CanvasItem[];
  positions: Record<string, CanvasPosition>;
  /** Picture address by digest, for the media route's stand-in. */
  pictures: Map<string, string>;
  /** How many photos the canvas shows: photo 0 to photos - 1. */
  photos: number;
};

const slotOf = (mix: ScaleMix, index: number) =>
  mix === "plain"
    ? index % 3
    : mix === "objects"
      ? 3
      : mix === "notes"
        ? 2
        : mix === "media"
          ? 0
          : index % 6;

/** Pictures, notes and run objects (documents, tables, charts, picks…) in turn, laid out in rows. */
export function scaleCanvas(
  count: number,
  photoUrl: (index: number) => string,
  mix: ScaleMix = "mixed",
): ScaleCanvas {
  const items: CanvasItem[] = [];
  const pictures = new Map<string, string>();
  let photos = 0;
  const withPhotos = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(withPhotos);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        key === "src" && typeof entry === "string" ? photoUrl(photos++) : withPhotos(entry),
      ]),
    );
  };
  for (let index = 0; index < count; index++) {
    const id = `item-${index}`;
    const slot = slotOf(mix, index);
    if (slot === 0 || slot === 1) {
      const digest = digestOf(index);
      pictures.set(digest, photoUrl(photos++));
      const asset = {
        kind: "image",
        digest,
        mime: "image/jpeg",
        bytes: 180_000,
        width: 1600,
        height: 1067,
      } as unknown as MediaAssetV1;
      items.push({
        id,
        type: "media",
        title: `Photo ${index}`,
        kind: "Image",
        detail: "",
        status: "Saved",
        media: { profile: PROFILE, asset },
      });
    } else if (slot === 2) {
      items.push({
        id,
        type: "note",
        title: `Note ${index}`,
        kind: "Note",
        detail: String(1_760_000_000_000 + index),
        status: "",
        note: {
          id: `note-${index}`,
          preview:
            "Call the venue about the late check-in, then compare the two rental offers before Friday.",
        },
      });
    } else {
      const base = allObjects[(index * 7) % allObjects.length]!;
      const view = withPhotos({ ...base, id: `${base.id}-${index}` }) as ObjectView;
      const item: CanvasItem = {
        id,
        type: "object",
        title: "",
        kind: view.kind,
        detail: "",
        status: "",
        object: { view, live: false },
      };
      items.push({ ...item, size: defaultSize(item) });
    }
  }
  return { items, positions: packed(items), pictures, photos };
}

/** Rows of items at their own sizes, 48 px apart, the whole roughly square, as a busy work packs. */
function packed(items: readonly CanvasItem[]) {
  const sizes = items.map((item) => defaultSize(item));
  const area = sizes.reduce((sum, size) => sum + (size.width + 48) * (size.height + 48), 0);
  const across = Math.max(1600, Math.sqrt(area));
  const positions: Record<string, CanvasPosition> = {};
  let x = 0;
  let y = 0;
  let tallest = 0;
  items.forEach((item, index) => {
    const size = sizes[index]!;
    if (x && x + size.width > across) {
      x = 0;
      y += tallest + 48;
      tallest = 0;
    }
    positions[item.id] = { x, y };
    x += size.width + 48;
    tallest = Math.max(tallest, size.height);
  });
  return positions;
}

const frame = () => new Promise((done) => requestAnimationFrame(() => done(null)));
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Until what is drawn and decoded has stopped changing, then a beat for late chunks. */
export async function settle(root: HTMLElement) {
  let last = "";
  let still = 0;
  for (let tick = 0; tick < 600 && still < 20; tick++) {
    await frame();
    const images = [...root.querySelectorAll("img")];
    const key = `${root.querySelectorAll("*").length}|${images.filter((image) => image.complete).length}`;
    still = key === last ? still + 1 : 0;
    last = key;
  }
  await wait(1500);
}

type Stats = { mean: number; p95: number; max: number; over25: number };
function stats(times: readonly number[]): Stats {
  const sorted = [...times].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  return {
    mean: +(times.reduce((sum, time) => sum + time, 0) / times.length).toFixed(1),
    p95: +at(0.95).toFixed(1),
    max: +at(1).toFixed(1),
    over25: times.filter((time) => time > 25).length,
  };
}

/** After every microtask the step queued, and the rendering update that follows it. */
function nextTask() {
  const channel = new MessageChannel();
  return new Promise((done) => {
    channel.port1.onmessage = () => {
      channel.port1.close();
      done(null);
    };
    channel.port2.postMessage(null);
  });
}

/**
 * One trackpad step per frame, a pan or a pinch: each frame's interval, the
 * script a step runs, its forced layout, everything up to the next task
 * (rendering included), and how many nodes the flow built and tore down.
 */
export async function drive(target: Element, frames: number, pinch: boolean) {
  const intervals: number[] = [];
  const work: number[] = [];
  const script: number[] = [];
  const layout: number[] = [];
  let mounted = 0;
  let unmounted = 0;
  const isNode = (node: Node) =>
    node instanceof Element && node.classList.contains("svelte-flow__node");
  const watcher = new MutationObserver((records) => {
    for (const record of records) {
      mounted += [...record.addedNodes].filter(isNode).length;
      unmounted += [...record.removedNodes].filter(isNode).length;
    }
  });
  watcher.observe(target.closest(".svelte-flow")!, { childList: true, subtree: true });
  target.dispatchEvent(
    new PointerEvent("pointermove", { bubbles: true, clientX: 700, clientY: 440 }),
  );
  await wait(200);
  let last = performance.now();
  for (let index = 0; index < frames; index++) {
    const start = performance.now();
    target.dispatchEvent(
      new WheelEvent("wheel", {
        deltaX: pinch ? 0 : Math.cos((index / 45) * Math.PI) * 24,
        deltaY: pinch
          ? Math.sin((index / 30) * Math.PI) * 6
          : Math.sin((index / 30) * Math.PI) * 16,
        ctrlKey: pinch,
        bubbles: true,
        cancelable: true,
        clientX: 720,
        clientY: 450,
      }),
    );
    for (let tick = 0; tick < 8; tick++) await Promise.resolve();
    const scripted = performance.now();
    script.push(scripted - start);
    void document.body.offsetHeight;
    layout.push(performance.now() - scripted);
    await nextTask();
    work.push(performance.now() - start);
    await frame();
    const now = performance.now();
    intervals.push(now - last);
    last = now;
  }
  watcher.disconnect();
  return {
    frames: stats(intervals),
    script: stats(script),
    layout: stats(layout),
    work: stats(work),
    mounted,
    unmounted,
  };
}

/** What is in the document now, and the pictures it holds decoded. */
export function drawn(root: HTMLElement) {
  const images = [...root.querySelectorAll("img")];
  const decoded = images.filter((image) => image.complete && image.naturalWidth);
  return {
    dom: root.querySelectorAll("*").length,
    flowNodes: root.querySelectorAll(".svelte-flow__node").length,
    images: images.length,
    decodedMB: +(
      decoded.reduce((sum, image) => sum + image.naturalWidth * image.naturalHeight * 4, 0) /
      1048576
    ).toFixed(1),
    animations: document.getAnimations().filter((animation) => animation.playState === "running")
      .length,
  };
}

/** Over every row of the canvas and back, a card at a time, two frames on each. */
export async function sweep(center: (id: string) => void, count: number) {
  const columns = Math.ceil(Math.sqrt(count));
  for (let index = 0; index < count; index += 1) {
    if (index % columns && index !== count - 1 && index % 3) continue;
    center(`item-${index}`);
    await frame();
    await frame();
  }
}
