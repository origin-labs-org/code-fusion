import { describe, expect, it } from "vitest";
import { SHORTCUT_COMMANDS, isValidShortcutBinding } from "@origin-ai/cf-shared";
import {
  buildShortcutOverridesAfterAppend,
  buildShortcutOverridesAfterSteal,
  buildShortcutOverridesWithoutBindingAt,
  buildShortcutOverridesWithBindingAt,
  checkShortcutBindingConflict,
  isSamePhysicalBinding,
  RESERVED_BINDINGS,
} from "../src/shortcuts/conflicts.js";
import {
  formatShortcutBindingLabel,
  formatShortcutBindingLabelParts,
} from "../src/shortcuts/label.js";
import {
  isEditableShortcutEventTarget,
  isShiftOnlyPrintableBinding,
  isShortcutEventNoise,
  matchesShortcutBinding,
  recordShortcutBinding,
  resolveEffectiveShortcutBindings,
  type ShortcutBindingEvent,
} from "../src/shortcuts/bindings.js";

const MAC = { platform: "MacIntel", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)" };
const WIN = { platform: "Win32", userAgent: "Mozilla/5.0 (Windows NT 10.0)" };
const LINUX = { platform: "Linux x86_64", userAgent: "Mozilla/5.0 (X11; Linux x86_64)" };

function keyEvent(patch: Partial<ShortcutBindingEvent> & { key: string }): ShortcutBindingEvent {
  return {
    code: undefined,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    repeat: false,
    isComposing: false,
    ...patch,
  };
}

describe("快捷键噪声过滤（IME / 长按）", () => {
  it("IME composition (isComposing / Process / Dead / keyCode 229) and repeat are both treated as noise", () => {
    expect(isShortcutEventNoise(keyEvent({ key: "k", isComposing: true }))).toBe(true);
    expect(isShortcutEventNoise(keyEvent({ key: "Process" }))).toBe(true);
    expect(isShortcutEventNoise(keyEvent({ key: "Dead" }))).toBe(true);
    expect(isShortcutEventNoise(keyEvent({ key: "k", keyCode: 229 }))).toBe(true);
    expect(isShortcutEventNoise(keyEvent({ key: "k", repeat: true }))).toBe(true);
    expect(isShortcutEventNoise(keyEvent({ key: "k" }))).toBe(false);
  });

  it("Noise events do not match any bindings", () => {
    const macCmdK = keyEvent({ key: "k", code: "KeyK", metaKey: true });
    expect(matchesShortcutBinding(macCmdK, "CmdOrCtrl+k", MAC)).toBe(true);
    expect(matchesShortcutBinding({ ...macCmdK, isComposing: true }, "CmdOrCtrl+k", MAC)).toBe(
      false,
    );
    expect(matchesShortcutBinding({ ...macCmdK, repeat: true }, "CmdOrCtrl+k", MAC)).toBe(false);
  });
});

describe("Generic shortcut matcher: platform isolation and exact modifier matching", () => {
  it("CmdOrCtrl matches Cmd on Mac and Ctrl on Windows/Linux, with platform isolation", () => {
    const macCmdK = keyEvent({ key: "k", code: "KeyK", metaKey: true });
    const winCtrlK = keyEvent({ key: "k", code: "KeyK", ctrlKey: true });
    expect(matchesShortcutBinding(macCmdK, "CmdOrCtrl+k", MAC)).toBe(true);
    expect(matchesShortcutBinding(macCmdK, "CmdOrCtrl+k", WIN)).toBe(false);
    expect(matchesShortcutBinding(winCtrlK, "CmdOrCtrl+k", WIN)).toBe(true);
    expect(matchesShortcutBinding(winCtrlK, "CmdOrCtrl+k", MAC)).toBe(false);
    expect(matchesShortcutBinding(winCtrlK, "CmdOrCtrl+k", LINUX)).toBe(true);
  });

  it("Extra modifier keys do not match (exact match)", () => {
    const cmdCtrlK = keyEvent({ key: "k", code: "KeyK", metaKey: true, ctrlKey: true });
    expect(matchesShortcutBinding(cmdCtrlK, "CmdOrCtrl+k", MAC)).toBe(false);
    const ctrlShiftJ = keyEvent({ key: "j", code: "KeyJ", ctrlKey: true, shiftKey: true });
    expect(matchesShortcutBinding(ctrlShiftJ, "CmdOrCtrl+j", WIN)).toBe(false);
    expect(matchesShortcutBinding(ctrlShiftJ, "CmdOrCtrl+Shift+j", WIN)).toBe(true);
    const plainJ = keyEvent({ key: "j", code: "KeyJ" });
    expect(matchesShortcutBinding(plainJ, "CmdOrCtrl+j", WIN)).toBe(false);
  });

  it("Triple-modifier combination (CmdOrCtrl+Alt+Shift) exact match", () => {
    const event = keyEvent({ key: "b", code: "KeyB", ctrlKey: true, altKey: true, shiftKey: true });
    expect(matchesShortcutBinding(event, "CmdOrCtrl+Alt+Shift+b", WIN)).toBe(true);
    expect(matchesShortcutBinding(event, "CmdOrCtrl+Alt+b", WIN)).toBe(false);
    expect(matchesShortcutBinding(event, "CmdOrCtrl+Shift+b", WIN)).toBe(false);
  });

  it("macOS explicit Ctrl modifier is independent of CmdOrCtrl", () => {
    const macCtrlP = keyEvent({ key: "p", code: "KeyP", ctrlKey: true });
    expect(matchesShortcutBinding(macCtrlP, "Ctrl+p", MAC)).toBe(true);
    expect(matchesShortcutBinding(macCtrlP, "CmdOrCtrl+p", MAC)).toBe(false);
    expect(matchesShortcutBinding(macCtrlP, "CmdOrCtrl+p", WIN)).toBe(true);
  });

  it("Shift+letter: matches lowercase base key binding when event.key is uppercase", () => {
    const shiftP = keyEvent({ key: "P", code: "KeyP", metaKey: true, shiftKey: true });
    expect(matchesShortcutBinding(shiftP, "CmdOrCtrl+Shift+p", MAC)).toBe(true);
    const winShiftBracket = keyEvent({
      key: "{",
      code: "BracketLeft",
      ctrlKey: true,
      shiftKey: true,
    });
    expect(matchesShortcutBinding(winShiftBracket, "CmdOrCtrl+Shift+[", WIN)).toBe(true);
  });

  it("When macOS Option is involved and key is rewritten by layout, fall back to event.code match", () => {
    const optionCmdB = keyEvent({ key: "ß", code: "KeyB", metaKey: true, altKey: true });
    expect(matchesShortcutBinding(optionCmdB, "CmdOrCtrl+Alt+b", MAC)).toBe(true);
  });

  it("符号键匹配：= - 0 与方括号（zoom 与会话导航命令）", () => {
    const ctrlEqual = keyEvent({ key: "=", code: "Equal", ctrlKey: true });
    expect(matchesShortcutBinding(ctrlEqual, "CmdOrCtrl+=", WIN)).toBe(true);
    const ctrlMinus = keyEvent({ key: "-", code: "Minus", ctrlKey: true });
    expect(matchesShortcutBinding(ctrlMinus, "CmdOrCtrl+-", WIN)).toBe(true);
    const ctrlBracket = keyEvent({ key: "[", code: "BracketLeft", metaKey: true });
    expect(matchesShortcutBinding(ctrlBracket, "CmdOrCtrl+[", MAC)).toBe(true);
  });

  it("AltGr and Ctrl+Alt are the same physical combination; both formats match", () => {
    const altGrQ = keyEvent({ key: "@", code: "KeyQ", ctrlKey: true, altKey: true });
    expect(matchesShortcutBinding(altGrQ, "AltGr+q", WIN)).toBe(true);
    expect(matchesShortcutBinding(altGrQ, "CmdOrCtrl+Alt+q", WIN)).toBe(true);
    const ctrlAltB = keyEvent({ key: "b", code: "KeyB", ctrlKey: true, altKey: true });
    expect(matchesShortcutBinding(ctrlAltB, "CmdOrCtrl+Alt+b", WIN)).toBe(true);
  });

  it("非法绑定串永不命中", () => {
    const ctrlK = keyEvent({ key: "k", code: "KeyK", ctrlKey: true });
    expect(matchesShortcutBinding(ctrlK, "not-a-binding", WIN)).toBe(false);
    expect(matchesShortcutBinding(ctrlK, "CmdOrCtrl+", WIN)).toBe(false);
  });
});

describe("Shortcut recorder", () => {
  it("Cmd on Mac → CmdOrCtrl; Ctrl on Windows/Linux → CmdOrCtrl (cross-platform config portability)", () => {
    const macCmdP = keyEvent({ key: "p", code: "KeyP", metaKey: true });
    expect(recordShortcutBinding(macCmdP, MAC)).toEqual({
      kind: "binding",
      binding: "CmdOrCtrl+p",
    });
    const winCtrlP = keyEvent({ key: "p", code: "KeyP", ctrlKey: true });
    expect(recordShortcutBinding(winCtrlP, WIN)).toEqual({
      kind: "binding",
      binding: "CmdOrCtrl+p",
    });
    const linuxCtrlShiftP = keyEvent({ key: "P", code: "KeyP", ctrlKey: true, shiftKey: true });
    expect(recordShortcutBinding(linuxCtrlShiftP, LINUX)).toEqual({
      kind: "binding",
      binding: "CmdOrCtrl+Shift+p",
    });
  });

  it("macOS explicit Ctrl is recorded as Ctrl+p", () => {
    const macCtrlP = keyEvent({ key: "p", code: "KeyP", ctrlKey: true });
    expect(recordShortcutBinding(macCtrlP, MAC)).toEqual({ kind: "binding", binding: "Ctrl+p" });
  });

  it("Shift+符号用 event.code 反查物理基键（Shift+7 → 7 而非 &）", () => {
    const shift7 = keyEvent({ key: "&", code: "Digit7", ctrlKey: true, shiftKey: true });
    expect(recordShortcutBinding(shift7, WIN)).toEqual({
      kind: "binding",
      binding: "CmdOrCtrl+Shift+7",
    });
  });

  it("Shift-only combinations (no other modifiers) can be recorded normally", () => {
    const shiftF = keyEvent({ key: "F", code: "KeyF", shiftKey: true });
    expect(recordShortcutBinding(shiftF, WIN)).toEqual({ kind: "binding", binding: "Shift+f" });
    const shift7 = keyEvent({ key: "&", code: "Digit7", shiftKey: true });
    expect(recordShortcutBinding(shift7, WIN)).toEqual({ kind: "binding", binding: "Shift+7" });
    const macShiftF = keyEvent({ key: "F", code: "KeyF", shiftKey: true });
    expect(recordShortcutBinding(macShiftF, MAC)).toEqual({ kind: "binding", binding: "Shift+f" });
    expect(matchesShortcutBinding(shiftF, "Shift+f", WIN)).toBe(true);
  });

  it("IME composition events use event.code to resolve physical key in recording state (Shift+letter recordable under Chinese IME)", () => {
    const imeShiftF = keyEvent({ key: "Process", code: "KeyF", shiftKey: true, keyCode: 229 });
    expect(recordShortcutBinding(imeShiftF, WIN)).toEqual({ kind: "binding", binding: "Shift+f" });
    const composingCtrlJ = keyEvent({ key: "j", code: "KeyJ", ctrlKey: true, isComposing: true });
    expect(recordShortcutBinding(composingCtrlJ, WIN)).toEqual({
      kind: "binding",
      binding: "CmdOrCtrl+j",
    });
    const repeated = keyEvent({
      key: "Process",
      code: "KeyF",
      shiftKey: true,
      repeat: true,
    });
    expect(recordShortcutBinding(repeated, WIN)).toEqual({ kind: "pending" });
    expect(matchesShortcutBinding(imeShiftF, "Shift+f", WIN)).toBe(false);
  });

  it("Modifier-only presses and IME noise remain pending (continue waiting for full combination)", () => {
    expect(recordShortcutBinding(keyEvent({ key: "Shift", shiftKey: true }), WIN)).toEqual({
      kind: "pending",
    });
    expect(recordShortcutBinding(keyEvent({ key: "Meta", metaKey: true }), MAC)).toEqual({
      kind: "pending",
    });
    expect(recordShortcutBinding(keyEvent({ key: "Process" }), WIN)).toEqual({ kind: "pending" });
  });

  it("Reject combinations whose platform normalization drops primary modifiers (CR-01: bare single keys not allowed)", () => {
    const macCmdCtrlK = keyEvent({ key: "k", code: "KeyK", metaKey: true, ctrlKey: true });
    expect(recordShortcutBinding(macCmdCtrlK, MAC)).toEqual({
      kind: "invalid",
      reason: "unsupported-key",
    });
    const winMetaK = keyEvent({ key: "k", code: "KeyK", metaKey: true });
    expect(recordShortcutBinding(winMetaK, WIN)).toEqual({
      kind: "invalid",
      reason: "unsupported-key",
    });
    const macCmdCtrlShiftK = keyEvent({
      key: "k",
      code: "KeyK",
      metaKey: true,
      ctrlKey: true,
      shiftKey: true,
    });
    expect(recordShortcutBinding(macCmdCtrlShiftK, MAC)).toEqual({
      kind: "invalid",
      reason: "unsupported-key",
    });
    expect(recordShortcutBinding(keyEvent({ key: "k", code: "KeyK", metaKey: true }), MAC)).toEqual(
      { kind: "binding", binding: "CmdOrCtrl+k" },
    );
    expect(recordShortcutBinding(keyEvent({ key: "k", code: "KeyK", ctrlKey: true }), MAC)).toEqual(
      { kind: "binding", binding: "Ctrl+k" },
    );
    expect(
      recordShortcutBinding(keyEvent({ key: "b", code: "KeyB", ctrlKey: true, altKey: true }), WIN),
    ).toEqual({ kind: "binding", binding: "CmdOrCtrl+Alt+b" });
  });

  it("Shift-only + printable key bindings are determinable (CR-02: requires exemption in editable targets)", () => {
    expect(isShiftOnlyPrintableBinding("Shift+f")).toBe(true);
    expect(isShiftOnlyPrintableBinding("Shift+7")).toBe(true);
    expect(isShiftOnlyPrintableBinding("CmdOrCtrl+Shift+f")).toBe(false);
    expect(isShiftOnlyPrintableBinding("Shift+F1")).toBe(false);
    expect(isShiftOnlyPrintableBinding("CmdOrCtrl+f")).toBe(false);
    expect(isEditableShortcutEventTarget(null)).toBe(false);
  });

  it("Reject regular keys without modifiers (no-modifier); allow standalone F-keys and arrow keys", () => {
    expect(recordShortcutBinding(keyEvent({ key: "p", code: "KeyP" }), WIN)).toEqual({
      kind: "invalid",
      reason: "no-modifier",
    });
    expect(recordShortcutBinding(keyEvent({ key: "F5", code: "F5" }), WIN)).toEqual({
      kind: "binding",
      binding: "F5",
    });
    expect(recordShortcutBinding(keyEvent({ key: "ArrowUp", code: "ArrowUp" }), WIN)).toEqual({
      kind: "binding",
      binding: "ArrowUp",
    });
  });

  it("Recording output is guaranteed to be a valid canonical form (usable directly in setting.json and menu accelerator)", () => {
    const cases = [
      keyEvent({ key: "b", code: "KeyB", ctrlKey: true, altKey: true }),
      keyEvent({ key: "[", code: "BracketLeft", ctrlKey: true, shiftKey: true }),
      keyEvent({ key: "=", code: "Equal", ctrlKey: true }),
    ];
    for (const event of cases) {
      const result = recordShortcutBinding(event, WIN);
      expect(result.kind).toBe("binding");
      if (result.kind === "binding") {
        expect(isValidShortcutBinding(result.binding)).toBe(true);
      }
    }
  });
});

describe("Resolve active shortcut table", () => {
  it("Return default command table bindings when there are no overrides", () => {
    const effective = resolveEffectiveShortcutBindings();
    expect(effective.toggleSidebar).toEqual(["CmdOrCtrl+b"]);
    expect(effective.openCommandCenter).toEqual(["CmdOrCtrl+k", "CmdOrCtrl+Shift+p"]);
  });

  it("Override is full group replacement (both default bindings are invalidated simultaneously)", () => {
    const effective = resolveEffectiveShortcutBindings({ openCommandCenter: ["CmdOrCtrl+e"] });
    expect(effective.openCommandCenter).toEqual(["CmdOrCtrl+e"]);
  });

  it("Invalid override entries are ignored; fall back to default if all are invalid; unknown command IDs are ignored", () => {
    const effective = resolveEffectiveShortcutBindings({
      toggleSidebar: ["CmdOrCtrl+g", "not-legal!!"],
      newTask: ["garbage"],
      unknownCommand: ["CmdOrCtrl+q"],
    });
    expect(effective.toggleSidebar).toEqual(["CmdOrCtrl+g"]);
    expect(effective.newTask).toEqual(["CmdOrCtrl+n"]);
    expect("unknownCommand" in effective).toBe(false);
  });

  it("Explicit empty array = unset (no fallback to default) — preempting clears the preempted command to this state", () => {
    const effective = resolveEffectiveShortcutBindings({ toggleSidebar: [] });
    expect(effective.toggleSidebar).toEqual([]);
  });
});

describe("快捷键冲突检测（拒绝 + 标红）", () => {
  it("保留键（编辑类 / 刷新 / F 键 / 方向键）拒绝为 reserved", () => {
    expect(checkShortcutBindingConflict("toggleSidebar", "CmdOrCtrl+c")).toEqual({
      kind: "reserved",
      binding: "CmdOrCtrl+c",
    });
    expect(checkShortcutBindingConflict("toggleSidebar", "CmdOrCtrl+r")).toMatchObject({
      kind: "reserved",
    });
    expect(checkShortcutBindingConflict("toggleSidebar", "F5")).toMatchObject({ kind: "reserved" });
    expect(checkShortcutBindingConflict("toggleSidebar", "ArrowUp")).toMatchObject({
      kind: "reserved",
    });
  });

  it("Toolbar three-key shortcuts promoted to configurable commands (spec §12.6), no longer in reserved blacklist", () => {
    expect(RESERVED_BINDINGS.has("CmdOrCtrl+m")).toBe(false);
    expect(RESERVED_BINDINGS.has("CmdOrCtrl+Shift+m")).toBe(false);
    expect(RESERVED_BINDINGS.has("CmdOrCtrl+t")).toBe(false);
    expect(checkShortcutBindingConflict("toggleSidebar", "Ctrl+m")).toEqual({
      kind: "occupied",
      ownerCommandId: "openModelMenu",
      binding: "Ctrl+m",
    });
  });

  it("Conflict detection physical equivalence normalization (new CR-01): cross-check recorded output against explicit Ctrl default bindings", () => {
    expect(
      checkShortcutBindingConflict("toggleSidebar", "CmdOrCtrl+m", undefined, {
        platformInfo: WIN,
      }),
    ).toEqual({
      kind: "occupied",
      ownerCommandId: "openModelMenu",
      binding: "CmdOrCtrl+m",
    });
    expect(
      checkShortcutBindingConflict("findInTask", "Ctrl+Alt+b", undefined, { platformInfo: WIN }),
    ).toEqual({
      kind: "occupied",
      ownerCommandId: "toggleSidePane",
      binding: "Ctrl+Alt+b",
    });
  });

  it("macOS ⌘M is the fixed accelerator for system menu minimize and cannot be occupied by any command (new CR-01 Scenario B)", () => {
    expect(
      checkShortcutBindingConflict("toggleSidebar", "CmdOrCtrl+m", undefined, {
        platformInfo: MAC,
      }),
    ).toEqual({ kind: "reserved", binding: "CmdOrCtrl+m" });
    expect(
      checkShortcutBindingConflict("composerSend", "CmdOrCtrl+m", undefined, {
        platformInfo: MAC,
      }),
    ).toEqual({ kind: "reserved", binding: "CmdOrCtrl+m" });
    expect(
      checkShortcutBindingConflict("openModelMenu", "Ctrl+m", undefined, { platformInfo: MAC }),
    ).toBeNull();
  });

  it("Preempting clears physically equivalent entries (new CR-01): preempting with CmdOrCtrl+m also clears openModelMenu default Ctrl+m", () => {
    const next = buildShortcutOverridesAfterSteal(undefined, "toggleSidebar", "CmdOrCtrl+m", {
      platformInfo: WIN,
    });
    expect(next.toggleSidebar).toEqual(["CmdOrCtrl+m"]);
    expect(next.openModelMenu).toEqual([]);
  });

  it("Web menu channel command default keys are treated as reserved; preemption is not supported (CR-04)", () => {
    expect(
      checkShortcutBindingConflict("toggleSidebar", "CmdOrCtrl+n", undefined, {
        menuChannelReserved: true,
      }),
    ).toEqual({ kind: "reserved", binding: "CmdOrCtrl+n" });
    expect(
      checkShortcutBindingConflict("findInTask", "CmdOrCtrl+b", undefined, {
        menuChannelReserved: true,
      }),
    ).toEqual({
      kind: "occupied",
      ownerCommandId: "toggleSidebar",
      binding: "CmdOrCtrl+b",
    });
  });

  it("Occupied by another command (including default bindings) rejected as occupied with occupant details", () => {
    expect(checkShortcutBindingConflict("toggleSidebar", "CmdOrCtrl+n")).toEqual({
      kind: "occupied",
      ownerCommandId: "newTask",
      binding: "CmdOrCtrl+n",
    });
    expect(checkShortcutBindingConflict("toggleSidebar", "CmdOrCtrl+Shift+p")).toEqual({
      kind: "occupied",
      ownerCommandId: "openCommandCenter",
      binding: "CmdOrCtrl+Shift+p",
    });
  });

  it("Command\'s own current bindings do not conflict (full group replacement semantics)", () => {
    expect(checkShortcutBindingConflict("newTask", "CmdOrCtrl+n")).toBeNull();
    expect(checkShortcutBindingConflict("openCommandCenter", "CmdOrCtrl+k")).toBeNull();
  });

  it("Command table default bindings must not intersect with reserved key list (global scope only, spec §12.2)", () => {
    for (const entry of SHORTCUT_COMMANDS) {
      if (entry.scope === "composer") {
        continue;
      }
      for (const binding of entry.defaultBindings) {
        expect(RESERVED_BINDINGS.has(binding)).toBe(false);
      }
    }
  });

  it("Enter is globally blacklisted but not restricted in composer scope (spec §12.2)", () => {
    expect(RESERVED_BINDINGS.has("Enter")).toBe(true);
    expect(checkShortcutBindingConflict("toggleSidebar", "Enter")).toMatchObject({
      kind: "reserved",
    });
    expect(checkShortcutBindingConflict("composerSend", "Enter")).toBeNull();
    expect(checkShortcutBindingConflict("composerSend", "CmdOrCtrl+Enter")).toBeNull();
  });

  it("Conflict detection scope isolation: same key does not conflict between composer and global (spec §12.2)", () => {
    expect(checkShortcutBindingConflict("composerSend", "CmdOrCtrl+k")).toBeNull();
    expect(checkShortcutBindingConflict("toggleSidebar", "Shift+Enter")).toBeNull();
    expect(checkShortcutBindingConflict("composerInsertNewline", "Enter")).toEqual({
      kind: "occupied",
      ownerCommandId: "composerSend",
      binding: "Enter",
    });
  });
});

describe("Key search physical equivalence comparison isSamePhysicalBinding", () => {
  it("Windows/Linux: CmdOrCtrl ≡ explicit Ctrl, AltGr layers Alt bit (aligned with conflict detection)", () => {
    expect(isSamePhysicalBinding("CmdOrCtrl+m", "Ctrl+m", { platformInfo: WIN })).toBe(true);
    expect(isSamePhysicalBinding("Ctrl+Alt+b", "AltGr+b", { platformInfo: WIN })).toBe(true);
    expect(isSamePhysicalBinding("CmdOrCtrl+m", "CmdOrCtrl+Shift+m", { platformInfo: WIN })).toBe(
      false,
    );
    expect(isSamePhysicalBinding("CmdOrCtrl+m", "Ctrl+t", { platformInfo: LINUX })).toBe(false);
  });

  it("Apple: primary modifier (⌘) and Ctrl are distinct physical keys; equivalence flips by platform", () => {
    expect(isSamePhysicalBinding("CmdOrCtrl+m", "Ctrl+m", { platformInfo: MAC })).toBe(false);
  });

  it("裸命名键（composer 作用域默认）与解析失败串", () => {
    expect(isSamePhysicalBinding("Enter", "Enter")).toBe(true);
    expect(isSamePhysicalBinding("Enter", "Shift+Enter")).toBe(false);
    expect(isSamePhysicalBinding("not-a-binding", "Enter")).toBe(false);
  });
});

describe("Multi-line multi-binding builder (spec §8: multiple key sets per command, line-level operations)", () => {
  it("Append: keep all default keys and existing overrides; place new key at the end", () => {
    const next = buildShortcutOverridesAfterAppend(undefined, "openCommandCenter", "CmdOrCtrl+g");
    expect(next.openCommandCenter).toEqual(["CmdOrCtrl+k", "CmdOrCtrl+Shift+p", "CmdOrCtrl+g"]);
    const replaced = buildShortcutOverridesAfterAppend(
      { openCommandCenter: ["Ctrl+y"] },
      "openCommandCenter",
      "CmdOrCtrl+g",
    );
    expect(replaced.openCommandCenter).toEqual(["Ctrl+y", "CmdOrCtrl+g"]);
    const fromEmpty = buildShortcutOverridesAfterAppend(
      { toggleSidebar: [] },
      "toggleSidebar",
      "CmdOrCtrl+b",
    );
    expect(fromEmpty.toggleSidebar).toEqual(["CmdOrCtrl+b"]);
  });

  it("Delete: remove specified entry; clearing all results in explicit [] (unassigned) without affecting other commands", () => {
    const next = buildShortcutOverridesWithoutBindingAt(undefined, "openCommandCenter", 0);
    expect(next.openCommandCenter).toEqual(["CmdOrCtrl+Shift+p"]);
    const last = buildShortcutOverridesWithoutBindingAt(
      { openCommandCenter: ["CmdOrCtrl+k"], toggleSidebar: ["CmdOrCtrl+b"] },
      "openCommandCenter",
      0,
    );
    expect(last.openCommandCenter).toEqual([]);
    expect(last.toggleSidebar).toEqual(["CmdOrCtrl+b"]);
  });

  it("Replace: substitute new key at specified position, keeping other entries (including default keys)", () => {
    const next = buildShortcutOverridesWithBindingAt(
      undefined,
      "openCommandCenter",
      1,
      "CmdOrCtrl+g",
    );
    expect(next.openCommandCenter).toEqual(["CmdOrCtrl+k", "CmdOrCtrl+g"]);
    const first = buildShortcutOverridesWithBindingAt(undefined, "openCommandCenter", 0, "Ctrl+y");
    expect(first.openCommandCenter).toEqual(["Ctrl+y", "CmdOrCtrl+Shift+p"]);
  });
});

describe("Shortcut preemption confirmation", () => {
  it("After preemption, target command binds new key, and preempted command default binding is cleared to \"unset\"", () => {
    const next = buildShortcutOverridesAfterSteal(undefined, "findInTask", "CmdOrCtrl+b");
    expect(next.findInTask).toEqual(["CmdOrCtrl+b"]);
    expect(next.toggleSidebar).toEqual([]);
    const effective = resolveEffectiveShortcutBindings(next);
    expect(effective.findInTask).toEqual(["CmdOrCtrl+b"]);
    expect(effective.toggleSidebar).toEqual([]);
  });

  it("When preempted command has multiple default bindings, remove only the preempted one and keep the rest", () => {
    const next = buildShortcutOverridesAfterSteal(undefined, "toggleTerminal", "CmdOrCtrl+k");
    expect(next.toggleTerminal).toEqual(["CmdOrCtrl+k"]);
    expect(next.openCommandCenter).toEqual(["CmdOrCtrl+Shift+p"]);
  });

  it("Preemption layers on top of existing overrides without losing overrides for unrelated commands", () => {
    const next = buildShortcutOverridesAfterSteal(
      { toggleSidebar: ["CmdOrCtrl+g"] },
      "findInTask",
      "CmdOrCtrl+j",
    );
    expect(next.toggleSidebar).toEqual(["CmdOrCtrl+g"]);
    expect(next.findInTask).toEqual(["CmdOrCtrl+j"]);
    expect(next.toggleTerminal).toEqual([]);
  });

  it("Multi-binding command line-level preemption: replace only swaps target entry, keeping other bindings (CR-01)", () => {
    const replaceFirst = buildShortcutOverridesAfterSteal(
      undefined,
      "toggleTerminal",
      "CmdOrCtrl+k",
      { mode: "replace", bindingIndex: 0 },
    );
    expect(replaceFirst.toggleTerminal).toEqual(["CmdOrCtrl+k"]);
    expect(replaceFirst.openCommandCenter).toEqual(["CmdOrCtrl+Shift+p"]);
    const replaceSecond = buildShortcutOverridesAfterSteal(
      undefined,
      "toggleTerminal",
      "CmdOrCtrl+k",
      { mode: "replace", bindingIndex: 1 },
    );
    expect(replaceSecond.openCommandCenter).toEqual(["CmdOrCtrl+Shift+p"]);
  });

  it("Multi-binding command line-level preemption: record first entry for unassigned (append) and default legacy behavior", () => {
    const appendSteal = buildShortcutOverridesAfterSteal(
      undefined,
      "toggleTerminal",
      "CmdOrCtrl+k",
      { mode: "replace", bindingIndex: null },
    );
    expect(appendSteal.toggleTerminal).toEqual(["CmdOrCtrl+j", "CmdOrCtrl+k"]);
    expect(appendSteal.openCommandCenter).toEqual(["CmdOrCtrl+Shift+p"]);
    const addSteal = buildShortcutOverridesAfterSteal(undefined, "toggleTerminal", "CmdOrCtrl+k", {
      mode: "add",
      bindingIndex: null,
    });
    expect(addSteal.openCommandCenter).toEqual(["CmdOrCtrl+Shift+p"]);
    const legacy = buildShortcutOverridesAfterSteal(undefined, "toggleTerminal", "CmdOrCtrl+k");
    expect(legacy.openCommandCenter).toEqual(["CmdOrCtrl+Shift+p"]);
  });
});

describe("快捷键展示 label", () => {
  it("macOS symbol style, modifiers ordered as ⌃⌥⇧⌘", () => {
    expect(formatShortcutBindingLabel("CmdOrCtrl+k", MAC)).toBe("⌘ K");
    expect(formatShortcutBindingLabel("CmdOrCtrl+Shift+p", MAC)).toBe("⇧ ⌘ P");
    expect(formatShortcutBindingLabel("CmdOrCtrl+Alt+b", MAC)).toBe("⌥ ⌘ B");
    expect(formatShortcutBindingLabel("Ctrl+p", MAC)).toBe("⌃ P");
  });

  it("Windows/Linux 文字风格", () => {
    expect(formatShortcutBindingLabel("CmdOrCtrl+k", WIN)).toBe("Ctrl+K");
    expect(formatShortcutBindingLabel("CmdOrCtrl+Alt+Shift+b", LINUX)).toBe("Ctrl+Alt+Shift+B");
    expect(formatShortcutBindingLabel("Ctrl+p", WIN)).toBe("Ctrl+P");
  });

  it("Zoom semantics: = displays as +, - preserved", () => {
    expect(formatShortcutBindingLabel("CmdOrCtrl+=", WIN)).toBe("Ctrl++");
    expect(formatShortcutBindingLabel("CmdOrCtrl+-", WIN)).toBe("Ctrl+-");
  });

  it("Per-key token: same order and meaning as label, rendering keycaps individually (spec §8)", () => {
    expect(formatShortcutBindingLabelParts("CmdOrCtrl+Shift+p", MAC)).toEqual(["⇧", "⌘", "P"]);
    expect(formatShortcutBindingLabelParts("Ctrl+Alt+Shift+b", LINUX)).toEqual([
      "Ctrl",
      "Alt",
      "Shift",
      "B",
    ]);
    expect(formatShortcutBindingLabelParts("CmdOrCtrl+Enter", MAC)).toEqual(["⌘", "Enter"]);
    expect(formatShortcutBindingLabelParts("CmdOrCtrl+k", MAC).join(" ")).toBe(
      formatShortcutBindingLabel("CmdOrCtrl+k", MAC),
    );
    expect(formatShortcutBindingLabelParts("CmdOrCtrl+k", WIN).join("+")).toBe(
      formatShortcutBindingLabel("CmdOrCtrl+k", WIN),
    );
    expect(formatShortcutBindingLabelParts("not-a-binding", WIN)).toEqual(["not-a-binding"]);
  });
});
