
import { parseShortcutBinding, SHORTCUT_COMMANDS, type ShortcutCommandId } from "@origin-ai/cf-shared";

import {
  isAppleKeyboardPlatform,
  type KeyboardShortcutPlatformInfo,
} from "../lib/keyboardShortcuts.js";
import { resolveEffectiveShortcutBindings } from "./bindings.js";

export const RESERVED_BINDINGS: ReadonlySet<string> = new Set([
  ...["c", "v", "x", "z", "a", "y", "s", "p", "l"].map((key) => `CmdOrCtrl+${key}`),
  "CmdOrCtrl+Shift+z",
  "CmdOrCtrl+r",
  "CmdOrCtrl+Shift+r",
  "CmdOrCtrl+Shift+i",
  "CmdOrCtrl+Shift+j",
  "CmdOrCtrl+Shift+c",
  ...Array.from({ length: 12 }, (_, index) => `F${index + 1}`),
  ...Array.from({ length: 12 }, (_, index) => `CmdOrCtrl+F${index + 1}`),
  ...Array.from({ length: 12 }, (_, index) => `CmdOrCtrl+Shift+F${index + 1}`),
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Enter",
]);

const MACOS_MENU_RESERVED_BINDINGS: ReadonlySet<string> = new Set(["CmdOrCtrl+m"]);

function canonicalBindingKey(binding: string, isApple: boolean): string | null {
  const parsed = parseShortcutBinding(binding);
  if (parsed === null) {
    return null;
  }
  if (isApple) {
    return `${parsed.cmdOrCtrl || parsed.altGr ? 1 : 0}${parsed.ctrl ? 1 : 0}${
      parsed.alt || parsed.altGr ? 1 : 0
    }${parsed.shift ? 1 : 0}:${parsed.key}`;
  }
  return `${parsed.cmdOrCtrl || parsed.ctrl || parsed.altGr ? 1 : 0}${
    parsed.alt || parsed.altGr ? 1 : 0
  }${parsed.shift ? 1 : 0}:${parsed.key}`;
}

export function isSamePhysicalBinding(
  a: string,
  b: string,
  options?: { platformInfo?: KeyboardShortcutPlatformInfo },
): boolean {
  const isApple = isAppleKeyboardPlatform(options?.platformInfo);
  const keyA = canonicalBindingKey(a, isApple);
  const keyB = canonicalBindingKey(b, isApple);
  return keyA !== null && keyA === keyB;
}

let reservedCanonicalKeysCache: {
  apple: ReadonlySet<string>;
  nonApple: ReadonlySet<string>;
} | null = null;
function getReservedCanonicalKeys(): {
  apple: ReadonlySet<string>;
  nonApple: ReadonlySet<string>;
} {
  if (reservedCanonicalKeysCache === null) {
    const apple = new Set<string>();
    const nonApple = new Set<string>();
    for (const binding of RESERVED_BINDINGS) {
      const appleKey = canonicalBindingKey(binding, true);
      if (appleKey !== null) {
        apple.add(appleKey);
      }
      const nonAppleKey = canonicalBindingKey(binding, false);
      if (nonAppleKey !== null) {
        nonApple.add(nonAppleKey);
      }
    }
    reservedCanonicalKeysCache = { apple, nonApple };
  }
  return reservedCanonicalKeysCache;
}

export interface ShortcutBindingConflict {
  kind: "reserved" | "occupied";
  
  ownerCommandId?: ShortcutCommandId;
  binding: string;
}

export function checkShortcutBindingConflict(
  commandId: ShortcutCommandId,
  newBinding: string,
  overrides?: Record<string, readonly string[]>,
  options?: {
    menuChannelReserved?: boolean;
    
    platformInfo?: KeyboardShortcutPlatformInfo;
  },
): ShortcutBindingConflict | null {
  const commandEntry = SHORTCUT_COMMANDS.find((entry) => entry.id === commandId);
  const commandScope = commandEntry?.scope ?? "global";
  const isApple = isAppleKeyboardPlatform(options?.platformInfo);
  const newKey = canonicalBindingKey(newBinding, isApple);
  if (isApple && MACOS_MENU_RESERVED_BINDINGS.has(newBinding)) {
    return { kind: "reserved", binding: newBinding };
  }
  if (commandScope === "global") {
    if (newKey !== null && getReservedCanonicalKeys()[isApple ? "apple" : "nonApple"].has(newKey)) {
      return { kind: "reserved", binding: newBinding };
    }
  }
  const effective = resolveEffectiveShortcutBindings(overrides);
  for (const entry of SHORTCUT_COMMANDS) {
    if (entry.id === commandId) {
      continue;
    }
    if ((entry.scope ?? "global") !== commandScope) {
      continue;
    }
    for (const binding of effective[entry.id] ?? []) {
      const candidateKey = canonicalBindingKey(binding, isApple);
      if (newKey !== null && candidateKey === newKey) {
        if (options?.menuChannelReserved && entry.channel === "menu") {
          return { kind: "reserved", binding: newBinding };
        }
        return { kind: "occupied", ownerCommandId: entry.id, binding: newBinding };
      }
    }
  }
  return null;
}

export function buildShortcutOverridesAfterSteal(
  overrides: Record<string, readonly string[]> | undefined,
  commandId: ShortcutCommandId,
  newBinding: string,
  options?: {
    platformInfo?: KeyboardShortcutPlatformInfo;
    
    mode?: "replace" | "add";
    
    bindingIndex?: number | null;
  },
): Record<string, string[]> {
  const isApple = isAppleKeyboardPlatform(options?.platformInfo);
  const newKey = canonicalBindingKey(newBinding, isApple);
  const effective = resolveEffectiveShortcutBindings(overrides);
  const commandEntry = SHORTCUT_COMMANDS.find((entry) => entry.id === commandId);
  const commandScope = commandEntry?.scope ?? "global";
  const next: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(overrides ?? {})) {
    next[key] = [...value];
  }
  const currentBindings = effective[commandId] ?? [];
  if (options?.mode === "replace" && options.bindingIndex != null) {
    const target = options.bindingIndex;
    next[commandId] = currentBindings.map((binding, index) =>
      index === target ? newBinding : binding,
    );
  } else if (options?.mode === "add" || options?.bindingIndex === null) {
    next[commandId] = [...currentBindings, newBinding];
  } else {
    next[commandId] = [newBinding];
  }
  for (const entry of SHORTCUT_COMMANDS) {
    if (entry.id === commandId) {
      continue;
    }
    if ((entry.scope ?? "global") !== commandScope) {
      continue;
    }
    const remaining = (effective[entry.id] ?? []).filter((binding) => {
      const candidateKey = canonicalBindingKey(binding, isApple);
      return newKey === null || candidateKey !== newKey;
    });
    if (remaining.length !== (effective[entry.id] ?? []).length) {
      next[entry.id] = remaining;
    }
  }
  return next;
}

export function buildShortcutOverridesAfterAppend(
  overrides: Record<string, readonly string[]> | undefined,
  commandId: ShortcutCommandId,
  newBinding: string,
): Record<string, string[]> {
  const effective = resolveEffectiveShortcutBindings(overrides);
  const next: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(overrides ?? {})) {
    next[key] = [...value];
  }
  next[commandId] = [...(effective[commandId] ?? []), newBinding];
  return next;
}

export function buildShortcutOverridesWithoutBindingAt(
  overrides: Record<string, readonly string[]> | undefined,
  commandId: ShortcutCommandId,
  bindingIndex: number,
): Record<string, string[]> {
  const effective = resolveEffectiveShortcutBindings(overrides);
  const next: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(overrides ?? {})) {
    next[key] = [...value];
  }
  next[commandId] = (effective[commandId] ?? []).filter((_, index) => index !== bindingIndex);
  return next;
}

export function buildShortcutOverridesWithBindingAt(
  overrides: Record<string, readonly string[]> | undefined,
  commandId: ShortcutCommandId,
  bindingIndex: number,
  newBinding: string,
): Record<string, string[]> {
  const effective = resolveEffectiveShortcutBindings(overrides);
  const next: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(overrides ?? {})) {
    next[key] = [...value];
  }
  next[commandId] = (effective[commandId] ?? []).map((binding, index) =>
    index === bindingIndex ? newBinding : binding,
  );
  return next;
}
