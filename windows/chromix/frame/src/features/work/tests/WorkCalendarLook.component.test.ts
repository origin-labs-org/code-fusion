import "$styles/global.css";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import ObjectsSheet from "./ObjectsSheet.svelte";
import "../components/objects/Plan.svelte";
import { objectHeight, objectWidth } from "../lib/board/object-size";
import type { PlanView } from "../lib/board/types";

vi.mock("$shared/ipc/bindings", async () => {
  const { mockBindings } = await import("$shared/testing/bindings");
  return mockBindings({ faviconProbe: async () => true });
});

const trip: PlanView = {
  id: "look-trip",
  kind: "plan",
  title: "Warsaw to San Francisco",
  checkable: false,
  calendar: true,
  steps: [
    { title: "Fly WAW → SFO", date: "2026-10-13", kind: "travel" },
    { title: "Check in near YC", date: "2026-10-13", kind: "stay" },
    { title: "Hostel in Dogpatch", date: "2026-10-26", kind: "stay" },
    { title: "Hostel in Dogpatch", date: "2026-10-27", kind: "stay" },
    { title: "Hostel in Dogpatch", date: "2026-10-28", kind: "stay" },
    { title: "Batch kickoff", date: "2026-10-26", kind: "event" },
    { title: "Open a US bank account", date: "2026-10-27", kind: "task" },
    { title: "Demo Day", date: "2026-12-02", kind: "milestone" },
    { title: "Fly home", date: "2026-12-03", kind: "travel" },
  ],
};

const topics = ["Recursion", "Hash tables", "Trees", "Sorting", "Graphs", "SQL", "Networking"];
const day = (offset: number) => {
  const date = new Date(2026, 9, 5 + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const study: PlanView = {
  id: "look-study",
  kind: "plan",
  title: "Study plan",
  checkable: false,
  steps: Array.from({ length: 35 }, (_, offset) => {
    const count = offset % 4 === 0 ? 4 : 1 + (offset % 3);
    return Array.from({ length: count }, (_, at) => ({
      title: at === 0 ? topics[offset % topics.length]! : `Practice set ${offset}.${at}`,
      date: day(offset),
      kind: at === 3 ? ("milestone" as const) : at === 2 ? ("event" as const) : ("task" as const),
      done: offset < 6,
    }));
  }).flat(),
};

test.each([
  ["trip", trip],
  ["study", study],
])(
  "the %s calendar",
  async (name, plan) => {
    await page.viewport(1400, 1200);
    const noop = () => {};
    const width = objectWidth(plan).ideal;
    const screen = await render(ObjectsSheet, {
      rows: [{ object: plan, width }],
      actions: { check: noop },
    });
    const sheet = screen.container.querySelector<HTMLElement>(".sheet")!;
    await expect.poll(() => !!sheet.querySelector(".calendar"), { timeout: 20000 }).toBe(true);
    const section = sheet.querySelector<HTMLElement>("section.plan")!;
    // The canvas card is as tall as the plan sizes it: no clipping, no gap.
    expect(section.offsetHeight).toBe(Math.round(objectHeight(plan, width)));
    for (const theme of ["dark", "light"]) {
      document.documentElement.dataset.theme = theme;
      await new Promise((done) => setTimeout(done, 400));
      await page
        .elementLocator(section)
        .screenshot({ path: `../../../../../target/work-calendar/${name}-${theme}.png` });
    }
    document.documentElement.dataset.theme = "dark";
    if (name === "study") {
      await screen.getByRole("button", { name: /more/ }).first().click();
      await new Promise((done) => setTimeout(done, 1000));
      await page.screenshot({ path: "../../../../../target/work-calendar/study-more.png" });
    }
    await screen.unmount();
  },
  60_000,
);
