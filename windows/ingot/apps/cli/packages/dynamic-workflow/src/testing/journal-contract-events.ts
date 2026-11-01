

import { expect, it } from "vitest";
import type { JournalStorePort } from "../engine/index.js";
import { baseRun, logs } from "./journal-contract-helpers.js";

export function registerEventCases(factory: () => JournalStorePort): void {
  it("appends events with monotonic sequence and lists them in order", () => {
    const store = factory();
    store.createRun(baseRun("r1"));
    const a = store.appendEvent("r1", { type: "log", message: "one" });
    const b = store.appendEvent("r1", { type: "log", message: "two" });
    expect(a.sequence).toBe(0);
    expect(b.sequence).toBe(1);
    const events = store.listEvents("r1", { types: "all", reportItems: "all" });
    expect(events.map((e) => e.sequence)).toEqual([0, 1]);
    expect(events.map((e) => (e.event.type === "log" ? e.event.message : ""))).toEqual([
      "one",
      "two",
    ]);
  });

  it("stamps timeCreated on append and gives the same instant back on read", () => {
    const store = factory();
    store.createRun(baseRun("r1"));
    const before = Date.now();
    const appended = store.appendEvent("r1", { type: "log", message: "one" });
    const after = Date.now();
    expect(appended.timeCreated).toBeTypeOf("number");
    expect(appended.timeCreated!).toBeGreaterThanOrEqual(before);
    expect(appended.timeCreated!).toBeLessThanOrEqual(after);

    const [read] = store.listEvents("r1", { types: "all", reportItems: "all" });
    expect(read?.timeCreated).toBe(appended.timeCreated);
  });

  it("throws when appending an event to an unknown run", () => {
    const store = factory();
    expect(() => store.appendEvent("nope", { type: "log", message: "orphan" })).toThrow();
  });

  it("continues event sequence monotonically over a pre-populated store (resume case)", () => {
    const store = factory();
    store.createRun(baseRun("r1"));
    store.appendEvent("r1", { type: "log", message: "pre-0" });
    store.appendEvent("r1", { type: "log", message: "pre-1" });

    const resumed = store.appendEvent("r1", { type: "log", message: "post" });
    expect(resumed.sequence).toBe(2);

    const sequences = store
      .listEvents("r1", { types: "all", reportItems: "all" })
      .map((e) => e.sequence);
    expect(sequences).toEqual([0, 1, 2]);
    expect(new Set(sequences).size).toBe(sequences.length);
    for (let i = 1; i < sequences.length; i++)
      expect(sequences[i]!).toBeGreaterThan(sequences[i - 1]!);
  });

  it("pages events with afterSequence as a strictly-greater cursor", () => {
    const store = factory();
    store.createRun(baseRun("r1"));
    for (const message of ["e0", "e1", "e2"]) store.appendEvent("r1", { type: "log", message });

    expect(logs(store.listEvents("r1", { types: "all", reportItems: "all" }))).toEqual([
      "e0",
      "e1",
      "e2",
    ]);
    expect(
      logs(store.listEvents("r1", { types: "all", reportItems: "all", afterSequence: 0 })),
    ).toEqual(["e1", "e2"]);
    expect(
      logs(store.listEvents("r1", { types: "all", reportItems: "all", afterSequence: 1 })),
    ).toEqual(["e2"]);
    expect(store.listEvents("r1", { types: "all", reportItems: "all", afterSequence: 2 })).toEqual(
      [],
    );
  });

  it("returns an empty page for an out-of-range cursor instead of throwing", () => {
    const store = factory();
    store.createRun(baseRun("r1"));
    store.appendEvent("r1", { type: "log", message: "only" });
    expect(store.listEvents("r1", { types: "all", reportItems: "all", afterSequence: 99 })).toEqual(
      [],
    );
    expect(
      store.listEvents("nope", { types: "all", reportItems: "all", afterSequence: 0 }),
    ).toEqual([]);
  });

  it("caps a page at limit and keeps it anchored at the cursor", () => {
    const store = factory();
    store.createRun(baseRun("r1"));
    for (let i = 0; i < 5; i++) store.appendEvent("r1", { type: "log", message: `e${i}` });

    expect(logs(store.listEvents("r1", { types: "all", reportItems: "all", limit: 2 }))).toEqual([
      "e0",
      "e1",
    ]);
    expect(
      logs(
        store.listEvents("r1", { types: "all", reportItems: "all", afterSequence: 1, limit: 2 }),
      ),
    ).toEqual(["e2", "e3"]);
    expect(
      logs(
        store.listEvents("r1", { types: "all", reportItems: "all", afterSequence: 3, limit: 10 }),
      ),
    ).toEqual(["e4"]);
    expect(store.listEvents("r1", { types: "all", reportItems: "all", limit: 0 })).toEqual([]);
  });

  it("walks every event exactly once when paging by cursor (no overlap, no gap)", () => {
    const store = factory();
    store.createRun(baseRun("r1"));
    const total = 7;
    for (let i = 0; i < total; i++) store.appendEvent("r1", { type: "log", message: `e${i}` });

    const walked: number[] = [];
    let cursor: number | undefined;
    for (let guard = 0; guard <= total; guard++) {
      const page = store.listEvents("r1", {
        types: "all",
        reportItems: "all",
        afterSequence: cursor,
        limit: 3,
      });
      if (page.length === 0) break;
      for (const stored of page) walked.push(stored.sequence);
      cursor = page[page.length - 1]!.sequence;
    }

    expect(walked).toEqual(
      store.listEvents("r1", { types: "all", reportItems: "all" }).map((e) => e.sequence),
    );
    expect(new Set(walked).size).toBe(total);
  });

  it("keeps the cursor valid across resume", () => {
    const store = factory();
    store.createRun(baseRun("r1"));
    store.appendEvent("r1", { type: "log", message: "pre-0" });
    store.appendEvent("r1", { type: "log", message: "pre-1" });
    const cursor = store.listEvents("r1", { types: "all", reportItems: "all" }).at(-1)!.sequence;

    store.updateRunStatus("r1", "running");
    store.appendEvent("r1", { type: "log", message: "post-0" });
    store.appendEvent("r1", { type: "log", message: "post-1" });

    const tail = store.listEvents("r1", {
      types: "all",
      reportItems: "all",
      afterSequence: cursor,
    });
    expect(logs(tail)).toEqual(["post-0", "post-1"]);
    expect(tail.map((e) => e.sequence)).toEqual([cursor + 1, cursor + 2]);
  });

  it("scopes event pages per runId", () => {
    const store = factory();
    store.createRun(baseRun("r1"));
    store.createRun(baseRun("r2"));
    store.appendEvent("r1", { type: "log", message: "r1-0" });
    store.appendEvent("r2", { type: "log", message: "r2-0" });
    store.appendEvent("r2", { type: "log", message: "r2-1" });
    expect(
      logs(store.listEvents("r1", { types: "all", reportItems: "all", afterSequence: 0 })),
    ).toEqual([]);
    expect(
      logs(store.listEvents("r2", { types: "all", reportItems: "all", afterSequence: 0 })),
    ).toEqual(["r2-1"]);
  });
}
