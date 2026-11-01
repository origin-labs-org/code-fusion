import "$styles/global.css";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import type { WorkExecutionFact } from "$shared/ipc/bindings";
import RequestLift from "../components/lift/RequestLift.svelte";
import { projection } from "./environment-fixtures";

type Step = NonNullable<WorkExecutionFact["steps"]>[number];
const step = (id: string, kind: Step["kind"], status: Step["status"], extra = {}) =>
  ({ id, turn: 1, kind, status, ...extra }) as Step;

function run(): WorkExecutionFact {
  const execution = structuredClone(projection.executions[0]!);
  execution.status = "completed";
  execution.steps = [
    step("s1", { kind: "turn" }, "succeeded", { note: "Looking for reviews first." }),
    step("s2", { kind: "search", query: "quiet keyboards" }, "succeeded"),
    step("s3", { kind: "read", url: "https://www.a.example/review" }, "succeeded", {
      measurements: {
        wall_millis: 3200,
        decision_calls: 0,
        emulation_calls: 0,
        planner_calls: 0,
        native_actions: 0,
        model_tokens: 0,
        cost_micro_usd: 0,
        cost_basis: "exact",
      },
    }),
    step("s4", { kind: "read", url: "https://b.example/blocked" }, "failed", {
      note: "The site asked for a sign-in.",
    }),
    step("s5", { kind: "finish" }, "succeeded"),
  ];
  return execution;
}

test("a request opens whole: what it did, what it made, and every step folded away", async () => {
  await page.viewport(900, 800);
  const onmade = vi.fn();
  const screen = await render(RequestLift, {
    request: "Find a quiet keyboard under $150",
    trail: [{ key: "searched", icon: "search", text: "Searched the web once" }],
    runs: [run()],
    made: [{ id: "picks", title: "Three quiet keyboards", kind: "picks" }],
    onsource: vi.fn(),
    onmade,
  });
  await expect
    .element(screen.getByRole("heading", { name: "Find a quiet keyboard under $150" }))
    .toBeVisible();
  await expect.element(screen.getByText("Done · 5 steps", { exact: true })).toBeVisible();
  await expect.element(screen.getByText("Searched the web once")).toBeVisible();
  await screen.getByRole("button", { name: "Three quiet keyboards" }).click();
  expect(onmade).toHaveBeenCalledExactlyOnceWith("picks");
  expect(screen.container.querySelector("details.steps")?.hasAttribute("open")).toBe(false);
  await screen.getByText("Step by step").click();
  await expect.element(screen.getByRole("list", { name: "What the agent did" })).toBeVisible();
  const rows = [...screen.container.querySelectorAll("ol > li")].map((row) =>
    row.textContent?.replace(/\s+/gu, " ").trim(),
  );
  expect(rows).toEqual([
    "Looking for reviews first.",
    "Searched quiet keyboards",
    "Read a.example 3.2 s",
    "Read b.example The site asked for a sign-in.",
    "Finished",
  ]);
  await screen.unmount();
});
