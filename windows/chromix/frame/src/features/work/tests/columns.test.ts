import { expect, test } from "vitest";
import type { WorkExecutionFact } from "$shared/ipc/bindings";
import { columnsOf, partColumns } from "../lib/run/columns";
import { runParts } from "../lib/run/parts";

test("work that overlapped in time stands in one column, whatever turn began it", () => {
  const columns = columnsOf([
    { turn: 1, began: 0, ended: 100 },
    { turn: 2, began: 1000, ended: 5000 },
    { turn: 3, began: 1200, ended: 3000 },
    { turn: 4, began: 1300, ended: 9000 },
  ]);
  expect(columns).toEqual([0, 1, 1, 1]);
});

test("a new column begins only with work that started after the column had ended", () => {
  expect(
    columnsOf([
      { began: 0, ended: 10 },
      { began: 5, ended: 20 },
      { began: 20, ended: 30 },
      { began: 25, ended: 26 },
    ]),
  ).toEqual([0, 0, 1, 1]);
});

test("work that still runs overlaps everything that starts after it", () => {
  expect(
    columnsOf([
      { began: 0, open: true },
      { began: 50, ended: 60 },
      { began: 70, open: true },
    ]),
  ).toEqual([0, 0, 0]);
});

test("work without times follows the lead's turns", () => {
  expect(columnsOf([{ turn: 3 }, { turn: 1 }, { turn: 2 }, { turn: 1 }])).toEqual([2, 0, 1, 0]);
});

test("untimed work stands beside timed work of its own turn", () => {
  expect(
    columnsOf([
      { turn: 1 },
      { turn: 2, began: 0, ended: 10 },
      { turn: 2 },
      { turn: 3, began: 20, ended: 30 },
    ]),
  ).toEqual([0, 1, 1, 2]);
});

test("a part not yet placed joins the newest column, never the first", () => {
  expect(columnsOf([{ turn: 1 }, { turn: 2 }, {}])).toEqual([0, 1, 1]);
  expect(columnsOf([{ began: 0, ended: 5 }, { began: 10, ended: 15 }, { open: true }])).toEqual([
    0, 1, 1,
  ]);
  expect(columnsOf([{}])).toEqual([0]);
});

test("work that follows straight on from the search it opened stands under it", () => {
  // Search, then a page opened from its results, then two parts begun together.
  expect(
    columnsOf([
      { began: 0, ended: 0 },
      { began: 10, ended: 10, under: 0 },
      { began: 20, ended: 90 },
      { began: 21, ended: 60 },
    ]),
  ).toEqual([0, 0, 1, 1]);
  // Other work between them: the page stands where it began.
  expect(
    columnsOf([
      { began: 0, ended: 0 },
      { began: 5, ended: 8 },
      { began: 10, ended: 10, under: 0 },
    ]),
  ).toEqual([0, 1, 2]);
});

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** A ULID minted at `ms`, told apart by `tail`. */
function ulid(ms: number, tail: string): string {
  let time = "";
  for (let rest = ms, index = 0; index < 10; index++, rest = Math.floor(rest / 32))
    time = CROCKFORD[rest % 32] + time;
  return time + tail.padStart(16, "0");
}
const T = 1_790_000_000_000;
const TITLES = { search: "Search", unread: "Couldn’t open", computer: "This Mac" };

/** A trip run as the lead does it: a search, a page opened from it, then stay and flights at once. */
function trip(stage: "begun" | "started" | "done"): WorkExecutionFact {
  const yc = "https://www.ycombinator.com/apply";
  const part = (key: string, at: number, title: string) => ({
    id: ulid(at, key),
    title,
    helper: "browser",
    goal: title,
    state: stage === "done" ? "done" : stage === "started" ? "running" : "planned",
    ...(stage !== "begun" ? { started_ms: String(at + 5) } : {}),
    ...(stage === "done" ? { ended_ms: String(at + 60_000) } : {}),
  });
  return {
    id: "run",
    spec: {},
    status: stage === "done" ? "completed" : "running",
    attempts: [],
    artifacts: [],
    provider_evidence: [
      {
        id: "found",
        evidence: { citations: [{ url: yc, title: "Apply to YC" }] },
      },
    ],
    user_artifacts: [],
    steps: [
      {
        id: ulid(T, "S"),
        turn: 1,
        status: "succeeded",
        evidence: "found",
        kind: { kind: "search", query: "YC W27 dates" },
      },
      { id: ulid(T + 4_000, "R"), turn: 2, status: "succeeded", kind: { kind: "read", url: yc } },
      ...(stage === "begun"
        ? []
        : [
            {
              id: ulid(T + 20_000, "A"),
              turn: 3,
              part: ulid(T + 10_000, "STAY"),
              status: "running",
              kind: { kind: "read", url: "https://www.airbnb.com/s/sf" },
            },
          ]),
    ],
    parts: [part("STAY", T + 10_000, "Airbnb stay"), part("FLY", T + 10_001, "Flights")],
  } as unknown as WorkExecutionFact;
}

test("a part stands in its own column from the moment it appears, and never moves", () => {
  const placed = (stage: "begun" | "started" | "done") => {
    const parts = runParts("card", [trip(stage)], [], () => stage !== "done", TITLES);
    const columns = partColumns(parts);
    return Object.fromEntries(parts.map((part, index) => [part.title, columns[index]]));
  };
  const expected = { Search: 0, "Y Combinator": 0, "Airbnb stay": 1, Flights: 1 };
  expect(placed("begun")).toEqual(expected);
  expect(placed("started")).toEqual(expected);
  expect(placed("done")).toEqual(expected);
});
