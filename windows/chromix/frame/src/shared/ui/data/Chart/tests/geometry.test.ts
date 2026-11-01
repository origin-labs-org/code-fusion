import { expect, test } from "vitest";
import { arcPath, band, barPath, linear, monotone, runs, sectorPath } from "../geometry";

test("a linear scale maps and inverts, and a flat domain lands mid-range", () => {
  const scale = linear([0, 40], [200, 0]);
  expect(scale(10)).toBe(150);
  expect(scale.invert(150)).toBe(10);
  expect(linear([5, 5], [0, 100])(5)).toBe(50);
});

test("bands share the range with gaps between them and half-gaps at the ends", () => {
  const bands = band(4, [0, 400], 0.25, 0.125);
  expect(bands.step).toBe(100);
  expect(bands.width).toBe(75);
  expect(bands.start(0)).toBe(12.5);
  expect(bands.start(3) + bands.width).toBe(387.5);
});

test("a monotone curve passes through every point and never overshoots a flat run", () => {
  const path = monotone([
    { x: 0, y: 10 },
    { x: 10, y: 10 },
    { x: 20, y: 0 },
  ]);
  expect(path.startsWith("M0,10C")).toBe(true);
  expect(path.endsWith(",20,0")).toBe(true);
  // The flat stretch keeps a zero tangent: its first control point stays level.
  expect(path).toContain("C3.33,10");
  expect(monotone([{ x: 1, y: 2 }])).toBe("M1,2");
});

test("gaps split a line into runs", () => {
  expect(runs([1, 2, null, 3, null, null, 4])).toEqual([[1, 2], [3], [4]]);
});

test("a bar rounds only its data end, a range both ends, a stack's inner part neither", () => {
  expect(barPath(0, 0, 20, 100, 6, "end", "up")).toBe(
    "M6,0H14A6,6 0 0 1 20,6V100H0V6A6,6 0 0 1 6,0Z",
  );
  expect(barPath(0, 0, 20, 100, 6, "none", "up")).toBe("M0,0H20V100H0V0Z");
  expect(barPath(0, 0, 100, 8, 6, "all", "right")).toContain("A4,4");
  expect(barPath(0, 0, 0, 10, 6, "end", "up")).toBe("");
});

test("arcs and sectors run clockwise from twelve o'clock", () => {
  expect(arcPath(50, 50, 40, 0, Math.PI / 2)).toBe("M50,10A40,40 0 0 1 90,50");
  const sector = sectorPath(50, 50, 30, 40, 0, Math.PI, 2);
  expect(sector.startsWith("M")).toBe(true);
  expect(sector.endsWith("Z")).toBe(true);
});
