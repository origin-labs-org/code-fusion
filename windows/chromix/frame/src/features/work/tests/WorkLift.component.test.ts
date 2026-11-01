import "$styles/global.css";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import { WorkSession } from "$domain/work";
import type { WorkExecutionFact, WorkRuntimeProjection } from "$shared/ipc/bindings";
import WorkResultInspector from "../components/WorkResultInspector.svelte";
import TabCard from "../components/cards/TabCard.svelte";
import { projection as base } from "./environment-fixtures";

const native = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("$shared/ipc/bindings", async () => {
  const { mockBindings } = await import("$shared/testing/bindings");
  return mockBindings({ workCall: native.call });
});

type Step = NonNullable<WorkExecutionFact["steps"]>[number];
const citations = ["a.example", "b.example", "c.example"].map((host, index) => ({
  url: `https://${host}/page`,
  title: `Page ${index + 1}`,
  start_index: 0,
  end_index: 1,
}));

function state(data: WorkExecutionFact["artifacts"][number]["data"], steps: Step[] = []) {
  const projection: WorkRuntimeProjection = structuredClone(base);
  const execution = projection.executions[0]!;
  execution.user_artifacts = [];
  execution.provider_evidence = [
    {
      id: "record",
      node: "node",
      attempt: "attempt",
      evidence: {
        version: 1,
        provider: "open_ai",
        model: "search-model",
        response_model: "search-model",
        response_id: "response",
        search_call_id: "search-call",
        answer: "",
        actual_input_tokens: 0,
        actual_output_tokens: 0,
        citations,
      },
    },
  ];
  execution.artifacts = [
    {
      ...execution.artifacts[0]!,
      title: "What we found",
      data,
      evidence: citations.map((_, index) => ({ extraction_id: "record", source_id: index + 1 })),
    },
  ];
  execution.steps = steps;
  const session = new WorkSession("profile");
  session.selected = "objective";
  session.projection = projection;
  return session;
}
const reference = {
  kind: "artifact" as const,
  objective: "objective",
  execution: "execution",
  artifact: "artifact",
};

test("a result lifts in reading mode with one collapsed sources rail and no chips in the text", async () => {
  await page.viewport(900, 700);
  const session = state({ kind: "document", paragraphs: ["The lead.", "The second paragraph."] });
  const onopen = vi.fn();
  const screen = await render(WorkResultInspector, { session, reference, source: null, onopen });
  await expect.element(screen.getByRole("heading", { name: "What we found" })).toBeVisible();
  await expect.element(screen.getByText("The second paragraph.")).toBeVisible();
  expect(screen.container.querySelector(".reading")).not.toBeNull();
  expect(screen.container.querySelector(".chip")).toBeNull();
  const rail = screen.getByRole("button", { name: "Based on 3 sources" });
  await expect.element(rail).toHaveAttribute("aria-expanded", "false");
  expect(screen.container.querySelectorAll(".rail li")).toHaveLength(0);
  await rail.click();
  expect(screen.container.querySelectorAll(".rail li")).toHaveLength(3);
  await screen.getByRole("button", { name: /b\.example/ }).click();
  expect(onopen).toHaveBeenCalledExactlyOnceWith("https://b.example/page");
  await screen.unmount();
  session.dispose();
});

test("code lifts whole with its notes as a rail and copies through the clipboard", async () => {
  await page.viewport(900, 700);
  const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  const text = 'fn main() {\n    let x = 1;\n    println!("{x}");\n}\n';
  const session = state({
    kind: "code",
    language: "rust",
    text,
    notes: [{ from: 2, to: 3, text: "Binds and prints x" }],
  });
  const screen = await render(WorkResultInspector, { session, reference, source: null });
  await expect.element(screen.getByText("Code · rust")).toBeVisible();
  await expect.poll(() => screen.container.querySelectorAll(".row").length).toBe(4);
  const entry = screen.getByRole("button", { name: /Lines 2–3/u });
  await entry.click();
  expect(screen.container.querySelectorAll(".row.lit")).toHaveLength(2);
  await screen.getByRole("button", { name: "Copy" }).click();
  expect(copy).toHaveBeenCalledExactlyOnceWith(text);
  await expect.element(screen.getByRole("button", { name: "Copied" })).toBeVisible();
  copy.mockRestore();
  await screen.unmount();
  session.dispose();
});

test("a findings card lifts with every claim, its detail and its evidence", async () => {
  await page.viewport(900, 700);
  const claims = ["One", "Two", "Three", "Four", "Five", "Six"].map((word, index) => ({
    claim: `Claim ${word}`,
    detail: `Detail ${word}`,
    confidence: "supported" as const,
    evidence: [index % 3],
  }));
  const session = state({ kind: "findings", subjects: [], items: claims });
  const screen = await render(WorkResultInspector, { session, reference, source: null });
  for (const { claim, detail } of claims) {
    await expect.element(screen.getByText(claim, { exact: true })).toBeVisible();
    await expect.element(screen.getByText(detail, { exact: true })).toBeVisible();
  }
  await expect.element(screen.getByText("6 claims")).toBeVisible();
  expect(screen.container.textContent).not.toContain("+2");
  await screen.unmount();
  session.dispose();
});

test("a video link shows its admitted thumbnail with YouTube's mark and plays in the Work browser", async () => {
  await page.viewport(900, 700);
  const onplay = vi.fn();
  const screen = await render(TabCard, {
    item: {
      id: "link",
      type: "link",
      title: "youtube.com",
      kind: "Link",
      detail: "https://www.youtube.com",
      status: "",
      image: { profile: "profile", digest: "d".repeat(64) },
    },
    selected: false,
    onplay,
  });
  // The admitted picture fills a 16:9 hero; the play mark sits on it.
  expect(screen.container.querySelector(".hero .thumbnail")).not.toBeNull();
  expect(screen.container.querySelector(".thumbnail .play-mark")).not.toBeNull();
  await screen.getByRole("button", { name: "Play youtube.com" }).click();
  expect(onplay).toHaveBeenCalledOnce();
  await screen.unmount();
});
