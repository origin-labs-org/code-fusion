import "$styles/global.css";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import ObjectsSheet from "./ObjectsSheet.svelte";
import "../components/objects/List.svelte";
import "../components/objects/Plan.svelte";
import "../components/objects/TableBlock.svelte";
import type { ListView, PlanView, SheetView } from "../lib/board/types";

vi.mock("$shared/ipc/bindings", async () => {
  const { mockBindings } = await import("$shared/testing/bindings");
  return mockBindings({ faviconProbe: async () => true });
});

const checklist: ListView = {
  id: "look-checklist",
  kind: "list",
  style: "todo",
  title: "Before the flight",
  items: [{ title: "Passport", done: true }, { title: "ESTA approval" }, { title: "Adapter" }],
};
const table: SheetView = {
  id: "look-table",
  kind: "sheet",
  title: "GPUs",
  columns: [
    { label: "Name", kind: "text" },
    { label: "VRAM", kind: "text" },
    { label: "Price", kind: "text" },
  ],
  rows: [
    { cells: ["RTX 3090", "24 GB", "5,795 zł"] },
    { cells: ["RTX 4090", "24 GB", "9,499 zł"] },
  ],
};
const calendar: PlanView = {
  id: "look-calendar",
  kind: "plan",
  title: "Calendar",
  checkable: false,
  calendar: true,
  steps: [
    { title: "Dentist", date: "2026-10-15", kind: "event" },
    { title: "YC interview prep", date: "2026-10-21", kind: "milestone" },
  ],
};

test("the person's own blocks", async () => {
  await page.viewport(2000, 1200);
  const noop = () => {};
  const screen = await render(ObjectsSheet, {
    rows: [
      { object: checklist, width: 400 },
      { object: table, width: 560 },
      { object: calendar, width: 904 },
    ],
    actions: { edit: noop },
  });
  const sheet = screen.container.querySelector<HTMLElement>(".sheet")!;
  await expect
    .poll(() => sheet.querySelectorAll(".checklist, .table-block, .calendar").length, {
      timeout: 20000,
    })
    .toBeGreaterThanOrEqual(6);
  for (const theme of ["dark", "light"]) {
    document.documentElement.dataset.theme = theme;
    await new Promise((done) => setTimeout(done, 700));
    await page.screenshot({
      path: `../../../../../target/work-objects/blocks/blocks-${theme}.png`,
    });
  }
  document.documentElement.dataset.theme = "dark";
  await screen.unmount();
});
