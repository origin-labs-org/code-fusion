import { expect, test } from "vitest";
import { CLEARANCE, dropSpot, touches } from "../lib/free-space";
import { environmentStages, ownPlaces } from "../lib/project-environment-board";
import { reconcileNodes, type CanvasItem } from "../lib/canvas-model";
import { projection, snapshot } from "./environment-fixtures";

const objectives = () => new Map([["objective", structuredClone(projection)]]);
const cards = (stage: ReturnType<typeof environmentStages>[number]) =>
  Object.values(stage.lane.rects);
const NOTE = { width: 280, height: 160 };

test("a drop in a run's empty room stays exactly where it was put", () => {
  const [stage] = environmentStages(snapshot, objectives());
  const box = stage!.lane.box;
  // Under the request, inside the run's box but on none of its cards.
  const request = stage!.lane.rects["objective-card"]!;
  const rect = { x: request.x, y: request.y + request.height + 120, ...NOTE };
  expect(touches(rect, [box], 0)).toBe(true);
  expect(dropSpot(rect, cards(stage!))).toBeNull();
});

test("a drop on a run's card is put at the nearest spot clear of every card", () => {
  const [stage] = environmentStages(snapshot, objectives());
  const result = stage!.lane.rects["result-card"]!;
  const rect = { x: result.x + 20, y: result.y + 10, ...NOTE };
  const spot = dropSpot(rect, cards(stage!));
  expect(spot).not.toBeNull();
  expect(touches({ ...spot!, ...NOTE }, cards(stage!))).toBe(false);
  // Near where it was dropped, not across the canvas.
  expect(Math.hypot(spot!.x - rect.x, spot!.y - rect.y)).toBeLessThan(800);
});

test("a run starts below the person's thing it would cover, and the thing stays put", () => {
  const [free] = environmentStages(snapshot, objectives());
  const request = free!.lane.rects["objective-card"]!;
  const note = { x: request.x + 40, y: request.y + 20, ...NOTE };
  const [moved] = environmentStages(snapshot, objectives(), { around: { note } });
  const lane = moved!.lane;
  expect(lane.box.y).toBeGreaterThanOrEqual(note.y + note.height + CLEARANCE);
  expect(touches(note, Object.values(lane.rects))).toBe(false);
  // A thing in the run's empty room leaves the run where it was.
  const aside = { x: request.x, y: request.y + request.height + 200, ...NOTE };
  const [kept] = environmentStages(snapshot, objectives(), { around: { aside } });
  expect(kept!.lane.box.y).toBe(free!.lane.box.y);
});

test("the person's placed things keep their places, whatever the runs cover", () => {
  const stages = environmentStages(snapshot, objectives());
  const box = stages[0]!.lane.box;
  const inside = { x: box.x + 10, y: box.y + 10 };
  const placed = ownPlaces({ note: inside }, { note: NOTE }, stages);
  expect(placed.note).toEqual(inside);
});

test("a thing with no place yet lands in free room near the view, clear of the runs", () => {
  const stages = environmentStages(snapshot, objectives());
  const box = stages[0]!.lane.box;
  const near = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const placed = ownPlaces(
    { note: { x: box.x + box.width + 400, y: box.y } },
    { note: NOTE, link: NOTE },
    stages,
    ["link"],
    near,
  );
  const link = { ...placed.link!, ...NOTE };
  expect(touches(link, [box, { ...placed.note!, ...NOTE }])).toBe(false);
  // Without a view, the column left of every run, where no run grows.
  const column = ownPlaces({}, { link: NOTE }, stages, ["link"]);
  expect(column.link!.x + NOTE.width).toBeLessThan(box.x);
});

test("a card the person moved is not put back when a late save of an older place lands", () => {
  const item: CanvasItem = { id: "note", title: "Note", kind: "", detail: "", status: "" };
  const first = reconcileNodes([], [item], { note: { x: 0, y: 0 } });
  // Dropped at 400,0, then at 800,0 before the first save came back: the view the canvas
  // is given is the newest arrangement, so the first save's landing changes nothing.
  const dropped = [{ ...first[0]!, position: { x: 800, y: 0 } }];
  const view = { note: { x: 800, y: 0 } };
  const after = reconcileNodes(dropped, [item], view, {}, [], {}, view);
  expect(after[0]!.position).toEqual({ x: 800, y: 0 });
});
