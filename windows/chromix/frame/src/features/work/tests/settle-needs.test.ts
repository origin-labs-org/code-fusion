import { expect, test } from "vitest";
import { settleNeeds } from "../lib/run/needs";
import type { PartNeed } from "../lib/canvas-model";
import type { HumanPage } from "../lib/work-human";

const held = (step: string): HumanPage => ({
  attempt: "a",
  step,
  generation: 1,
  phase: "waiting_for_human",
  reason: "challenge",
  remaining: 90_000,
  canContinue: false,
  canExtend: true,
  workMemory: true,
});
const page = (url: string, extra: { human?: HumanPage; read?: boolean } = {}) => ({
  url,
  ...extra,
});
const check = (host: string): PartNeed => ({
  kind: "check",
  target: host,
  address: `https://${host}`,
});

test("several pages of one site waiting: one need, on the first, the rest counted", () => {
  const settled = settleNeeds([
    { id: "a", pages: [page("https://allegro.pl/a", { human: held("1") })] },
    {
      id: "b",
      pages: [
        page("https://www.allegro.pl/b", { human: held("2") }),
        page("https://allegro.pl/c", { human: held("3") }),
      ],
    },
  ]);
  expect(settled.get("a")!.pages[0]!.human).toBeDefined();
  expect(settled.get("a")!.pending).toBe(3);
  expect(settled.get("b")!.pages.every((entry) => !entry.human)).toBe(true);
  expect(settled.get("b")!.pending).toBe(0);
});

test("different sites each keep their own need", () => {
  const settled = settleNeeds([
    { id: "a", pages: [page("https://allegro.pl/a", { human: held("1") })] },
    { id: "b", pages: [page("https://airbnb.com/b", { human: held("2") })] },
  ]);
  expect(settled.get("a")!.pages[0]!.human).toBeDefined();
  expect(settled.get("b")!.pages[0]!.human).toBeDefined();
  expect(settled.get("b")!.pending).toBe(0);
});

test("an ended part's check is dropped while a page of its site is held", () => {
  const settled = settleNeeds([
    { id: "old", need: check("allegro.pl"), pages: [page("https://allegro.pl/x")] },
    { id: "now", pages: [page("https://allegro.pl/y", { human: held("2") })] },
  ]);
  expect(settled.get("old")!.need).toBeUndefined();
  expect(settled.get("now")!.pages[0]!.human).toBeDefined();
});

test("a need whose site was read afterwards is resolved: no button", () => {
  const settled = settleNeeds([
    { id: "old", need: check("allegro.pl"), pages: [] },
    { id: "retry", pages: [page("https://allegro.pl/y", { read: true })] },
  ]);
  expect(settled.get("old")!.need).toBeUndefined();
});

test("a site's check is offered once across parts, on the first", () => {
  const settled = settleNeeds([
    { id: "a", need: check("state.gov"), pages: [] },
    { id: "b", need: check("state.gov"), pages: [] },
    {
      id: "c",
      host: "state.gov",
      need: { kind: "retry", target: "state.gov", reason: "blocked_by_check" },
      pages: [],
    },
    {
      id: "d",
      need: { kind: "sign_in", target: "airbnb.com", address: "https://airbnb.com" },
      pages: [],
    },
  ]);
  expect(settled.get("a")!.need).toBeDefined();
  expect(settled.get("b")!.need).toBeUndefined();
  expect(settled.get("c")!.need).toBeUndefined();
  expect(settled.get("d")!.need?.kind).toBe("sign_in");
});

test("needs that are not a check or a sign-in are left alone", () => {
  const retry: PartNeed = { kind: "retry", target: "Airbnb", reason: "couldnt_read" };
  const settled = settleNeeds([
    { id: "a", host: "airbnb.com", need: retry, pages: [] },
    { id: "b", host: "airbnb.com", need: retry, pages: [] },
  ]);
  expect(settled.get("a")!.need).toBe(retry);
  expect(settled.get("b")!.need).toBe(retry);
});
