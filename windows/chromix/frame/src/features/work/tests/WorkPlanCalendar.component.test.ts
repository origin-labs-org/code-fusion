import "$styles/global.css";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import ObjectsSheet from "./ObjectsSheet.svelte";
import "../components/objects/Plan.svelte";
import type { PlanView } from "../lib/board/types";

vi.mock("$shared/ipc/bindings", async () => {
  const { mockBindings } = await import("$shared/testing/bindings");
  return mockBindings({ faviconProbe: async () => true });
});

test("a busy day shows two steps and opens the rest from its count", async () => {
  await page.viewport(1400, 900);
  const plan: PlanView = {
    id: "busy",
    kind: "plan",
    title: "Busy",
    checkable: false,
    calendar: true,
    steps: ["One", "Two", "Three", "Four", "Five"].map((title) => ({
      title,
      date: "2026-10-14",
      kind: "task" as const,
    })),
  };
  const screen = await render(ObjectsSheet, { rows: [{ object: plan, width: 904 }] });
  await expect.element(screen.getByText("Two").first()).toBeVisible();
  await expect.element(screen.getByText("Three").first()).not.toBeInTheDocument();
  await screen
    .getByRole("button", { name: /\+3 more/ })
    .first()
    .click();
  await expect.element(page.getByText("Five").first()).toBeVisible();
});
