import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ThoughtLevelCycleControl } from "@/chat-input-toolbar/ThoughtLevelCycleControl.js";
import { getNextThoughtLevelValue } from "@/chat-input-toolbar/thoughtLevelOptions.js";
import { TooltipProvider } from "@/components/ui/tooltip.js";
import type { CfConfigOption } from "@origin-ai/cf-shared";

const zhIntl = {
  formatMessage({ id }: { id: string }) {
    return (
      {
        "chat.toolbar.thoughtLevel.tooltip": "Thinking级别",
        "chat.toolbar.thoughtLevel.placeholder": "选择Thinking档位",
        "chat.toolbar.thoughtLevel.value.max": "Highest",
      }[id] ?? id
    );
  },
};

function renderWithTooltipProvider(element: ReactElement) {
  return renderToStaticMarkup(createElement(TooltipProvider, null, element));
}

describe("ThoughtLevelCycleControl", () => {
  it.each([
    ["high", "100%"],
    ["off", "0%"],
    ["ultra", "50%"],
    ["missing", "0%"],
  ])("Close项在Medium间时 %s 的阶梯进度为 %s", (currentValue, progress) => {
    const html = renderWithTooltipProvider(
      createElement(ThoughtLevelCycleControl, {
        option: {
          id: "thought_level",
          category: "thought_level",
          type: "select",
          currentValue,
          options: [
            { value: "ultra", name: "Ultra" },
            { value: "off", name: "Off" },
            { value: "high", name: "High" },
          ],
        },
        intl: zhIntl,
        triggerRef: { current: null },
        onValueChange: vi.fn(),
      }),
    );
    expect(html).toContain(`height:${progress}`);
  });
  it.each([false, true])(
    "Empty valueShow待选择而非第One档，Retain非法ValueMode=%s",
    (showInvalidCurrentValue) => {
      const html = renderWithTooltipProvider(
        createElement(ThoughtLevelCycleControl, {
          option: {
            id: "thought_level",
            type: "select",
            currentValue: "",
            options: [{ value: "max", name: "Max" }],
          },
          intl: zhIntl,
          labelVisibilityClassName: "",
          showInvalidCurrentValue,
          triggerRef: { current: null },
          onValueChange: vi.fn(),
        }),
      );
      expect(html).toContain('aria-label="选择Thinking档位"');
      expect(html).toContain('role="combobox"');
      expect(html).not.toContain('data-thought-level-fixed="true"');
      expect(html).toContain("height:0%");
    },
  );

  it("单档位只读展示，不渲染可展开的选择器", () => {
    const option: CfConfigOption = {
      id: "thought_level",
      category: "thought_level",
      type: "select",
      currentValue: "max",
      options: [{ value: "max", name: "Max" }],
    };

    const html = renderWithTooltipProvider(
      createElement(ThoughtLevelCycleControl, {
        option,
        intl: zhIntl,
        labelVisibilityClassName: "",
        triggerRef: { current: null },
        onValueChange: vi.fn(),
      }),
    );

    expect(html).toContain('data-thought-level-fixed="true"');
    expect(html).toContain("Highest");
    expect(html).not.toContain('role="combobox"');
  });

  it("非法历史Value遇到单档Model时仍渲染选择器以便修正", () => {
    const option: CfConfigOption = {
      id: "thought_level",
      category: "thought_level",
      type: "select",
      currentValue: "medium",
      options: [{ value: "max", name: "Max" }],
    };

    const html = renderWithTooltipProvider(
      createElement(ThoughtLevelCycleControl, {
        option,
        intl: zhIntl,
        labelVisibilityClassName: "",
        showInvalidCurrentValue: true,
        triggerRef: { current: null },
        onValueChange: vi.fn(),
      }),
    );

    expect(html).not.toContain('data-thought-level-fixed="true"');
    expect(html).toContain('role="combobox"');
    expect(html).toContain("medium");
    expect(html).toContain("height:0%");
  });

  it("TextCharacterCollapse时仍RetainCurrent阶梯Copy用于 tooltip and可访QuestionLetter息", () => {
    const option: CfConfigOption = {
      id: "thought_level",
      category: "thought_level",
      type: "select",
      currentValue: "max",
      options: [
        { value: "off", name: "Off" },
        { value: "max", name: "Max" },
      ],
    };

    const html = renderWithTooltipProvider(
      createElement(ThoughtLevelCycleControl, {
        option,
        intl: zhIntl,
        labelVisibilityClassName: "hidden",
        triggerRef: { current: null },
        onValueChange: vi.fn(),
      }),
    );

    expect(html).toContain('aria-label="最高"');
    expect(html).toContain('title="最高"');
    expect(html).toContain("Highest");
  });

  it("Retain cycle Mode用于恢复Legacy version点击循环交互", () => {
    const option: CfConfigOption = {
      id: "thought_level",
      category: "thought_level",
      type: "select",
      currentValue: "max",
      options: [
        { value: "off", name: "Off" },
        { value: "max", name: "Max" },
      ],
    };

    const html = renderWithTooltipProvider(
      createElement(ThoughtLevelCycleControl, {
        option,
        intl: zhIntl,
        interactionMode: "cycle",
        labelVisibilityClassName: "",
        triggerRef: { current: null },
        onValueChange: vi.fn(),
      }),
    );

    expect(html).toContain('type="button"');
    expect(html).toContain("Highest");
  });

  it("Ctrl+T Fast切换按展示顺序选择下One个Thinking档位", () => {
    const option: CfConfigOption = {
      id: "thought_level",
      category: "thought_level",
      type: "select",
      currentValue: "low",
      options: [
        { value: "high", name: "High" },
        { value: "off", name: "Off" },
        { value: "low", name: "Low" },
      ],
    };

    expect(getNextThoughtLevelValue(option)).toBe("high");
  });

  it("Ctrl+T 不循环唯OneThinking档位", () => {
    expect(
      getNextThoughtLevelValue({
        type: "select",
        currentValue: "max",
        options: [{ value: "max", name: "Max" }],
      }),
    ).toBeNull();
  });
});
