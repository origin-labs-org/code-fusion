import { describe, expect, it } from "vitest";
import { spaceFixture, tabFixture } from "$shared/testing/fixtures";
import { recall, remember } from "../lib/space-memory";

const sheet = (id: string) => ({
  nodes: [],
  tabs: [tabFixture({ id, title: id })],
  active: id,
});

describe("what a space showed last", () => {
  it("is kept for the space and handed back as it was", () => {
    const spaces = [spaceFixture("a", "A"), spaceFixture("b", "B")];
    const shown = sheet("t1");
    remember("a", shown, spaces);
    expect(recall("a")).toBe(shown);
    expect(recall("b")).toBeUndefined();
  });

  it("forgets spaces that are gone", () => {
    const both = [spaceFixture("one", "One"), spaceFixture("two", "Two")];
    remember("one", sheet("x"), both);
    remember("two", sheet("y"), both);
    remember("three", sheet("z"), [both[1]!, spaceFixture("three", "Three")]);
    expect(recall("one")).toBeUndefined();
    expect(recall("two")).toBeDefined();
    expect(recall("three")).toBeDefined();
  });
});
