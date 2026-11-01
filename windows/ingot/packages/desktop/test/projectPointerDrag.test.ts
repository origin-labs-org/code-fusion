import { runInNewContext } from "node:vm";
import { afterEach, expect, it, vi } from "vitest";
import { startProjectPointerDrag } from "#e2e/helpers/project-sidebar";

vi.mock("#e2e/helpers/desktop-app", () => ({}));
afterEach(() => vi.unstubAllGlobals());

it("The merged single displacement only activates sensor; gestures still produce actual drag displacement", async () => {
  let y = 0;
  let origin = 0;
  let down = false;
  let active = false;
  let offset = 0;
  const document = {
    querySelector: () => ({
      getBoundingClientRect: () => ({ left: 20, top: 100 + offset, width: 80, height: 32 }),
    }),
  };
  vi.stubGlobal("$", () => ({ getAttribute: async () => (active ? "true" : null) }));
  vi.stubGlobal("browser", {
    execute: async (fn: (...args: unknown[]) => unknown, ...args: unknown[]) =>
      runInNewContext(`(${fn.toString()})(...args)`, { args, document }),
    releaseActions: async () => {
      down = false;
      active = false;
    },
    performActions: async (sources: Array<{ actions: Array<{ type: string; y?: number }> }>) => {
      for (const source of sources)
        for (const action of source.actions) {
          if (action.type === "pointerDown") {
            down = true;
            origin = y;
          }
          if (action.type !== "pointerMove") continue;
          y = action.y ?? y;
          if (!down) continue;
          if (!active && Math.abs(y - origin) > 6) active = true;
          else if (active) offset = y - origin;
        }
    },
    waitUntil: async (predicate: () => Promise<boolean>) => {
      if (!(await predicate())) throw new Error("拖拽未激活");
    },
  });
  const initial = await startProjectPointerDrag("button");
  expect(active).toBe(true);
  expect(document.querySelector().getBoundingClientRect().top - initial.top).toBeGreaterThanOrEqual(
    6,
  );
});
