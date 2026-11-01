import { describe, expect, it } from "vitest";
import { PICTURE, placeSky } from "../place";

describe("placeSky", () => {
  it("covers the page across with the picture's horizon on the page's", () => {
    const sky = placeSky(1200, 456);
    expect(sky.w).toBe(1200);
    expect(sky.x).toBe(0);
    expect(sky.y + PICTURE.horizon * sky.h).toBeCloseTo(456, 6);
    expect(sky.y).toBeLessThanOrEqual(0);
  });

  it("grows to reach the top of a tall pane and stays centred", () => {
    const sky = placeSky(700, 798);
    expect(sky.y).toBeLessThan(1e-9);
    expect(sky.w).toBeGreaterThan(700);
    expect(sky.x + sky.w / 2).toBeCloseTo(350, 6);
  });

  it("has nothing to lay before the page has a size", () => {
    expect(placeSky(0, 0)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});
