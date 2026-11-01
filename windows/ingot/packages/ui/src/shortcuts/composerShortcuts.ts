
import type { ShortcutBindingEvent } from "./bindings.js";
import { matchesShortcutBinding } from "./bindings.js";

export interface ComposerEffectiveBindings {
  readonly composerSend: readonly string[];
  readonly composerInsertNewline: readonly string[];
}

export type ComposerKeyAction = "send" | "newline";

export function resolveComposerKeyAction(
  event: Pick<ShortcutBindingEvent, "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
  effective: ComposerEffectiveBindings,
  platformInfo?: { platform?: string; userAgent?: string },
): ComposerKeyAction | null {
  for (const binding of effective.composerInsertNewline ?? []) {
    if (matchesShortcutBinding(event, binding, platformInfo)) {
      return "newline";
    }
  }
  for (const binding of effective.composerSend ?? []) {
    if (matchesShortcutBinding(event, binding, platformInfo)) {
      return "send";
    }
  }
  return null;
}

export function shouldBareEnterFallThroughToNewline(effective: ComposerEffectiveBindings): boolean {
  return !effective.composerSend.includes("Enter");
}
