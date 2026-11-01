import { expect, test } from "vitest";
import type { PicksView } from "../lib/board/types";
import type { PageGroup } from "../lib/project-environment-stage";
import { provenance } from "../lib/run/provenance";

const url = (index: number) => `https://dribbble.com/shots/${index}-canvas`;
const pages = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `page:run:${index}`,
    url: url(index),
    steps: [{ id: `read-${index}` }],
  })) as unknown as PageGroup[];
const picks = (count: number): PicksView => ({
  id: "board",
  kind: "picks",
  facet: "other",
  items: Array.from({ length: count }, (_, index) => ({
    name: `Shot ${index}`,
    url: url(index),
    facts: [],
    tags: [],
    recommended: false,
  })),
});

test("a row of things stands under the pages they were taken from", () => {
  const told = provenance(picks(3), pages(3), [], []);
  expect(told?.used.size).toBe(3);
  expect(told?.view.items.every((item) => item.from)).toBe(true);
});

test("a set of more than one row leaves its pages stacked on their part", () => {
  expect(provenance(picks(8), pages(8), [], [])).toBeNull();
});
