
import { parseShortcutBinding } from "@origin-ai/cf-shared";

import {
  isAppleKeyboardPlatform,
  type KeyboardShortcutPlatformInfo,
} from "../lib/keyboardShortcuts.js";

export function formatShortcutBindingLabelParts(
  binding: string,
  platformInfo?: KeyboardShortcutPlatformInfo,
): string[] {
  const parsed = parseShortcutBinding(binding);
  if (parsed === null) {
    return [binding];
  }

  const displayKey =
    parsed.key === "=" ? "+" : parsed.key.length === 1 ? parsed.key.toUpperCase() : parsed.key;
  const isApple = isAppleKeyboardPlatform(platformInfo);

  if (isApple) {
    const parts: string[] = [];
    if (parsed.altGr) {
      parts.push("⌃", "⌥");
    } else {
      if (parsed.ctrl) {
        parts.push("⌃");
      }
      if (parsed.alt) {
        parts.push("⌥");
      }
    }
    if (parsed.shift) {
      parts.push("⇧");
    }
    if (parsed.cmdOrCtrl) {
      parts.push("⌘");
    }
    parts.push(displayKey);
    return parts;
  }

  const parts: string[] = [];
  if (parsed.cmdOrCtrl || parsed.ctrl) {
    parts.push("Ctrl");
  }
  if (parsed.altGr) {
    parts.push("Alt");
  } else if (parsed.alt) {
    parts.push("Alt");
  }
  if (parsed.shift) {
    parts.push("Shift");
  }
  parts.push(displayKey);
  return parts;
}

export function formatShortcutBindingLabel(
  binding: string,
  platformInfo?: KeyboardShortcutPlatformInfo,
): string {
  return formatShortcutBindingLabelParts(binding, platformInfo).join(
    isAppleKeyboardPlatform(platformInfo) ? " " : "+",
  );
}
