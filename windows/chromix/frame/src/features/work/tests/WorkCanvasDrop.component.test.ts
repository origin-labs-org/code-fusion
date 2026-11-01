import "$styles/global.css";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import WorkCanvas from "../components/WorkCanvas.svelte";
import { setPointerTool } from "../lib/pointer-tool.svelte";
import { dropSpot } from "../lib/free-space";
import type { CanvasItem, CanvasView } from "../lib/canvas-model";

const card = (id: string, title: string): CanvasItem => ({
  id,
  type: "note",
  title,
  kind: "Notes",
  detail: "",
  status: "",
});
/** A run's card the person's things may not cover. */
const RUN = { x: 40, y: 40, width: 400, height: 300 };

async function canvas(onviewchange: (view: CanvasView) => void) {
  await page.viewport(1200, 800);
  setPointerTool("select");
  const placeDrop = vi.fn((id: string, rect: Parameters<typeof dropSpot>[0]) =>
    id === "note" ? dropSpot(rect, [RUN]) : null,
  );
  const screen = await render(WorkCanvas, {
    items: [card("run", "Run card"), card("note", "My note")],
    links: [],
    authoritative: new Set(["note"]),
    initialView: {
      positions: { run: { x: RUN.x, y: RUN.y }, note: { x: 700, y: 80 } },
      sizes: { run: { width: RUN.width, height: RUN.height }, note: { width: 280, height: 160 } },
      viewport: { x: 0, y: 0, zoom: 1 },
    },
    oninspect: () => {},
    onviewchange,
    placeDrop,
  });
  screen.container.style.width = "1200px";
  screen.container.style.height = "800px";
  await expect.poll(() => screen.container.querySelectorAll(".work-drag-handle").length).toBe(2);
  return { screen, placeDrop };
}

const nodeOf = (container: HTMLElement, id: string) =>
  container.querySelector<HTMLElement>(`.svelte-flow__node[data-id="${id}"]`)!;
const handleOf = (container: HTMLElement, id: string) =>
  nodeOf(container, id).querySelector<HTMLElement>(".work-drag-handle")!;
const latest = (spy: ReturnType<typeof vi.fn>, id: string) =>
  (spy.mock.calls.at(-1)?.[0] as CanvasView | undefined)?.positions[id];

/** Drags a card by its handle so its top-left lands at a canvas point (the view is unpanned). */
async function drag(container: HTMLElement, id: string, to: { x: number; y: number }) {
  const handle = handleOf(container, id);
  const node = nodeOf(container, id).getBoundingClientRect();
  const grip = handle.getBoundingClientRect();
  const flow = container.querySelector(".svelte-flow")!.getBoundingClientRect();
  const from = { x: grip.left + 12, y: grip.top + grip.height / 2 };
  const end = {
    x: flow.left + to.x + (from.x - node.left),
    y: flow.top + to.y + (from.y - node.top),
  };
  const mouse = (target: EventTarget, type: string, at: { x: number; y: number }) =>
    target.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: at.x,
        clientY: at.y,
        button: 0,
        buttons: type === "mouseup" ? 0 : 1,
      }),
    );
  mouse(handle, "mousedown", from);
  for (let step = 1; step <= 6; step += 1) {
    mouse(window, "mousemove", {
      x: from.x + ((end.x - from.x) * step) / 6,
      y: from.y + ((end.y - from.y) * step) / 6,
    });
    await new Promise((frame) => requestAnimationFrame(frame));
  }
  mouse(window, "mouseup", end);
}

test("a card dropped in open room stays exactly where it was put", async () => {
  const onviewchange = vi.fn();
  const { screen, placeDrop } = await canvas(onviewchange);
  await drag(screen.container, "note", { x: 640, y: 420 });
  await expect.poll(() => placeDrop.mock.calls.length).toBeGreaterThan(0);
  const dropped = placeDrop.mock.calls.at(-1)![1];
  // It moved, and nowhere near the run's card.
  expect(Math.hypot(dropped.x - 700, dropped.y - 80)).toBeGreaterThan(200);
  expect(dropSpot(dropped, [RUN])).toBeNull();
  const where = { x: dropped.x, y: dropped.y };
  await expect.poll(() => latest(onviewchange, "note")).toEqual(where);
  // Nothing moves it afterwards.
  await new Promise((settled) => setTimeout(settled, 600));
  expect(latest(onviewchange, "note")).toEqual(where);
  expect(nodeOf(screen.container, "note").classList.contains("settling")).toBe(false);
  await screen.unmount();
});

test("a card dropped on a run's card glides to the nearest spot clear of it", async () => {
  const onviewchange = vi.fn();
  const { screen } = await canvas(onviewchange);
  await drag(screen.container, "note", { x: 120, y: 120 });
  await expect
    .poll(() => nodeOf(screen.container, "note").classList.contains("settling"))
    .toBe(true);
  await expect
    .poll(() => {
      const at = latest(onviewchange, "note");
      return !!at && !!dropSpot({ ...at, width: 280, height: 160 }, [RUN]) === false;
    })
    .toBe(true);
  // It glided, and the glide's class goes once it is there.
  await expect
    .poll(() => nodeOf(screen.container, "note").classList.contains("settling"), {
      timeout: 3000,
    })
    .toBe(false);
  await screen.unmount();
});
