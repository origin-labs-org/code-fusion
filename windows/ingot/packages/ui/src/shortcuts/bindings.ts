
import {
  type ParsedShortcutBinding,
  type ShortcutCommandId,
  parseShortcutBinding,
  serializeShortcutBinding,
  SHORTCUT_COMMANDS,
} from "@origin-ai/cf-shared";
import {
  isAppleKeyboardPlatform,
  type KeyboardShortcutPlatformInfo,
} from "@/lib/keyboardShortcuts.js";
import { logger } from "@/logger.js";

export interface ShortcutBindingEvent {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  repeat?: boolean;
  isComposing?: boolean;
  
  keyCode?: number;
}

// ============================================================================
// ============================================================================

function isImeEvent(event: ShortcutBindingEvent): boolean {
  return (
    event.isComposing === true ||
    event.key === "Process" ||
    event.key === "Dead" ||
    event.keyCode === 229
  );
}

export function isShortcutEventNoise(event: ShortcutBindingEvent): boolean {
  return event.repeat === true || isImeEvent(event);
}

// ============================================================================
// ============================================================================

const CODE_TO_KEY: Readonly<Record<string, string>> = {
  ...Object.fromEntries(
    Array.from({ length: 26 }, (_, index) => [
      `Key${String.fromCharCode(65 + index)}`,
      String.fromCharCode(97 + index),
    ]),
  ),
  ...Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`Digit${index}`, String(index)])),
  ...Object.fromEntries(
    Array.from({ length: 12 }, (_, index) => [`F${index + 1}`, `F${index + 1}`]),
  ),
  BracketLeft: "[",
  BracketRight: "]",
  Equal: "=",
  Minus: "-",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  Backslash: "\\",
  ArrowUp: "ArrowUp",
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
  Enter: "Enter",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  Delete: "Delete",
  Insert: "Insert",
};

const KEY_TO_CODE: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(CODE_TO_KEY).map(([code, key]) => [key, code]),
);

// ============================================================================
// ============================================================================

export function matchesShortcutBinding(
  event: ShortcutBindingEvent,
  binding: string,
  platformInfo?: KeyboardShortcutPlatformInfo,
): boolean {
  if (isShortcutEventNoise(event)) {
    return false;
  }
  const parsed = parseShortcutBinding(binding);
  if (parsed === null) {
    return false;
  }

  const isApple = isAppleKeyboardPlatform(platformInfo);
  if (!modifiersMatch(event, parsed, isApple)) {
    return false;
  }
  return eventMatchesKey(event, parsed.key);
}

function modifiersMatch(
  event: ShortcutBindingEvent,
  parsed: ParsedShortcutBinding,
  isApple: boolean,
): boolean {
  const { metaKey: meta, ctrlKey: ctrl, altKey: alt, shiftKey: shift } = event;

  const wantPrimaryOrCtrl = parsed.altGr || parsed.cmdOrCtrl || (!isApple && parsed.ctrl);
  const wantCtrl = !parsed.altGr && !parsed.cmdOrCtrl && parsed.ctrl && isApple;
  const wantAlt = parsed.altGr || parsed.alt;

  if (!wantPrimaryOrCtrl && !wantCtrl && (meta || ctrl)) {
    return false;
  }

  if (wantPrimaryOrCtrl) {
    const ok = isApple ? meta && !ctrl : ctrl && !meta;
    if (!ok) {
      return false;
    }
  }
  if (wantCtrl) {
    if (!ctrl || meta) {
      return false;
    }
  }
  if (wantAlt !== alt) {
    return false;
  }
  return parsed.shift === shift;
}

export function isShiftOnlyPrintableBinding(binding: string): boolean {
  const parsed = parseShortcutBinding(binding);
  if (parsed === null) {
    return false;
  }
  return (
    !parsed.cmdOrCtrl &&
    !parsed.ctrl &&
    !parsed.alt &&
    !parsed.altGr &&
    parsed.shift &&
    parsed.key.length === 1
  );
}

export function isEditableShortcutEventTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function eventMatchesKey(event: Pick<ShortcutBindingEvent, "key" | "code">, key: string): boolean {
  if (event.key === key) {
    return true;
  }
  if (event.key.length === 1 && event.key.toLowerCase() === key) {
    return true;
  }
  if (event.code !== undefined) {
    return KEY_TO_CODE[key] === event.code;
  }
  return false;
}

// ============================================================================
// ============================================================================

export type ShortcutRecordResult =
  | { kind: "pending" }
  | { kind: "binding"; binding: string }
  | { kind: "invalid"; reason: "no-modifier" | "unsupported-key" };

function isModifierOnlyKey(key: string): boolean {
  return (
    key === "Shift" ||
    key === "Control" ||
    key === "Meta" ||
    key === "Alt" ||
    key === "AltGraph" ||
    key === "OS"
  );
}

export function recordShortcutBinding(
  event: ShortcutBindingEvent,
  platformInfo?: KeyboardShortcutPlatformInfo,
): ShortcutRecordResult {
  if (event.repeat === true || isModifierOnlyKey(event.key)) {
    return { kind: "pending" };
  }

  if (isImeEvent(event)) {
    const codeKey = event.code !== undefined ? CODE_TO_KEY[event.code] : undefined;
    if (codeKey === undefined) {
      return { kind: "pending" };
    }
    return buildRecordedBinding(event, codeKey, platformInfo);
  }

  const key =
    event.code !== undefined
      ? (CODE_TO_KEY[event.code] ?? normalizeEventKey(event.key))
      : normalizeEventKey(event.key);
  if (key === null) {
    return { kind: "invalid", reason: "unsupported-key" };
  }
  return buildRecordedBinding(event, key, platformInfo);
}

function buildRecordedBinding(
  event: ShortcutBindingEvent,
  key: string,
  platformInfo?: KeyboardShortcutPlatformInfo,
): ShortcutRecordResult {
  const isApple = isAppleKeyboardPlatform(platformInfo);
  const hasModifier = event.metaKey || event.ctrlKey || event.altKey || event.shiftKey;
  const namedKey = key.length > 1;
  if (!hasModifier && !namedKey) {
    return { kind: "invalid", reason: "no-modifier" };
  }

  const parsed: ParsedShortcutBinding = {
    cmdOrCtrl: isApple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey,
    ctrl: isApple ? event.ctrlKey && !event.metaKey : false,
    alt: event.altKey,
    shift: event.shiftKey,
    altGr: false,
    key,
  };

  if ((event.metaKey || event.ctrlKey) && !parsed.cmdOrCtrl && !parsed.ctrl) {
    return { kind: "invalid", reason: "unsupported-key" };
  }

  const binding = serializeShortcutBinding(parsed);
  if (binding === null) {
    return { kind: "invalid", reason: "unsupported-key" };
  }
  return { kind: "binding", binding };
}

function normalizeEventKey(rawKey: string): string | null {
  if (rawKey.length === 1) {
    return /^[a-zA-Z0-9[\]=\-,./;'\\`]$/.test(rawKey) ? rawKey.toLowerCase() : null;
  }
  return rawKey in KEY_TO_CODE ? rawKey : null;
}

// ============================================================================
// ============================================================================

let shortcutRecordingActive = false;

export function setShortcutRecordingActive(active: boolean): void {
  shortcutRecordingActive = active;
}

export function isShortcutRecordingActive(): boolean {
  return shortcutRecordingActive;
}

// ============================================================================
// ============================================================================

export type EffectiveShortcutBindings = Readonly<Record<ShortcutCommandId, readonly string[]>>;

export function resolveEffectiveShortcutBindings(
  overrides?: Record<string, readonly string[]>,
): EffectiveShortcutBindings {
  const effective: Record<ShortcutCommandId, readonly string[]> = {} as Record<
    ShortcutCommandId,
    readonly string[]
  >;
  for (const entry of SHORTCUT_COMMANDS) {
    const override = overrides?.[entry.id];
    if (override === undefined) {
      effective[entry.id] = entry.defaultBindings;
      continue;
    }
    const valid = override.filter((binding) => parseShortcutBinding(binding) !== null);
    if (override.length > 0 && valid.length === 0) {
      logger.warn("[shortcuts] All override bindings are invalid; falling back to defaults", { commandId: entry.id, override });
      effective[entry.id] = entry.defaultBindings;
      continue;
    }
    if (valid.length !== override.length) {
      logger.warn("[shortcuts] 忽略非法覆盖条目", { commandId: entry.id, override });
    }
    effective[entry.id] = valid;
  }
  return effective;
}
