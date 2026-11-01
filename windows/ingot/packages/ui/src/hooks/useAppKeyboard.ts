import { useEffect, useRef } from "react";
import { SHORTCUT_COMMANDS, type ShortcutCommandId } from "@origin-ai/cf-shared";
import {
  isEditableShortcutEventTarget,
  isShiftOnlyPrintableBinding,
  isShortcutRecordingActive,
  matchesShortcutBinding,
} from "@/shortcuts/bindings.js";
import { useEffectiveShortcutBindings } from "@/shortcuts/useShortcutBindings.js";

export type AppKeyboardHandlers = Partial<Record<ShortcutCommandId, (() => void) | null>>;

export function useAppKeyboard(handlers: AppKeyboardHandlers) {
  const effective = useEffectiveShortcutBindings();
  const stateRef = useRef({ handlers, effective });
  stateRef.current = { handlers, effective };

  useEffect(() => {
    function handleWindowKeydown(event: KeyboardEvent) {
      if (event.repeat || event.isComposing) {
        return;
      }
      if (isShortcutRecordingActive()) {
        return;
      }

      const { handlers: currentHandlers, effective: currentEffective } = stateRef.current;
      const editableTarget = isEditableShortcutEventTarget(event.target);
      for (const entry of SHORTCUT_COMMANDS) {
        if (entry.channel !== "window") {
          continue;
        }
        if (entry.scope === "composer") {
          continue;
        }
        const handler = currentHandlers[entry.id];
        if (!handler) {
          continue;
        }
        const bindings = currentEffective[entry.id];
        if (!bindings || bindings.length === 0) {
          continue;
        }
        for (const binding of bindings) {
          if (editableTarget && isShiftOnlyPrintableBinding(binding)) {
            continue;
          }
          if (matchesShortcutBinding(event, binding)) {
            event.preventDefault();
            handler();
            return;
          }
        }
      }
    }

    window.addEventListener("keydown", handleWindowKeydown, true);
    return () => {
      window.removeEventListener("keydown", handleWindowKeydown, true);
    };
  }, []);
}
