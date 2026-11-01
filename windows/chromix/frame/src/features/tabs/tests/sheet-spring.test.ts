import { describe, expect, it } from "vitest";
import { advance, atRest, launch, type Motion } from "../lib/sheet-spring";

/** Runs the spring in 16ms frames until it rests, returning the path. */
function settle(motion: Motion, target: number) {
  const path: number[] = [];
  for (let frame = 0; frame < 200 && !atRest(motion, target); frame += 1) {
    advance(motion, target, 16);
    path.push(motion.x);
  }
  return path;
}

describe("the sheet's spring", () => {
  it("comes to rest on its target in about a quarter of a second", () => {
    const motion = { x: -90, v: 0 };
    const path = settle(motion, 0);
    expect(atRest(motion, 0)).toBe(true);
    expect(path.length * 16).toBeLessThan(450);
    expect(path.length * 16).toBeGreaterThan(80);
  });

  it("barely overshoots, from rest or at speed", () => {
    for (const v of [0, -1.2, 1.5]) {
      const motion = { x: -120, v };
      const path = settle(motion, 0);
      expect(Math.max(...path)).toBeLessThan(12);
    }
  });

  it("carries the speed it was handed", () => {
    const still = { x: -100, v: 0 };
    const thrown = { x: -100, v: 1.2 };
    advance(still, 0, 16);
    advance(thrown, 0, 16);
    expect(thrown.x).toBeGreaterThan(still.x);
  });

  it("is the same whatever the frame rate", () => {
    const slow = { x: -200, v: 0.4 };
    const fast = { x: -200, v: 0.4 };
    for (let at = 0; at < 160; at += 32) advance(slow, 0, 32);
    for (let at = 0; at < 160; at += 8) advance(fast, 0, 8);
    expect(Math.abs(slow.x - fast.x)).toBeLessThan(3);
  });

  it("is not thrown by a stalled frame", () => {
    const motion = { x: -100, v: 0 };
    advance(motion, 0, 5000);
    expect(Math.abs(motion.x)).toBeLessThanOrEqual(100);
  });

  it("limits how fast a release may launch it", () => {
    expect(launch(50)).toBe(3);
    expect(launch(-50)).toBe(-3);
    expect(launch(0.7)).toBe(0.7);
  });

  it("is only at rest when both still and there", () => {
    expect(atRest({ x: 0.1, v: 0 }, 0)).toBe(true);
    expect(atRest({ x: 0.1, v: 0.5 }, 0)).toBe(false);
    expect(atRest({ x: 20, v: 0 }, 0)).toBe(false);
  });
});
