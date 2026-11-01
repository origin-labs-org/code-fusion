import { expect, test } from "vitest";
import { cropOf, fitted, framing, moved, zoomed } from "../lib/avatar-crop";

test("a picture starts centred, just covering the window, and crops its middle square", () => {
  const wide = framing(1600, 900, 264);
  expect(fitted(wide).height).toBeCloseTo(264);
  expect(cropOf(wide)).toEqual({ x: 350, y: 0, side: 900 });
  const tall = framing(600, 800, 264);
  expect(cropOf(tall)).toEqual({ x: 0, y: 100, side: 600 });
});

test("dragging stops at the picture's edges", () => {
  const wide = framing(1600, 900, 264);
  expect(cropOf(moved(wide, 10_000, 10_000))).toEqual({ x: 0, y: 0, side: 900 });
  expect(cropOf(moved(wide, -10_000, -10_000))).toEqual({ x: 700, y: 0, side: 900 });
});

test("zooming keeps the middle in place, stays within one to three times, and shrinks the crop", () => {
  const square = framing(900, 900, 264);
  const closer = zoomed(square, 2);
  expect(cropOf(closer)).toEqual({ x: 225, y: 225, side: 450 });
  expect(zoomed(square, 10).zoom).toBe(3);
  expect(zoomed(square, 0.2).zoom).toBe(1);
  // Zooming back out after a move never leaves an edge showing.
  const back = zoomed(moved(closer, 300, 300), 1);
  expect(cropOf(back)).toEqual({ x: 0, y: 0, side: 900 });
});
