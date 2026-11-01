// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PEN_GAP_MS,
  PEN_MS,
  useTypewriter,
} from "@/components/workflow-timeline/use-typewriter.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function tick(ms: number) {
  let left = ms;
  do {
    const step = Math.min(PEN_MS, left);
    act(() => {
      vi.advanceTimersByTime(step);
    });
    left -= step;
  } while (left > 0);
}

describe("useTypewriter", () => {
  it("第One站立即揭示、逐Character写出；写完才停One拍揭示下One站", () => {
    const view = renderHook(({ names }: { names: string[] | undefined }) => useTypewriter(names), {
      initialProps: { names: ["plan", "verify"] as string[] | undefined },
    });
    expect(view.result.current).toMatchObject({ idle: false, shown: [0], visible: 1 });

    tick(PEN_MS * 2);
    expect(view.result.current.shown).toEqual([2]);
    tick(PEN_MS * 2);
    expect(view.result.current).toMatchObject({ idle: false, shown: [4], visible: 1 });

    tick(PEN_GAP_MS - 1);
    expect(view.result.current.visible).toBe(1);
    tick(1);
    expect(view.result.current).toMatchObject({ shown: [4, 0], visible: 2 });

    tick(PEN_MS * 6);
    expect(view.result.current).toMatchObject({ idle: true, shown: [4, 6], visible: 2 });
  });

  it("名CharacterMedium途变Long（未闭合的Label记又来了Character）笔接着写；换成NewArray但inner容不变不会打断笔", () => {
    const view = renderHook(({ names }: { names: string[] }) => useTypewriter(names), {
      initialProps: { names: ["ver"] },
    });
    tick(PEN_MS * 3);
    expect(view.result.current).toMatchObject({ idle: true, shown: [3] });

    view.rerender({ names: ["verify"] });
    expect(view.result.current.idle).toBe(false);
    tick(PEN_MS * 3);
    expect(view.result.current).toMatchObject({ idle: true, shown: [6] });

    view.rerender({ names: ["verify"] });
    expect(view.result.current).toMatchObject({ idle: true, shown: [6], visible: 1 });
  });

  it("名Character在Prefix上变了（Streaming下的稳健性）Returned公共Prefix；不YesDraft时静默", () => {
    const view = renderHook(({ names }: { names: string[] | undefined }) => useTypewriter(names), {
      initialProps: { names: ["plan"] as string[] | undefined },
    });
    tick(PEN_MS * 4);
    expect(view.result.current.shown).toEqual([4]);
    view.rerender({ names: ["plot"] });
    tick(0);
    expect(view.result.current.shown[0]).toBe(2);

    view.rerender({ names: undefined });
    expect(view.result.current).toEqual({ idle: false, shown: [], visible: 0 });
  });

  it("两站OneFrom到：第Two站等第One站写完再揭示", () => {
    const view = renderHook(() => useTypewriter(["a", "b"]));
    tick(PEN_MS);
    expect(view.result.current).toMatchObject({ shown: [1], visible: 1 });
    tick(PEN_GAP_MS);
    expect(view.result.current).toMatchObject({ shown: [1, 0], visible: 2 });
  });

  it("空Draft（还没有One站）笔静默：不揭示不存在的站，也不空转；第One站到了才揭示，站Count回到 0 笔收回", async () => {
    vi.useRealTimers();
    const globalWithAct = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const previousAct = globalWithAct.IS_REACT_ACT_ENVIRONMENT;
    globalWithAct.IS_REACT_ACT_ENVIRONMENT = false;
    let renders = 0;
    let last: ReturnType<typeof useTypewriter> | undefined;
    function Probe({ names }: { names: string[] }) {
      renders += 1;
      last = useTypewriter(names);
      return null;
    }
    const settle = () => new Promise((resolve) => setTimeout(resolve, 60));
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      root.render(createElement(Probe, { names: [] }));
      await settle();
      expect(renders).toBeLessThanOrEqual(2);
      expect(last).toEqual({ idle: false, shown: [], visible: 0 });

      root.render(createElement(Probe, { names: ["plan"] }));
      await settle();
      expect(last).toMatchObject({ visible: 1 });

      const before = renders;
      root.render(createElement(Probe, { names: [] }));
      await settle();
      expect(renders).toBeLessThanOrEqual(before + 2);
      expect(last).toEqual({ idle: false, shown: [], visible: 0 });
    } finally {
      root.unmount();
      host.remove();
      globalWithAct.IS_REACT_ACT_ENVIRONMENT = previousAct;
    }
  });

  it("prefers-reduced-motion：整站立即写完Yes渲染时派生的，站名变Long不再多One轮 setState", () => {
    const matchMedia = window.matchMedia;
    window.matchMedia = ((query: string) =>
      ({
        matches: query.includes("reduce"),
        media: query,
      }) as MediaQueryList) as typeof window.matchMedia;
    try {
      let renders = 0;
      const view = renderHook(
        ({ names }: { names: string[] }) => {
          renders += 1;
          return useTypewriter(names);
        },
        { initialProps: { names: ["ver"] } },
      );
      expect(renders).toBe(2);
      expect(view.result.current).toMatchObject({ idle: true, shown: [3], visible: 1 });

      view.rerender({ names: ["verify"] });
      expect(renders).toBe(3);
      expect(view.result.current).toMatchObject({ idle: true, shown: [6], visible: 1 });

      view.rerender({ names: ["verify", "publish"] });
      expect(view.result.current).toMatchObject({ idle: false, shown: [6], visible: 1 });
      tick(PEN_GAP_MS);
      expect(view.result.current).toMatchObject({ idle: true, shown: [6, 7], visible: 2 });
    } finally {
      window.matchMedia = matchMedia;
    }
  });
});
