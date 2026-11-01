type Rect = { x: number; y: number; width: number; height: number };
type Point = { x: number; y: number };

const STEP = 24;
const RINGS = 40;

/**
 * How near the person's own thing may stand to a run's card. A run keeps this
 * far from the person's things, and a drop nearer than this is put clear, so
 * the two rules never disagree about where something may stand.
 */
export const CLEARANCE = 16;

const clear = (a: Rect, taken: readonly Rect[], gap: number) =>
  taken.every(
    (b) =>
      a.x + a.width + gap <= b.x ||
      b.x + b.width + gap <= a.x ||
      a.y + a.height + gap <= b.y ||
      b.y + b.height + gap <= a.y,
  );

/** Whether `rect` comes nearer than `gap` to anything taken. */
export const touches = (rect: Rect, taken: readonly Rect[], gap = CLEARANCE) =>
  !clear(rect, taken, gap);

/**
 * The nearest place to `want` (the thing's centre) where a thing of `size`
 * touches nothing taken, `gap` apart, on an 8 px grid: rings outward on a
 * 24 px step, the nearest free spot of the first ring that has one. Where
 * nothing is free nearby, the spot just under everything taken.
 */
export function freeSpot(
  want: Point,
  size: { width: number; height: number },
  taken: readonly Rect[],
  gap = 32,
): Point {
  const snap = (value: number) => Math.round(value / 8) * 8;
  const at = (x: number, y: number): Rect => ({
    x: snap(x - size.width / 2),
    y: snap(y - size.height / 2),
    ...size,
  });
  const centre = (rect: Rect) => ({ x: rect.x + size.width / 2, y: rect.y + size.height / 2 });
  if (clear(at(want.x, want.y), taken, gap)) return centre(at(want.x, want.y));
  for (let ring = 1; ring <= RINGS; ring += 1) {
    let best: { rect: Rect; distance: number } | null = null;
    for (let i = -ring; i <= ring; i += 1)
      for (const [dx, dy] of [
        [i, -ring],
        [i, ring],
        [-ring, i],
        [ring, i],
      ] as const) {
        const rect = at(want.x + dx * STEP, want.y + dy * STEP);
        if (!clear(rect, taken, gap)) continue;
        const distance = Math.hypot(dx, dy);
        if (!best || distance < best.distance) best = { rect, distance };
      }
    if (best) return centre(best.rect);
  }
  const bottom = Math.max(want.y, ...taken.map((rect) => rect.y + rect.height));
  return centre(at(want.x, bottom + gap + size.height / 2));
}

/**
 * Where a thing the person dropped must stand instead, as its top-left: the
 * nearest free spot when it landed on or against something taken, else null,
 * and it stays exactly where it was put.
 */
export function dropSpot(rect: Rect, taken: readonly Rect[]): Point | null {
  if (!touches(rect, taken)) return null;
  const size = { width: rect.width, height: rect.height };
  const spot = freeSpot({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, size, taken);
  return { x: Math.round(spot.x - size.width / 2), y: Math.round(spot.y - size.height / 2) };
}
