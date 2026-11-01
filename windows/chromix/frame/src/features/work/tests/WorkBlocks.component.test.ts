import "$styles/global.css";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import ObjectsSheet from "./ObjectsSheet.svelte";
import "../components/objects/List.svelte";
import "../components/objects/Plan.svelte";
import "../components/objects/TableBlock.svelte";
import type { ListView, OwnedData, PlanView, SheetView } from "../lib/board/types";

vi.mock("$shared/ipc/bindings", async () => {
  const { mockBindings } = await import("$shared/testing/bindings");
  return mockBindings({ faviconProbe: async () => true });
});

/** Every change the person made, applied to the data it began from. */
function recorder(start: OwnedData) {
  let data = start;
  const edit = vi.fn((_id: string, change: (data: OwnedData) => OwnedData) => {
    data = change(data);
  });
  return { edit, data: () => data };
}

test("a checklist of one's own is ticked, renamed and grown in place", async () => {
  await page.viewport(1200, 800);
  const list: ListView = {
    id: "list",
    kind: "list",
    style: "todo",
    title: "Trip",
    items: [{ title: "Passport" }],
  };
  const made = recorder({ kind: "list", style: "todo", items: [{ title: "Passport" }] });
  const screen = await render(ObjectsSheet, {
    rows: [{ object: list, width: 400 }],
    actions: { edit: made.edit },
  });
  await screen.getByRole("button", { name: "Passport" }).first().click();
  expect(made.data()).toMatchObject({ items: [{ title: "Passport", done: true }] });
  await screen.getByPlaceholder("Add an item").first().click();
  await userEvent.keyboard("Adapter{Enter}");
  expect(made.data()).toMatchObject({ items: [{ title: "Passport" }, { title: "Adapter" }] });
});

test("a table of one's own takes cells, rows and columns", async () => {
  await page.viewport(1200, 800);
  const sheet: SheetView = {
    id: "table",
    kind: "sheet",
    title: "GPUs",
    columns: [
      { label: "Name", kind: "text" },
      { label: "Notes", kind: "text" },
    ],
    rows: [{ cells: ["RTX 3090", ""] }],
  };
  const made = recorder({
    kind: "sheet",
    columns: [
      { label: "Name", kind: "text" },
      { label: "Notes", kind: "text" },
    ],
    rows: [{ cells: ["RTX 3090", ""] }],
  });
  const screen = await render(ObjectsSheet, {
    rows: [{ object: sheet, width: 560 }],
    actions: { edit: made.edit },
  });
  const notes = screen.getByRole("gridcell", { name: "Notes" }).first();
  await notes.click();
  await userEvent.keyboard("24 GB{Enter}");
  expect(made.data()).toMatchObject({
    rows: [{ cells: ["RTX 3090", "24 GB"] }, { cells: ["", ""] }],
  });
  await screen.getByRole("button", { name: "Add a column" }).first().click();
  expect(made.data()).toMatchObject({ columns: [{}, {}, { label: "Column 3" }] });
});

test("a calendar of one's own takes an event on the day it is clicked", async () => {
  await page.viewport(1400, 1000);
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-15`;
  const plan: PlanView = {
    id: "cal",
    kind: "plan",
    title: "Calendar",
    checkable: false,
    calendar: true,
    steps: [],
  };
  const made = recorder({ kind: "plan", steps: [], checkable: false, calendar: true });
  const screen = await render(ObjectsSheet, {
    rows: [{ object: plan, width: 904 }],
    actions: { edit: made.edit },
  });
  const [year, month] = iso.split("-").map(Number);
  const label = new Intl.DateTimeFormat(undefined, { dateStyle: "full" }).format(
    new Date(year!, month! - 1, 15),
  );
  await screen
    .getByRole("gridcell", { name: label })
    .first()
    .click({ position: { x: 60, y: 70 } });
  await userEvent.keyboard("Dentist{Enter}");
  expect(made.data()).toMatchObject({ steps: [{ title: "Dentist", date: iso, kind: "event" }] });
});
