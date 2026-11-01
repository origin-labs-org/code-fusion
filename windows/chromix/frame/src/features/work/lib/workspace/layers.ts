const QUIET_MS = 250;
/** A moving canvas keeps its layers this long after its last move, across a pause in a gesture. */
const HELD_MS = 1000;

/**
 * WebKit composites the canvas's transformed viewport while anything inside
 * it moves (an arrival, a board settling, a helper walking), and keeps it
 * composited after the motion ends: a backing store the size of everything on
 * the canvas, tens to hundreds of megabytes, held at rest. One invisible
 * layout change once the canvas is still lets WebKit take the layer back.
 * Where WebKit already does, the change costs one small layout and nothing more.
 *
 * A moving canvas is the exception: while it pans, pinches or a card is
 * dragged, the viewport and each card are held as layers (`data-held`,
 * styled by the canvas), so motion is the compositor sliding and rescaling
 * pictures rather than repainting tiles, rounded photos and all. Those layers
 * cost hundreds of megabytes on a full canvas, so they are made only for real
 * motion, never for a pointer resting on the canvas, and let go a moment
 * after it stops, or at once when the window hides.
 */
export function layerRelease(root: HTMLElement) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let held: ReturnType<typeof setTimeout> | undefined;
  let holding = false;
  let gone = false;
  const viewportOf = () => root.querySelector<HTMLElement>(".svelte-flow__viewport");
  const watched = new WeakSet<Animation>();
  const release = () => {
    timer = undefined;
    const viewport = viewportOf();
    if (gone || holding || !viewport) return;
    const moving = viewport
      .getAnimations({ subtree: true })
      .filter((animation) => animation.playState === "running" || animation.pending);
    if (moving.length) {
      // Asked again as each one ends: never while something still moves, never on a timer.
      for (const animation of moving) {
        if (watched.has(animation)) continue;
        watched.add(animation);
        void animation.finished.then(moved, moved);
      }
      return;
    }
    const probe = document.createElement("div");
    probe.setAttribute("aria-hidden", "true");
    probe.style.position = "absolute";
    probe.style.inlineSize = "0";
    probe.style.blockSize = "0";
    viewport.append(probe);
    void viewport.offsetHeight;
    probe.remove();
  };
  /** Something on the canvas started or stopped moving: once all is still, the layer goes. */
  const moved = () => {
    if (gone) return;
    clearTimeout(timer);
    timer = setTimeout(release, QUIET_MS);
  };
  const letGo = () => {
    clearTimeout(held);
    held = undefined;
    if (!holding) return;
    holding = false;
    const viewport = viewportOf();
    if (viewport) {
      viewport.style.willChange = "";
      delete viewport.dataset.held;
    }
    moved();
  };
  /** The canvas moves: its layers are held, and the hold is renewed. */
  const engage = () => {
    if (gone) return;
    if (!holding) {
      const viewport = viewportOf();
      if (!viewport) return;
      holding = true;
      viewport.style.willChange = "transform";
      viewport.dataset.held = "";
    }
    clearTimeout(held);
    held = setTimeout(letGo, HELD_MS);
  };
  const hidden = () => {
    if (document.visibilityState === "hidden") letGo();
  };
  const events = ["transitionend", "transitioncancel", "animationend", "animationcancel"];
  for (const name of events) root.addEventListener(name, moved, true);
  // A wheel step arrives before the move it causes, so the layers exist for its first frame.
  const dragging = (event: PointerEvent) => {
    if (event.buttons) engage();
  };
  root.addEventListener("wheel", engage, { passive: true });
  root.addEventListener("pointermove", dragging, { passive: true });
  document.addEventListener("visibilitychange", hidden);
  return {
    moved,
    engage,
    destroy() {
      gone = true;
      clearTimeout(timer);
      clearTimeout(held);
      for (const name of events) root.removeEventListener(name, moved, true);
      root.removeEventListener("wheel", engage);
      root.removeEventListener("pointermove", dragging);
      document.removeEventListener("visibilitychange", hidden);
    },
  };
}
