import { expect, test } from "vitest";
import { boardLayout, type LayoutBlock } from "../lib/board/layout";
import { RUN, placeRun, type RunInputs } from "../lib/run/layout";
import { TEXT_LIMIT } from "../lib/canvas-model";
import { partSize } from "../lib/run/part-size";

const row = (id: string, height: number, phase?: number) => ({
  part: { id, width: 240, height },
  found: [],
  feeds: true,
  ...(phase === undefined ? {} : { phase }),
});
const run = (rows: RunInputs["rows"], result: number): RunInputs => ({
  request: { id: "request", width: RUN.request, height: 80 },
  rows,
  head: { id: "head", width: 640, height: 40 },
  board: { width: 640, height: result, at: { body: { x: 0, y: 0, width: 640, height: result } } },
});

// The run's top: the request, the first row of every column and the result's headline share it.
function topped(place: ReturnType<typeof placeRun>, ids: string[]) {
  expect(place.rects["request"]!.y).toBe(100);
  expect(place.corner.y).toBe(place.rects[ids[0]!]!.y + RUN.labelMid - RUN.resultMid);
  for (const id of ids) expect(place.rects[id]!.y).toBe(place.rects[ids[0]!]!.y);
}

test("a run with one column begins at its top and its result starts level with the first row", () => {
  const place = placeRun(100, run([row("a", 120), row("b", 120)], 300));
  topped(place, ["a"]);
  expect(place.rects["head"]!.y).toBe(place.corner.y);
});

test("a tall left side does not move the request or the result down", () => {
  const short = placeRun(100, run([row("a", 120)], 100));
  const tall = placeRun(
    100,
    run(
      [row("a", 400, 0), row("b", 400, 0), row("c", 400, 0), row("d", 120, 1), row("e", 120, 1)],
      100,
    ),
  );
  topped(tall, ["a", "d"]);
  expect(tall.corner.y).toBe(short.corner.y);
  expect(tall.rects["request"]!.y).toBe(short.rects["request"]!.y);
  // Later steps stand further right.
  expect(tall.rects["d"]!.x).toBeGreaterThan(tall.rects["a"]!.x + 240);
  expect(tall.corner.x).toBeGreaterThan(tall.rects["d"]!.x + 240);
});

test("a tall result grows down and leaves the left side where it was", () => {
  const short = placeRun(100, run([row("a", 120), row("b", 120)], 100));
  const tall = placeRun(100, run([row("a", 120), row("b", 120)], 1800));
  expect(tall.rects["a"]).toEqual(short.rects["a"]);
  expect(tall.rects["b"]).toEqual(short.rects["b"]);
  expect(tall.rects["request"]).toEqual(short.rects["request"]);
  expect(tall.corner.y).toBe(short.corner.y);
  expect(tall.extent).toBeGreaterThan(short.extent + 1500);
});

const block = (id: string, kind: string, ideal: number, max = ideal): LayoutBlock => ({
  id,
  kind,
  emphasis: id === "wide" ? "hero" : "primary",
  width: { min: Math.min(ideal, 480), ideal, max },
  height: () => 200,
});

test("a wide object stands at the result's left edge at the width it draws at", () => {
  const narrow = boardLayout([block("wide", "diagram", 520), block("text", "prose", 640, 680)]);
  expect(narrow.at["wide"]).toMatchObject({ x: 0, width: 520 });
  expect(narrow.at["text"]!.x).toBe(0);
  const wide = boardLayout([block("wide", "diagram", 1500), block("text", "prose", 640, 680)]);
  expect(wide.at["wide"]).toMatchObject({ x: 0, width: 1500 });
  expect(wide.width).toBe(1500);
});

test("a row whose column is not known yet stands in the newest column", () => {
  const rows = [row("a", 120, 0), row("b", 120, 1), row("c", 120)];
  const place = placeRun(100, run(rows, 100));
  expect(place.rects["c"]!.x).toBe(place.rects["b"]!.x);
});

type Box = { x: number; y: number; width: number; height: number };
// A segment crosses a rect when it passes through its interior.
const crosses = (a: { x: number; y: number }, b: { x: number; y: number }, r: Box) =>
  Math.min(a.x, b.x) < r.x + r.width &&
  Math.max(a.x, b.x) > r.x &&
  Math.min(a.y, b.y) < r.y + r.height &&
  Math.max(a.y, b.y) > r.y;

function crossings(place: ReturnType<typeof placeRun>) {
  const hits: string[] = [];
  for (const line of place.lines)
    for (let at = 1; at < line.points.length; at++)
      for (const [id, rect] of Object.entries(place.rects))
        if (crosses(line.points[at - 1]!, line.points[at]!, rect)) hits.push(`${line.id} x ${id}`);
  return hits;
}

const found = (id: string) => ({ id, width: 280, height: 140 });

test("no line crosses a card, in columns of parallel and sequential work", () => {
  const rows = [
    { ...row("a", 220, 0), found: [found("a1"), found("a2")] },
    row("b", 140, 0),
    row("c", 300, 1),
    { ...row("d", 160, 1), found: [found("d1")] },
    row("e", 120, 1),
    row("f", 200, 2),
  ];
  expect(crossings(placeRun(100, run(rows, 300)))).toEqual([]);
});

test("no line crosses a card when the last column feeds nothing", () => {
  const rows = [row("a", 220, 0), row("b", 140, 1), row("c", 200, 1)];
  const nothing = rows.map((entry) => ({ ...entry, feeds: entry.part.id === "a" }));
  expect(crossings(placeRun(100, run(nothing, 300)))).toEqual([]);
  expect(crossings(placeRun(100, run(rows, 300)))).toEqual([]);
});

test("no line crosses a card in a run with inputs, a single column or no parts", () => {
  const withInputs = {
    ...run([row("a", 120), row("b", 300)], 200),
    inputs: [
      { id: "i1", width: RUN.inputs, height: 60 },
      { id: "i2", width: RUN.inputs, height: 60 },
    ],
  };
  expect(crossings(placeRun(0, withInputs))).toEqual([]);
  expect(crossings(placeRun(0, run([], 200)))).toEqual([]);
});

// Ids as a real run names its cards: a request, its parts, and the result.
const card = "request:01KP3Q4ZK2W8N6V0R4T7Y9B1CD:01KP3Q5A8H0J2M4P6R8T0V2X4Z";
const partId = (key: string) => `part:${card}:${key}`;

test("every column joins the next and the last joins the result, under the canvas's id limit", () => {
  const search = partId("search:01KP3Q5A8H0J2M4P6R8T0V2X4Z");
  const read = partId("lead:01KP3Q5A8H0J2M4P6R8T0V2X4Z");
  const stay = partId("01KP3Q6B9J1K3N5Q7S9V1W3Y5A");
  const flights = partId("01KP3Q6B9J1K3N5Q7S9V1W3Y5B");
  const last = partId("01KP3Q7C0K2M4P6R8T0V2X4Z6B");
  // The page opened from the search stands under it and carries its work on.
  const columns = [[read], [stay, flights], [last]];
  const rows = [
    row(search, 160, 0),
    { ...row(read, 240, 0), after: search },
    { ...row(stay, 120, 1), found: [found(`object:${stay}:1`), found(`object:${stay}:2`)] },
    row(flights, 200, 1),
    row(last, 120, 2),
  ];
  const place = placeRun(0, {
    ...run(rows, 300),
    request: { id: card, width: RUN.request, height: 80 },
  });
  const owner = (id: string) =>
    rows.find((entry) => entry.part.id === id || entry.found.some((f) => f.id === id));
  const joins = (source: string, target: string) =>
    place.lines.some(
      (line) => (owner(line.source)?.part.id ?? line.source) === source && line.target === target,
    );
  for (const line of place.lines) expect(line.id.length).toBeLessThanOrEqual(TEXT_LIMIT.id);
  expect(new Set(place.lines.map((line) => line.id)).size).toBe(place.lines.length);
  expect(joins(card, search)).toBe(true);
  expect(joins(card, read)).toBe(false);
  expect(joins(search, read)).toBe(true);
  expect(place.rects[read]!.x).toBe(place.rects[search]!.x);
  expect(place.rects[read]!.y).toBeGreaterThan(place.rects[search]!.y + 160);
  columns.slice(1).forEach((ids, index) => {
    for (const target of ids)
      for (const source of columns[index]!) expect(joins(source, target)).toBe(true);
  });
  expect(
    place.lines.some((line) => line.target === stay && owner(line.source)?.part.id === search),
  ).toBe(false);
  expect(place.lines.some((line) => line.kind === "feed")).toBe(true);
  expect(crossings(place)).toEqual([]);
});

test("a part with many pages keeps one stack, and nothing it found or that follows lies over it", () => {
  const pages = (id: string, count: number) => ({
    part: { id, ...partSize({ kind: "pages", count }) },
    found: [] as { id: string; width: number; height: number }[],
    feeds: true,
    phase: 0,
  });
  const rows = [
    { ...pages("arena", 1), found: [{ id: "arena-board", width: 640, height: 420 }] },
    { ...pages("dribbble", 8), found: [{ id: "dribbble-board", width: 880, height: 1400 }] },
    { ...pages("later", 2), phase: 1 },
  ];
  const place = placeRun(0, {
    ...run(rows, 300),
    sources: { id: "sources", width: 560, height: 240 },
  });
  const boxes = Object.entries(place.rects);
  const hits: string[] = [];
  for (const [index, [a, ra]] of boxes.entries())
    for (const [b, rb] of boxes.slice(index + 1))
      if (crosses({ x: ra.x, y: ra.y }, { x: ra.x + ra.width, y: ra.y + ra.height }, rb))
        hits.push(`${a} x ${b}`);
  expect(hits).toEqual([]);
  expect(crossings(place)).toEqual([]);
});
