import "$styles/global.css";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import { WorkSession } from "$domain/work";
import NeedsYouStage from "./NeedsYouStage.svelte";
import TakeoverPane from "../components/pane/TakeoverPane.svelte";
import { needWords } from "../lib/run/need";
import { CHECK_URL, checkPage, checkScene } from "./needs-you-look";

vi.mock("$shared/ipc/bindings", async () => {
  const { mockBindings } = await import("$shared/testing/bindings");
  return mockBindings({ faviconProbe: async () => true });
});

const shots = "../../../../../target/work-needs-you";
const viewport = { x: 40, y: 90, zoom: 1 };

async function both(name: string, wait = 900) {
  for (const theme of ["dark", "light"]) {
    document.documentElement.dataset.theme = theme;
    await new Promise((done) => setTimeout(done, wait));
    await page.screenshot({ path: `${shots}/${name}-${theme}.png` });
  }
  document.documentElement.dataset.theme = "dark";
}

function sessionOf(scene: ReturnType<typeof checkScene>) {
  const session = new WorkSession("profile");
  session.selected = "objective";
  session.projection = structuredClone([...scene.objectives.values()][0]!);
  return session;
}

test("a bot check the run waits on: the page, the island, the card holds the actions", async () => {
  await page.viewport(1440, 820);
  const scene = checkScene("waiting");
  const session = sessionOf(scene);
  const onaction = vi.fn();
  const onwaitingpage = vi.fn();
  const waiting = (remaining: number) => ({
    card: "page:check",
    host: "allegro.pl",
    reason: "challenge" as const,
    remaining,
    canExtend: true,
  });
  const screen = await render(NeedsYouStage, {
    scene,
    session,
    held: [checkPage(72_000)],
    waiting: waiting(72_000),
    viewport,
    onaction,
    onwaitingpage,
  });
  screen.container.style.width = "1440px";
  screen.container.style.height = "820px";
  const band = screen.getByRole("group", { name: "allegro.pl wants to confirm you’re a person" });
  await expect.element(band).toBeVisible();
  await expect.element(band.getByText("1:12 left")).toBeVisible();
  // The island only says so, and points at the card: the actions live on the card.
  await expect
    .element(screen.getByRole("button", { name: /^Waiting for you on allegro.pl/ }))
    .toBeVisible();
  await both("check-waiting");

  await band.getByRole("button", { name: "Keep waiting" }).click();
  expect(onaction).toHaveBeenLastCalledWith(
    expect.stringMatching(/docs/u),
    expect.stringMatching(/^wait:/u),
  );
  await band.getByRole("button", { name: "Open allegro.pl", exact: true }).click();
  expect(onaction).toHaveBeenLastCalledWith(
    expect.stringMatching(/docs/u),
    expect.stringMatching(/^page:/u),
  );

  // Near the end the island offers more time too, and the clock turns to the warning tone.
  await screen.rerender({ held: [checkPage(14_000)], waiting: waiting(14_000) });
  await expect.element(band.getByText("0:14 left")).toBeVisible();
  await both("check-late");
  const island = screen.getByRole("region", { name: /agent/i });
  await expect
    .element(island.getByRole("button", { name: "Keep waiting" }))
    .not.toBeInTheDocument();
  await expect
    .element(island.getByRole("button", { name: "Open allegro.pl" }))
    .not.toBeInTheDocument();
  await userEvent.click(island.getByRole("button", { name: "Show", exact: true }));
  expect(onwaitingpage).toHaveBeenCalledWith("page:check");

  // At the longest wait there is no more time to give.
  await screen.rerender({ held: [checkPage(30_000, false)], waiting: null });
  await expect.element(band.getByRole("button", { name: "Keep waiting" })).not.toBeInTheDocument();
  await screen.unmount();
  session.dispose();
});

test("a check nobody solved in time: the part offers to try the site again", async () => {
  await page.viewport(1440, 820);
  const scene = checkScene("expired");
  const session = sessionOf(scene);
  const onaction = vi.fn();
  const onact = vi.fn();
  const said = needWords(
    { kind: "retry", target: "allegro.pl", reason: "blocked_by_check" },
    "Prices",
    "island",
  );
  const screen = await render(NeedsYouStage, {
    scene,
    session,
    viewport,
    onaction,
    ended: { ...said, onact },
  });
  screen.container.style.width = "1440px";
  screen.container.style.height = "820px";
  const row = screen.getByRole("region", { name: "Prices" });
  await expect.element(row.getByText(/asked for a human check$/u)).toBeVisible();
  await both("check-expired");
  await row.getByRole("button", { name: "Try again" }).click();
  expect(onaction).toHaveBeenLastCalledWith(expect.stringMatching(/docs/u), "need:again");
  await screen.unmount();
  session.dispose();
});

test("the takeover on a check says Work will remember it", async () => {
  await page.viewport(1200, 800);
  const screen = await render(TakeoverPane, {
    host: "allegro.pl",
    url: CHECK_URL,
    bounds: new DOMRect(80, 60, 1040, 680),
    page: {
      attempt: "attempt",
      step: "docs-1",
      generation: 1,
      phase: "presented",
      reason: "challenge",
      remaining: 412_000,
      canContinue: false,
      canExtend: false,
      workMemory: true,
    },
    onregion: vi.fn(),
    oncontinue: vi.fn(),
    onclose: vi.fn(),
  });
  await expect.element(screen.getByText("Work will remember this for next time")).toBeVisible();
  await both("takeover", 500);
  await screen.unmount();
});
