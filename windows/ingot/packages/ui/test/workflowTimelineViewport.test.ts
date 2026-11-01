// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTimelineViewport } from "@/components/workflow-timeline/use-timeline-viewport.js";

type ResizeCallback = () => void;
let resizeCallbacks: ResizeCallback[] = [];
const originalResizeObserver = globalThis.ResizeObserver;

function fakeElement(size: { clientWidth: number; scrollLeft: number; scrollWidth: number }) {
  const element = document.createElement("div");
  Object.defineProperty(element, "clientWidth", { get: () => size.clientWidth });
  Object.defineProperty(element, "scrollWidth", { get: () => size.scrollWidth });
  Object.defineProperty(element, "scrollLeft", {
    get: () => size.scrollLeft,
    set: (v) => (size.scrollLeft = v),
  });
  return element;
}

beforeEach(() => {
  resizeCallbacks = [];
  globalThis.ResizeObserver = class {
    constructor(callback: ResizeCallback) {
      resizeCallbacks.push(callback);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  cleanup();
  globalThis.ResizeObserver = originalResizeObserver;
  vi.useRealTimers();
});

describe("useTimelineViewport", () => {
  it("measures on mount; a resize callback with the same numbers keeps the same viewport object", () => {
    const size = { clientWidth: 400, scrollLeft: 0, scrollWidth: 960 };
    const element = fakeElement(size);
    const view = renderHook(() => useTimelineViewport(element, 960));
    const first = view.result.current;
    expect(first).toEqual({ clientWidth: 400, scrollLeft: 0, scrollWidth: 960, scrolling: false });

    act(() => {
      for (const callback of resizeCallbacks) callback();
    });
    expect(view.result.current).toBe(first);

    size.clientWidth = 500;
    act(() => {
      for (const callback of resizeCallbacks) callback();
    });
    expect(view.result.current).not.toBe(first);
    expect(view.result.current.clientWidth).toBe(500);
  });

  it("re-measures when the content key changes without re-rendering if nothing moved", () => {
    const size = { clientWidth: 400, scrollLeft: 0, scrollWidth: 960 };
    const element = fakeElement(size);
    let renders = 0;
    const view = renderHook(
      ({ key }: { key: number }) => {
        renders += 1;
        return useTimelineViewport(element, key);
      },
      { initialProps: { key: 960 } },
    );
    const after = renders;
    const first = view.result.current;
    view.rerender({ key: 1152 });
    expect(renders).toBe(after + 1);
    expect(view.result.current).toBe(first);
  });
});
