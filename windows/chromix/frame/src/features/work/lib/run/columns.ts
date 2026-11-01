import type { RunPart } from "./parts";

/** When a part worked, as far as the run knows: its facts' times, else only the lead's turn that began it. */
export type Span = {
  turn?: number;
  /** Unix epoch milliseconds. */
  began?: number;
  /** Absent while it still works: it then overlaps everything that begins after it. */
  ended?: number;
  /** Still working or about to: it has no end to wait for. */
  open?: boolean;
  /** The span it follows on from, by index: when that is the work just before it, it stands under it. */
  under?: number;
};

type Column = { end: number; low: number; high: number };

/**
 * The column each span stands in, left to right from 0. Work that overlapped
 * in time stands together; a new column begins only with work that started
 * after everything in the column had ended, so parallel work reads as parallel.
 * A span that follows straight on from the one it builds on stands under it.
 * A span without times follows the lead's turns instead, and one that has
 * neither joins the newest column rather than the first.
 */
export function columnsOf(spans: readonly Span[]): number[] {
  const timed = spans
    .map((span, index) => ({ span, index }))
    .filter(({ span }) => span.began !== undefined)
    .sort((a, b) => a.span.began! - b.span.began! || a.index - b.index);
  const columns: Column[] = [];
  const placed = new Map<number, number>();
  let previous: number | undefined;
  for (const { span, index } of timed) {
    const end = span.open ? Infinity : (span.ended ?? span.began!);
    const turn = span.turn ?? 0;
    const column = columns.at(-1);
    if (
      column &&
      (span.began! < column.end || (span.under !== undefined && span.under === previous))
    ) {
      column.end = Math.max(column.end, end);
      column.low = Math.min(column.low, turn);
      column.high = Math.max(column.high, turn);
    } else columns.push({ end, low: turn, high: turn });
    placed.set(index, columns.length - 1);
    previous = index;
  }
  // Without times the lead's turn places it: beside timed work of its own turn, else between the columns it falls after and before.
  const places = spans.map((span, index) => {
    if (placed.has(index)) return placed.get(index)!;
    const turn = span.turn;
    if (turn === undefined) return Infinity;
    const same = columns.findIndex((column) => column.low <= turn && turn <= column.high);
    if (same >= 0) return same;
    // Between two columns, later turns after earlier ones.
    return columns.filter((column) => column.high < turn).length - 0.5 + (turn / (turn + 1)) * 0.4;
  });
  const order = [...new Set(places.filter((place) => place !== Infinity))].sort((a, b) => a - b);
  return places.map((place) =>
    place === Infinity ? Math.max(0, order.length - 1) : order.indexOf(place),
  );
}

/** The column each of a run's parts stands in. */
export function partColumns(parts: readonly RunPart[]): number[] {
  return columnsOf(
    parts.map((part) => {
      const under = part.follows ? parts.findIndex((other) => other.id === part.follows) : -1;
      return {
        ...(part.turn !== undefined ? { turn: part.turn } : {}),
        ...(part.began !== undefined ? { began: part.began } : {}),
        ...(part.ended !== undefined ? { ended: part.ended } : {}),
        ...(under >= 0 ? { under } : {}),
        open: part.ended === undefined && !["done", "failed", "stopped"].includes(part.state),
      };
    }),
  );
}
