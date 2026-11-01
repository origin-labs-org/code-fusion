/** Where a sheet is and how fast it is going, in pixels and pixels per millisecond. */
export type Motion = { x: number; v: number };

/** Natural frequency per millisecond and damping ratio: settles in about a fifth of a second. */
const OMEGA = 0.022;
const ZETA = 0.92;
/** A step never integrates more than this at once, so a stalled frame cannot throw the sheet. */
const MAX_STEP = 32;
const SUBSTEP = 4;
const REST_DISTANCE = 0.4;
const REST_SPEED = 0.01;
/** The fastest a release may launch the sheet, per millisecond. */
const MAX_LAUNCH = 3;

export const launch = (velocity: number) => Math.max(-MAX_LAUNCH, Math.min(MAX_LAUNCH, velocity));

/**
 * Advances a critically-damped-ish spring towards `target` by `elapsed`
 * milliseconds, in place. Semi-implicit Euler in small substeps: stable at any
 * frame rate, and carrying whatever velocity the sheet already had, so a
 * gesture handed to the spring and one taken back from it both continue
 * rather than restart.
 */
export function advance(motion: Motion, target: number, elapsed: number): Motion {
  let left = Math.min(Math.max(elapsed, 0), MAX_STEP);
  while (left > 0) {
    const dt = Math.min(SUBSTEP, left);
    const force = -OMEGA * OMEGA * (motion.x - target) - 2 * ZETA * OMEGA * motion.v;
    motion.v += force * dt;
    motion.x += motion.v * dt;
    left -= dt;
  }
  return motion;
}

export const atRest = (motion: Motion, target: number) =>
  Math.abs(motion.x - target) < REST_DISTANCE && Math.abs(motion.v) < REST_SPEED;
