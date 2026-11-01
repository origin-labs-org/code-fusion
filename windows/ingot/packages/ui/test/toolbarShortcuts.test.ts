import { describe, expect, it } from "vitest";
import { resolveEffectiveShortcutBindings } from "../src/shortcuts/bindings.js";
import { resolveToolbarShortcutAction } from "../src/v4/composer/toolbarShortcuts.js";
import type { CfConfigOption } from "@origin-ai/cf-shared";

function toolbarEvent(patch: Partial<Parameters<typeof resolveToolbarShortcutAction>[0]> = {}) {
  return {
    key: "m",
    code: "KeyM",
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    repeat: false,
    isComposing: false,
    ...patch,
  };
}

const modelOption = {
  type: "select",
  category: "model",
  currentValue: "m1",
  options: [],
} as unknown as CfConfigOption;
const modeOption = {
  type: "select",
  category: "mode",
  currentValue: "a",
  options: [],
} as unknown as CfConfigOption;
const thoughtOption = {
  type: "select",
  category: "thought_level",
  currentValue: "low",
  options: [],
} as unknown as CfConfigOption;

const enabledState = {
  hasAnyOption: true,
  toolbarDisabled: false,
  modelMenuDisabled: false,
  modelOption,
  modeOption,
  thoughtOption,
};

describe("composer Tools条热键按生效表解析（spec §12.6）", () => {
  it("Default表：Ctrl+M / Ctrl+Shift+M / Ctrl+T 分别HitThree个动作", () => {
    const effective = resolveEffectiveShortcutBindings(undefined);
    expect(
      resolveToolbarShortcutAction(toolbarEvent({ ctrlKey: true }), effective, enabledState),
    ).toBe("openModelMenu");
    expect(
      resolveToolbarShortcutAction(
        toolbarEvent({ key: "m", code: "KeyM", ctrlKey: true, shiftKey: true }),
        effective,
        enabledState,
      ),
    ).toBe("cycleSessionMode");
    expect(
      resolveToolbarShortcutAction(
        toolbarEvent({ key: "t", code: "KeyT", ctrlKey: true }),
        effective,
        enabledState,
      ),
    ).toBe("cycleThoughtLevel");
  });

  it("改绑后按New键位Hit：openModelMenu 改绑 Ctrl+Y", () => {
    const effective = resolveEffectiveShortcutBindings({ openModelMenu: ["Ctrl+y"] });
    expect(
      resolveToolbarShortcutAction(toolbarEvent({ ctrlKey: true }), effective, enabledState),
    ).toBeNull();
    expect(
      resolveToolbarShortcutAction(
        toolbarEvent({ key: "y", code: "KeyY", ctrlKey: true }),
        effective,
        enabledState,
      ),
    ).toBe("openModelMenu");
  });

  it("门控Retain：disabled / 无选项 / defaultPrevented / repeat 不触发动作", () => {
    const effective = resolveEffectiveShortcutBindings(undefined);
    const ctrlM = toolbarEvent({ ctrlKey: true });
    expect(
      resolveToolbarShortcutAction(ctrlM, effective, { ...enabledState, toolbarDisabled: true }),
    ).toBeNull();
    expect(
      resolveToolbarShortcutAction(ctrlM, effective, {
        ...enabledState,
        modelMenuDisabled: true,
      }),
    ).toBeNull();
    expect(
      resolveToolbarShortcutAction(ctrlM, effective, { ...enabledState, modelOption: undefined }),
    ).toBeNull();
    expect(
      resolveToolbarShortcutAction({ ...ctrlM, defaultPrevented: true }, effective, enabledState),
    ).toBeNull();
    expect(
      resolveToolbarShortcutAction({ ...ctrlM, repeat: true }, effective, enabledState),
    ).toBeNull();
  });

  it("mac 语义：显式 Ctrl Hit，Cmd+M 不Hit（与Old固定热键One致）", () => {
    const effective = resolveEffectiveShortcutBindings(undefined);
    const macState = { ...enabledState };
    expect(
      resolveToolbarShortcutAction(
        toolbarEvent({ key: "m", code: "KeyM", ctrlKey: true, metaKey: false }),
        effective,
        macState,
      ),
    ).toBe("openModelMenu");
    expect(
      resolveToolbarShortcutAction(toolbarEvent({ metaKey: true }), effective, macState),
    ).toBeNull();
  });
});
