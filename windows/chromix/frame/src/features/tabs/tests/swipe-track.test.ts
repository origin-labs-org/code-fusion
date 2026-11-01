import { describe, expect, it } from "vitest";
import { SwipeTracker, rubberBand, type Reading } from "../lib/swipe-track";

const open = { extent: () => 240, canStep: () => true };

/** Wheel events a frame apart, `count` of them from `start`. */
function feed(
  tracker: SwipeTracker,
  deltas: number[],
  { dy = 0, start = 0, frame = 16 } = {},
): { readings: Reading[]; end: number } {
  const readings: Reading[] = [];
  let time = start;
  for (const dx of deltas) {
    readings.push(tracker.wheel(dx, dy, time));
    time += frame;
  }
  return { readings, end: time };
}

const last = (readings: Reading[]) => readings[readings.length - 1]!;

describe("a sideways swipe", () => {
  it("follows the fingers one to one", () => {
    const tracker = new SwipeTracker(open);
    const { readings } = feed(tracker, [4, 4, 4, 4, 4]);
    expect(last(readings)).toEqual({ kind: "track", offset: 20 });
    expect(tracker.tracking).toBe(true);
  });

  it("commits once the list has travelled far enough, and only once", () => {
    const tracker = new SwipeTracker(open);
    const { readings } = feed(tracker, Array(30).fill(-6));
    const commits = readings.filter((reading) => reading.kind === "commit");
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({ step: 1 });
    expect(tracker.tracking).toBe(false);
    // The rest, momentum included, is spoken for.
    expect(readings.slice(readings.indexOf(commits[0]!) + 1).every((r) => r.kind === "none")).toBe(
      true,
    );
  });

  it("steps back when the fingers move right", () => {
    const tracker = new SwipeTracker(open);
    const { readings } = feed(tracker, Array(30).fill(6));
    expect(readings.find((reading) => reading.kind === "commit")).toMatchObject({ step: -1 });
  });

  it("springs back when the fingers lift short of the distance and slow", () => {
    const tracker = new SwipeTracker(open);
    feed(tracker, [3, 3, 2, 1, 1, 0.5, 0.5]);
    expect(tracker.idle()).toMatchObject({ kind: "cancel" });
    expect(tracker.tracking).toBe(false);
  });

  it("commits a short flick that lifts at speed", () => {
    const tracker = new SwipeTracker(open);
    feed(tracker, [-9, -12, -14]);
    expect(tracker.idle()).toMatchObject({ kind: "commit", step: 1 });
  });

  it("ignores a gesture that is not clearly sideways", () => {
    const tracker = new SwipeTracker(open);
    const { readings } = feed(tracker, Array(20).fill(10), { dy: 8 });
    expect(readings.every((reading) => reading.kind === "none")).toBe(true);
    expect(tracker.tracking).toBe(false);
    expect(tracker.idle()).toEqual({ kind: "none" });
  });

  it("leaves vertical scrolling alone, and its momentum", () => {
    const tracker = new SwipeTracker(open);
    const { readings, end } = feed(tracker, Array(40).fill(1), { dy: 20 });
    expect(readings.every((reading) => reading.kind === "none")).toBe(true);
    // A sideways flick arriving inside the momentum is not mistaken for it
    // until the events go quiet.
    expect(feed(tracker, [2, 2, 2], { dy: 1, start: end }).readings.at(-1)).toEqual({
      kind: "none",
    });
  });

  it("starts afresh after the events go quiet", () => {
    const tracker = new SwipeTracker(open);
    const first = feed(tracker, Array(30).fill(-6));
    expect(first.readings.some((reading) => reading.kind === "commit")).toBe(true);
    const second = feed(tracker, [5, 5, 5], { start: first.end + 300 });
    expect(last(second.readings)).toMatchObject({ kind: "track" });
  });

  it("takes a fresh touch inside the previous gesture's momentum", () => {
    const tracker = new SwipeTracker(open);
    const first = feed(tracker, Array(30).fill(-6));
    const decay = feed(tracker, [-3, -2, -1.5, -1], { start: first.end });
    expect(decay.readings.every((reading) => reading.kind === "none")).toBe(true);
    const touch = feed(tracker, [30, 30], { start: decay.end });
    expect(last(touch.readings)).toMatchObject({ kind: "track" });
  });
});

/** The fingers as native reports them: landing, travel a frame apart, lifting. */
function touch(tracker: SwipeTracker, deltas: number[], { dy = 0, start = 0, frame = 16 } = {}) {
  tracker.begin();
  let time = start;
  const readings: Reading[] = [];
  for (const dx of deltas) {
    readings.push(tracker.move(dx, dy, time));
    time += frame;
  }
  return { readings, end: time };
}

describe("a swipe read from the fingers", () => {
  it("follows them and springs home when they lift short and slow", () => {
    const tracker = new SwipeTracker(open);
    const { readings } = touch(tracker, [3, 3, 2, 1, 1, 0.5, 0.5]);
    expect(last(readings)).toMatchObject({ kind: "track" });
    expect(tracker.lift()).toMatchObject({ kind: "cancel" });
    expect(tracker.tracking).toBe(false);
  });

  it("commits a short flick the moment the fingers lift, without waiting for quiet", () => {
    const tracker = new SwipeTracker(open);
    touch(tracker, [-9, -12, -14]);
    expect(tracker.lift()).toMatchObject({ kind: "commit", step: 1 });
  });

  it("commits once past the distance while the fingers are still down, and then lets go", () => {
    const tracker = new SwipeTracker(open);
    const { readings } = touch(tracker, Array(30).fill(-6));
    expect(readings.filter((reading) => reading.kind === "commit")).toHaveLength(1);
    expect(tracker.lift()).toEqual({ kind: "none" });
  });

  it("starts a new gesture the moment fingers land, even right after a commit", () => {
    const tracker = new SwipeTracker(open);
    const first = touch(tracker, Array(30).fill(-6));
    tracker.lift();
    // No gap, no quiet: the next swipe is simply the next swipe.
    const second = touch(tracker, [5, 5, 5], { start: first.end + 4 });
    expect(last(second.readings)).toMatchObject({ kind: "track", offset: 15 });
    expect(tracker.lift()).toMatchObject({ kind: "cancel" });
  });

  it("starts over when fingers land again before the last lift was heard", () => {
    const tracker = new SwipeTracker(open);
    touch(tracker, [4, 4, 4]);
    expect(tracker.tracking).toBe(true);
    const next = touch(tracker, [-5, -5]);
    expect(last(next.readings)).toMatchObject({ kind: "track", offset: -10 });
  });

  it("ignores travel that arrives with no fingers down", () => {
    const tracker = new SwipeTracker(open);
    expect(tracker.move(40, 0, 0)).toEqual({ kind: "none" });
    expect(tracker.lift()).toEqual({ kind: "none" });
  });

  it("leaves a vertical gesture alone through to its lift", () => {
    const tracker = new SwipeTracker(open);
    const { readings } = touch(tracker, Array(20).fill(1), { dy: 20 });
    expect(readings.every((reading) => reading.kind === "none")).toBe(true);
    expect(tracker.lift()).toEqual({ kind: "none" });
  });

  it("can be cancelled by the lift before it was judged", () => {
    const tracker = new SwipeTracker(open);
    touch(tracker, [1, 1]);
    expect(tracker.lift()).toEqual({ kind: "none" });
  });
});

describe("where there is no space to go to", () => {
  const first = { extent: () => 240, canStep: (step: 1 | -1) => step === -1 };

  it("resists, and never commits", () => {
    const tracker = new SwipeTracker(first);
    const { readings } = feed(tracker, Array(30).fill(-8));
    expect(readings.some((reading) => reading.kind === "commit")).toBe(false);
    const drawn = last(readings);
    expect(drawn.kind).toBe("track");
    if (drawn.kind === "track") {
      expect(Math.abs(drawn.offset)).toBeGreaterThan(10);
      expect(Math.abs(drawn.offset)).toBeLessThan(120);
    }
    expect(tracker.idle()).toMatchObject({ kind: "cancel" });
  });

  it("still commits the other way", () => {
    const tracker = new SwipeTracker(first);
    const { readings } = feed(tracker, Array(30).fill(6));
    expect(readings.find((reading) => reading.kind === "commit")).toMatchObject({ step: -1 });
  });
});

describe("rubberBand", () => {
  it("is nothing at rest, falls off and never reaches its limit", () => {
    expect(rubberBand(0, 240)).toBe(0);
    const small = rubberBand(-20, 240);
    const large = rubberBand(-400, 240);
    expect(small).toBeLessThan(0);
    expect(Math.abs(small)).toBeLessThan(20);
    expect(Math.abs(large)).toBeLessThan(120);
    expect(Math.abs(large)).toBeGreaterThan(Math.abs(small));
    expect(rubberBand(60, 240)).toBeGreaterThan(0);
  });
});
