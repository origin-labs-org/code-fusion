import { describe, expect, it } from "vitest";
import type { ShortcutBindingEvent } from "../src/shortcuts/bindings.js";
import {
  resolveComposerKeyAction,
  shouldBareEnterFallThroughToNewline,
  type ComposerEffectiveBindings,
} from "../src/shortcuts/composerShortcuts.js";
import { getDefaultShortcutBindings } from "@origin-ai/cf-shared";

function enterEvent(patch: Partial<ShortcutBindingEvent> = {}): ShortcutBindingEvent {
  return {
    key: "Enter",
    code: "Enter",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    repeat: false,
    isComposing: false,
    ...patch,
  };
}

function defaultEffective(): ComposerEffectiveBindings {
  return {
    composerSend: getDefaultShortcutBindings("composerSend"),
    composerInsertNewline: getDefaultShortcutBindings("composerInsertNewline"),
  };
}

function ctrlEnterEffective(): ComposerEffectiveBindings {
  return { ...defaultEffective(), composerSend: ["CmdOrCtrl+Enter"] };
}

const MAC = { platform: "MacIntel", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)" };
const WIN = { platform: "Win32", userAgent: "Mozilla/5.0 (Windows NT 10.0)" };
const LINUX = { platform: "Linux x86_64", userAgent: "Mozilla/5.0 (X11; Linux x86_64)" };

describe("Composer-scoped keybinding resolution (spec §12.3)", () => {
  it("Default table: bare Enter sends, Shift+Enter inserts newline", () => {
    expect(resolveComposerKeyAction(enterEvent(), defaultEffective())).toBe("send");
    expect(resolveComposerKeyAction(enterEvent({ shiftKey: true }), defaultEffective())).toBe(
      "newline",
    );
  });

  it("After rebind: CmdOrCtrl+Enter sends, bare Enter miss delegates to main chain fallback for newline (Ctrl+Enter user scenario)", () => {
    const effective = ctrlEnterEffective();
    expect(resolveComposerKeyAction(enterEvent({ ctrlKey: true }), effective, WIN)).toBe("send");
    expect(resolveComposerKeyAction(enterEvent(), effective, WIN)).toBeNull();
    expect(shouldBareEnterFallThroughToNewline(effective)).toBe(true);
  });

  it("Zero changes for Shift+Enter users: bare Enter still sends under default table", () => {
    expect(shouldBareEnterFallThroughToNewline(defaultEffective())).toBe(false);
  });

  it("Non-Enter events miss default table (only matches when rebound to non-Enter keys under open policy, SG-09)", () => {
    expect(
      resolveComposerKeyAction(enterEvent({ key: "k", code: "KeyK" }), defaultEffective()),
    ).toBe(null);
    const f9Effective: ComposerEffectiveBindings = {
      ...defaultEffective(),
      composerSend: ["F9"],
    };
    expect(
      resolveComposerKeyAction(enterEvent({ key: "F9", code: "F9", ctrlKey: false }), f9Effective),
    ).toBe("send");
    expect(
      resolveComposerKeyAction(enterEvent({ key: "F9", code: "F9" }), defaultEffective()),
    ).toBe(null);
    const f2Newline: ComposerEffectiveBindings = {
      ...defaultEffective(),
      composerInsertNewline: ["F2"],
    };
    expect(
      resolveComposerKeyAction(enterEvent({ key: "F2", code: "F2", shiftKey: false }), f2Newline),
    ).toBe("newline");
  });

  it("When unbound (explicit empty array), all resolver matches fail and main chain pre-check falls back to newline", () => {
    const effective: ComposerEffectiveBindings = {
      composerSend: [],
      composerInsertNewline: [],
    };
    expect(resolveComposerKeyAction(enterEvent(), effective)).toBeNull();
    expect(resolveComposerKeyAction(enterEvent({ ctrlKey: true }), effective)).toBeNull();
    expect(resolveComposerKeyAction(enterEvent({ shiftKey: true }), effective)).toBeNull();
    expect(shouldBareEnterFallThroughToNewline(effective)).toBe(true);
  });

  it("Unmatched modifier combinations return null in default state (main chain reverse delivery/newline semantics unaffected)", () => {
    expect(resolveComposerKeyAction(enterEvent({ ctrlKey: true }), defaultEffective())).toBeNull();
    expect(resolveComposerKeyAction(enterEvent({ metaKey: true }), defaultEffective())).toBeNull();
  });

  // ============================================================================
  // ============================================================================

  it("mac: bare Enter sends and Shift+Enter inserts newline in default table; Cmd+Enter misses (main chain reverse delivery semantics preserved)", () => {
    expect(resolveComposerKeyAction(enterEvent(), defaultEffective(), MAC)).toBe("send");
    expect(resolveComposerKeyAction(enterEvent({ shiftKey: true }), defaultEffective(), MAC)).toBe(
      "newline",
    );
    expect(
      resolveComposerKeyAction(enterEvent({ metaKey: true }), defaultEffective(), MAC),
    ).toBeNull();
    expect(
      resolveComposerKeyAction(enterEvent({ altKey: true }), defaultEffective(), MAC),
    ).toBeNull();
  });

  it("mac: Cmd+Enter sends after rebinding CmdOrCtrl+Enter; explicit Ctrl+Enter misses (preserves system editor semantics)", () => {
    const effective = ctrlEnterEffective();
    expect(resolveComposerKeyAction(enterEvent({ metaKey: true }), effective, MAC)).toBe("send");
    expect(resolveComposerKeyAction(enterEvent({ ctrlKey: true }), effective, MAC)).toBeNull();
  });

  it("win/linux: Ctrl+Enter matches CmdOrCtrl rebind; Win/Super+Enter blocked by bare key guard", () => {
    const effective = ctrlEnterEffective();

    expect(resolveComposerKeyAction(enterEvent({ ctrlKey: true }), effective, LINUX)).toBe("send");
    expect(resolveComposerKeyAction(enterEvent({ metaKey: true }), effective, WIN)).toBeNull();
    expect(
      resolveComposerKeyAction(enterEvent({ metaKey: true }), defaultEffective(), LINUX),
    ).toBeNull();
  });
});
