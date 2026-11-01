import { beforeEach, expect, test, vi } from "vitest";

vi.mock("$shared/lib/motion", () => ({ reducedMotion: () => false }));

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("document", {});
});

async function fresh() {
  return (await import("../lib/space-theme")).applySpaceTheme;
}

test("moving between spaces that dress the window alike applies nothing", async () => {
  const applySpaceTheme = await fresh();
  const apply = vi.fn();
  applySpaceTheme("a", "k", apply);
  applySpaceTheme("b", "k", apply);
  applySpaceTheme("a", "k", apply);
  expect(apply).toHaveBeenCalledOnce();
});

test("a change in the same space applies at once, and a different theme crossfades", async () => {
  const applySpaceTheme = await fresh();
  const apply = vi.fn();
  applySpaceTheme("a", "k", apply);
  applySpaceTheme("a", "k2", apply);
  expect(apply).toHaveBeenCalledTimes(2);
  const transition = vi.fn((run: () => void) => run());
  vi.stubGlobal("document", { startViewTransition: transition });
  applySpaceTheme("b", "k3", apply);
  expect(transition).toHaveBeenCalledOnce();
  expect(apply).toHaveBeenCalledTimes(3);
});
