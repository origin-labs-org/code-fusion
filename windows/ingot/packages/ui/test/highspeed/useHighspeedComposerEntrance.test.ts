// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useHighspeedComposerEntrance } from "@/highspeed/useHighspeedComposerEntrance.js";

type EntranceProps = {
  cardId: string | null;
  activationCardId: string | null;
};

function renderEntrance(initialProps: EntranceProps) {
  const onActivationApplied = vi.fn();
  const hook = renderHook(
    (props: EntranceProps) => useHighspeedComposerEntrance({ ...props, onActivationApplied }),
    { initialProps },
  );
  return { ...hook, onActivationApplied };
}

describe("useHighspeedComposerEntrance", () => {
  it("draw NewHit播放One次激活，锁定后立即消费Request，RequestClear后仍保持本次激活", () => {
    const { result, rerender, onActivationApplied } = renderEntrance({
      cardId: null,
      activationCardId: null,
    });

    rerender({ cardId: "card-1", activationCardId: "card-1" });
    expect(result.current).toBe("activation");
    expect(onActivationApplied).toHaveBeenCalledTimes(1);
    expect(onActivationApplied).toHaveBeenCalledWith("card-1");

    rerender({ cardId: "card-1", activationCardId: null });
    expect(result.current).toBe("activation");
    expect(onActivationApplied).toHaveBeenCalledTimes(1);
  });

  it("没有激活Request时呈现的卡（切回 Task、快照恢复）直接按 restore 入场", () => {
    const { result, rerender, onActivationApplied } = renderEntrance({
      cardId: null,
      activationCardId: null,
    });

    rerender({ cardId: "card-1", activationCardId: null });

    expect(result.current).toBe("restore");
    expect(onActivationApplied).not.toHaveBeenCalled();
  });

  it("激活过的卡切走再切回时不Replay", () => {
    const { result, rerender } = renderEntrance({ cardId: null, activationCardId: null });
    rerender({ cardId: "card-1", activationCardId: "card-1" });
    rerender({ cardId: "card-1", activationCardId: null });

    rerender({ cardId: null, activationCardId: null });
    rerender({ cardId: "card-1", activationCardId: null });

    expect(result.current).toBe("restore");
  });

  it("组件重挂载（如Exit分享Mode）时同One张卡按 restore 入场", () => {
    const { result, onActivationApplied } = renderEntrance({
      cardId: "card-1",
      activationCardId: null,
    });

    expect(result.current).toBe("restore");
    expect(onActivationApplied).not.toHaveBeenCalled();
  });

  it("激活Request与Current卡不One致时不播放也不消费", () => {
    const { result, onActivationApplied } = renderEntrance({
      cardId: "card-2",
      activationCardId: "card-1",
    });

    expect(result.current).toBe("restore");
    expect(onActivationApplied).not.toHaveBeenCalled();
  });

  it("挂载时已有匹配的待消费Request（draw Hit时 composer 未挂载）仍播放One次", () => {
    const { result, onActivationApplied } = renderEntrance({
      cardId: "card-1",
      activationCardId: "card-1",
    });

    expect(result.current).toBe("activation");
    expect(onActivationApplied).toHaveBeenCalledTimes(1);
    expect(onActivationApplied).toHaveBeenCalledWith("card-1");
  });
});
