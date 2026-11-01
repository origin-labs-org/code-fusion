import { expect, test } from "vitest";
import { needWords } from "../lib/run/need";

test("a typed human check offers the page where the person can resolve it", () => {
  expect(needWords({ kind: "check", target: "Allegro" }, "Prices", "row")).toEqual({
    text: "Allegro asked for a human check",
    action: "Open page",
  });
});

test("a service the person has not connected asks once to be connected, with one action", () => {
  const need = { kind: "connect" as const, target: "Linear" };
  expect(needWords(need, "Issues", "row")).toEqual({
    text: "Connect Linear to read it directly",
    action: "Connect Linear",
  });
  expect(needWords(need, "Issues", "island").action).toBe("Connect Linear");
});

test("a part a check stopped offers another try, and the island names the site", () => {
  const need = {
    kind: "retry" as const,
    target: "allegro.pl",
    reason: "blocked_by_check" as const,
  };
  expect(needWords(need, "Prices", "row")).toEqual({
    text: "allegro.pl asked for a human check",
    action: "Try again",
  });
  expect(needWords(need, "Prices", "island")).toEqual({
    text: "Prices met a human check",
    action: "Try allegro.pl again",
  });
  const slow = { kind: "retry" as const, target: "", reason: "no_answer" as const };
  expect(needWords(slow, "Prices", "row").action).toBe("Try again");
});

test("a missing folder offers the native picker without an invented location", () => {
  expect(needWords({ kind: "choose_folder", target: "" }, "Project", "row")).toEqual({
    text: "Choose a folder",
    action: "Choose folder…",
  });
});

test("a check or a sign-in the settled run moved past is told as past, with one try again", () => {
  expect(needWords({ kind: "check", target: "state.gov", past: true }, "Entry", "row")).toEqual({
    text: "state.gov asked for a human check",
    action: "Try again",
  });
  expect(needWords({ kind: "sign_in", target: "Airbnb", past: true }, "Stay", "row")).toEqual({
    text: "Signed out of Airbnb",
    action: "Try again",
  });
});
