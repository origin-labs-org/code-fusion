import { commands } from "$shared/ipc/bindings";
import { events } from "$shared/ipc/native-events";

/** What the trackpad itself says about a swipe, in the order it happens. */
export type SwipeSink = {
  began: (dx: number, dy: number, time: number) => void;
  moved: (dx: number, dy: number, time: number) => void;
  lifted: () => void;
};

type Owner = { sink: SwipeSink };

let owner: Owner | null = null;
let live = false;
let listening: Promise<() => void> | null = null;

function listen() {
  listening ??= events.swipeScroll.listen(({ payload }) => {
    const sink = owner?.sink;
    if (!sink) return;
    const { dx, dy, time } = { dx: payload.dx ?? 0, dy: payload.dy ?? 0, time: payload.time ?? 0 };
    if (payload.phase === "began") sink.began(dx, dy, time);
    else if (payload.phase === "changed") sink.moved(dx, dy, time);
    else sink.lifted();
  });
}

/** Whether native is reading the trackpad, so the wheel need not be guessed from. */
export const nativeSwipeLive = () => live;

/**
 * Tells native where the column stands so it reads swipes over it, and keeps
 * that current as the column moves or changes size. Returns the way out.
 * Where native cannot read the trackpad nothing arrives and the wheel serves.
 */
export function attachNativeSwipe(host: HTMLElement, sink: SwipeSink): () => void {
  const mine: Owner = { sink };
  owner = mine;
  listen();
  let sent = "";
  let frame = 0;
  const report = async (region: { x: number; y: number; width: number; height: number } | null) => {
    const key = region ? [region.x, region.y, region.width, region.height].join() : "";
    if (key === sent) return;
    sent = key;
    try {
      const reading = await commands.swipeRegion(region);
      if (owner === mine) live = region !== null && reading;
    } catch {
      sent = "";
      if (owner === mine) live = false;
    }
  };
  const measure = () => {
    frame = 0;
    const box = host.getBoundingClientRect();
    void report({
      x: Math.round(box.x * 2) / 2,
      y: Math.round(box.y * 2) / 2,
      width: Math.round(box.width * 2) / 2,
      height: Math.round(box.height * 2) / 2,
    });
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(measure);
  };
  const resize = new ResizeObserver(schedule);
  resize.observe(host);
  window.addEventListener("resize", schedule);
  // A column that slid into place is not a resize; the pointer arriving is the
  // last moment it can matter.
  host.addEventListener("pointerenter", schedule);
  measure();
  return () => {
    resize.disconnect();
    window.removeEventListener("resize", schedule);
    host.removeEventListener("pointerenter", schedule);
    if (frame) cancelAnimationFrame(frame);
    if (owner !== mine) return;
    owner = null;
    live = false;
    void report(null);
  };
}
