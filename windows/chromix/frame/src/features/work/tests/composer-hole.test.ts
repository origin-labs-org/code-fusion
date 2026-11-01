import { expect, test } from "vitest";
import { composerEdge, composerHole } from "../lib/composer-hole";

test("the hole follows the composer's width and the card turns up into its walls on a fillet", () => {
  const card = { width: 1000, height: 700 };
  expect(composerHole(card, { left: 150, top: 620, width: 700 }, 22, 18)).toBe(
    'path("M0 0H1000V700H868C857.92 700 850 692.08 850 682V642A22 22 0 0 0 828 620H172A22 22 0 0 0 150 642V682C150 692.08 142.08 700 132 700H0Z")',
  );
});

test("a corner is never larger than half the composer", () => {
  const path = composerHole({ width: 300, height: 300 }, { left: 10, top: 200, width: 20 }, 22, 0);
  expect(path).toContain("A10 10 0 0 0 20 200H20A10 10 0 0 0 10 210");
});

test("a fillet never runs past the card's side", () => {
  const path = composerHole({ width: 300, height: 300 }, { left: 6, top: 100, width: 200 }, 22, 18);
  expect(path).toContain("H212C208.64 300 206 297.36 206 294");
});

test("the edge is the hole's own outline, open at the foot", () => {
  const card = { width: 1000, height: 700 };
  const bar = { left: 150, top: 620, width: 700 };
  expect(composerEdge(card, bar, 22, 18)).toBe(
    "M868 700C857.92 700 850 692.08 850 682V642A22 22 0 0 0 828 620H172A22 22 0 0 0 150 642V682C150 692.08 142.08 700 132 700",
  );
  expect(composerHole(card, bar, 22, 18)).toContain(
    composerEdge(card, bar, 22, 18).slice(1 + "868 700".length),
  );
});
