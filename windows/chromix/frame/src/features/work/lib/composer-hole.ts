const n = (value: number) => Math.round(value * 100) / 100;

const EASE = 0.56;

type Card = { width: number; height: number };
type Bar = { left: number; top: number; width: number };

/** The composer's outline from the window's foot up its right wall, over its top and down its left. */
function outline(card: Card, bar: Bar, radius: number, flare: number) {
  const { left: x, top: y, width: w } = bar;
  const r = Math.max(0, Math.min(radius, w / 2));
  const foot = card.height;
  const f = Math.max(0, Math.min(flare, foot - y - r, x, card.width - x - w));
  const right = x + w;
  // A fillet with its curvature eased in, the way a continuous corner meets a
  // straight edge, rather than a circular arc's sudden turn.
  const k = f * (1 - EASE);
  return {
    from: n(right + f),
    foot: n(foot),
    trace:
      `C${n(right + k)} ${n(foot)} ${n(right)} ${n(foot - k)} ${n(right)} ${n(foot - f)}` +
      `V${n(y + r)}A${n(r)} ${n(r)} 0 0 0 ${n(right - r)} ${n(y)}H${n(x + r)}` +
      `A${n(r)} ${n(r)} 0 0 0 ${n(x)} ${n(y + r)}V${n(foot - f)}` +
      `C${n(x)} ${n(foot - k)} ${n(x - k)} ${n(foot)} ${n(x - f)} ${n(foot)}`,
  };
}

/**
 * A clip path for the canvas card with a hole the shape of the composer: round
 * at the top, and where its walls meet the window's foot (`card.height`, which
 * may lie below the card) the hole widens into them on a fillet, as the new
 * tab's notch does at the window's edge.
 */
export function composerHole(card: Card, bar: Bar, radius: number, flare: number): string {
  const { from, foot, trace } = outline(card, bar, radius, flare);
  return `path("M0 0H${n(card.width)}V${foot}H${from}${trace}H0Z")`;
}

/** The same outline as an open path, for the hairline and the sheet's fill. */
export function composerEdge(card: Card, bar: Bar, radius: number, flare: number): string {
  const { from, foot, trace } = outline(card, bar, radius, flare);
  return `M${from} ${foot}${trace}`;
}
