export type SwipeStep = 1 | -1;

export type Reading =
  | { kind: "none" }
  /** Where the list is drawn: the fingers' travel, resisted where there is no space. */
  | { kind: "track"; offset: number }
  | { kind: "commit"; step: SwipeStep; offset: number; velocity: number }
  | { kind: "cancel"; offset: number };

/** Travel before the gesture's axis is judged. */
const PROBE = 6;
/** How much more sideways than vertical a gesture must be to count. */
const DOMINANCE = 2;
/** A gap this long between wheel events separates two gestures; momentum arrives every frame or so. */
const QUIET = 100;
/** Fast enough that lifting commits however short the travel. */
const FLICK = 0.45;
const FLICK_TRAVEL = 14;
const COMMIT_RATIO = 0.3;
const COMMIT_MIN = 56;
const COMMIT_MAX = 96;

/** How far past the end a gesture is allowed to draw the list, with the
 *  familiar rubber-band falloff. */
export function rubberBand(distance: number, extent: number): number {
  const limit = Math.min(extent * 0.5, 120);
  const magnitude = Math.abs(distance);
  return Math.sign(distance) * (1 - 1 / ((magnitude * 0.55) / limit + 1)) * limit;
}

const NONE: Reading = { kind: "none" };

type Phase = "idle" | "probe" | "track" | "spent" | "ignored";

type Options = {
  extent: () => number;
  canStep: (step: SwipeStep) => boolean;
};

/**
 * A trackpad swipe. Fingers travel is positive to the right. The first few
 * pixels judge the axis, and only a clearly sideways gesture is ours; the list
 * then follows the fingers one to one and commits once it has travelled far
 * enough, or when the fingers lift at speed.
 *
 * Native reports the fingers themselves: `begin` when they land, `move` for
 * their travel and `lift` when they leave. Momentum never reaches here, and
 * fingers landing mid-momentum simply begin again. Without native the page
 * sees only wheel deltas with no phase, momentum a frame apart until it
 * fades, and `wheel` has to tell a new gesture from the old one's tail by
 * the gaps and by a jump in strength. What follows a commit is ignored until
 * the next gesture begins.
 */
export class SwipeTracker {
  #options: Options;
  #phase: Phase = "idle";
  #sx = 0;
  #sy = 0;
  #offset = 0;
  #velocity = 0;
  #time = 0;
  #magnitude = 0;

  constructor(options: Options) {
    this.#options = options;
  }

  /** Whether the gesture is being followed, so a fallback timer is needed to learn the fingers left. */
  get tracking() {
    return this.#phase === "track";
  }

  /** Fingers landed: any gesture still running, its momentum included, is over. */
  begin() {
    this.#phase = "probe";
    this.#sx = 0;
    this.#sy = 0;
    this.#offset = 0;
    this.#velocity = 0;
  }

  /** Fingers travelled. Ignored unless a gesture has begun and is still ours. */
  move(dx: number, dy: number, time: number): Reading {
    if (this.#phase === "idle" || this.#phase === "spent" || this.#phase === "ignored") {
      return NONE;
    }
    const gap = time - this.#time;
    this.#time = time;
    this.#magnitude = Math.abs(dx);
    return this.#advance(dx, dy, gap);
  }

  /** Fingers lifted: the gesture commits or springs home. */
  lift(): Reading {
    return this.idle();
  }

  wheel(dx: number, dy: number, time: number): Reading {
    const gap = time - this.#time;
    const previous = this.#magnitude;
    this.#time = time;
    this.#magnitude = Math.abs(dx);

    if (this.#phase !== "idle" && gap > QUIET) this.#phase = "idle";
    if (this.#phase === "spent" || this.#phase === "ignored") {
      const sideways = Math.abs(dx) >= DOMINANCE * Math.abs(dy);
      if (!sideways || Math.abs(dx) <= previous * 2.2 + 8) return NONE;
      this.#phase = "idle";
    }
    if (this.#phase === "idle") this.begin();
    return this.#advance(dx, dy, gap);
  }

  #advance(dx: number, dy: number, gap: number): Reading {
    if (this.#phase === "probe") {
      this.#sx += dx;
      this.#sy += dy;
      if (Math.abs(this.#sx) + Math.abs(this.#sy) < PROBE) return NONE;
      if (Math.abs(this.#sx) < DOMINANCE * Math.abs(this.#sy)) {
        this.#phase = "ignored";
        return NONE;
      }
      this.#phase = "track";
      this.#offset = this.#sx;
      return this.#reading(gap, this.#sx, false);
    }
    this.#offset += dx;
    return this.#reading(gap, dx, true);
  }

  /** The wheel has gone quiet: the fingers lifted and any momentum faded. */
  idle(): Reading {
    const phase = this.#phase;
    const offset = this.#offset;
    const velocity = this.#velocity;
    this.#phase = "idle";
    this.#velocity = 0;
    if (phase !== "track") return NONE;
    const step: SwipeStep = offset < 0 ? 1 : -1;
    const flicked =
      Math.abs(velocity) >= FLICK &&
      Math.sign(velocity) === Math.sign(offset) &&
      Math.abs(offset) >= FLICK_TRAVEL;
    if (this.#options.canStep(step) && flicked) return { kind: "commit", step, offset, velocity };
    return { kind: "cancel", offset: this.#shown(offset) };
  }

  reset() {
    this.#phase = "idle";
    this.#velocity = 0;
    this.#offset = 0;
  }

  #commitDistance() {
    return Math.max(COMMIT_MIN, Math.min(COMMIT_MAX, this.#options.extent() * COMMIT_RATIO));
  }

  #shown(offset: number) {
    const step: SwipeStep = offset < 0 ? 1 : -1;
    return this.#options.canStep(step) ? offset : rubberBand(offset, this.#options.extent());
  }

  #reading(gap: number, dx: number, measured: boolean): Reading {
    if (measured) {
      const elapsed = Math.min(Math.max(gap, 1), 50);
      this.#velocity = this.#velocity * 0.6 + (dx / elapsed) * 0.4;
    }
    const offset = this.#offset;
    const step: SwipeStep = offset < 0 ? 1 : -1;
    if (this.#options.canStep(step) && Math.abs(offset) >= this.#commitDistance()) {
      this.#phase = "spent";
      return { kind: "commit", step, offset, velocity: this.#velocity };
    }
    return { kind: "track", offset: this.#shown(offset) };
  }
}
