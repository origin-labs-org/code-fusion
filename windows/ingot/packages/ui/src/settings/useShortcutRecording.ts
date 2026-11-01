import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { ShortcutCommandId } from "@origin-ai/cf-shared";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { checkShortcutBindingConflict, isSamePhysicalBinding } from "@/shortcuts/conflicts.js";
import { formatShortcutBindingLabel } from "@/shortcuts/label.js";
import { recordShortcutBinding, type EffectiveShortcutBindings } from "@/shortcuts/bindings.js";
import type { RecordingState } from "./ShortcutBindingRow.js";

interface UseShortcutRecordingOptions {
  recording: RecordingState | null;
  setRecording: Dispatch<SetStateAction<RecordingState | null>>;
  
  effective: EffectiveShortcutBindings;
  overrides: Record<string, readonly string[]> | undefined;
  isDesktop: boolean;
  
  clearBinding: (commandId: ShortcutCommandId) => void;
  appendBinding: (commandId: ShortcutCommandId, binding: string) => void;
  replaceBindingAt: (commandId: ShortcutCommandId, bindingIndex: number, binding: string) => void;
}

export function useShortcutRecording({
  recording,
  setRecording,
  effective,
  overrides,
  isDesktop,
  clearBinding,
  appendBinding,
  replaceBindingAt,
}: UseShortcutRecordingOptions): void {
  const { intl } = useCfIntl();

  useEffect(() => {
    if (!recording) {
      return;
    }
    function handleRecordingKeydown(event: KeyboardEvent) {
      event.preventDefault();
      event.stopPropagation();

      setRecording((current) => {
        if (!current) {
          return current;
        }
        if (event.key === "Escape") {
          return null;
        }
        if (event.key === "Backspace") {
          clearBinding(current.commandId);
          return null;
        }

        const result = recordShortcutBinding(event);
        if (result.kind === "pending") {
          if (
            current.preview === null &&
            current.error === null &&
            current.conflictBinding === null
          ) {
            return current;
          }
          return { ...current, preview: null, error: null, conflictBinding: null };
        }
        if (result.kind === "invalid") {
          return {
            ...current,
            preview: null,
            conflictBinding: null,
            error: intl.formatMessage({
              id:
                result.reason === "no-modifier"
                  ? "settings.shortcuts.invalidNoModifier"
                  : "settings.shortcuts.invalidKey",
            }),
          };
        }

        const sameCommandBindings = effective[current.commandId] ?? [];
        const duplicate = sameCommandBindings.some((binding, index) =>
          current.mode === "replace" && index === current.bindingIndex
            ? false
            : isSamePhysicalBinding(binding, result.binding),
        );
        if (duplicate) {
          return {
            ...current,
            preview: formatShortcutBindingLabel(result.binding),
            conflictBinding: null,
            error: intl.formatMessage({ id: "settings.shortcuts.duplicateBinding" }),
          };
        }

        const conflict = checkShortcutBindingConflict(
          current.commandId,
          result.binding,
          overrides,
          {
            menuChannelReserved: !isDesktop,
          },
        );
        if (conflict) {
          return {
            ...current,
            preview: formatShortcutBindingLabel(result.binding),
            conflictBinding: conflict.kind === "occupied" ? result.binding : null,
            error:
              conflict.kind === "reserved"
                ? intl.formatMessage({ id: "settings.shortcuts.conflictReserved" })
                : intl.formatMessage(
                    { id: "settings.shortcuts.conflictOccupied" },
                    {
                      command:
                        conflict.ownerCommandId !== undefined
                          ? intl.formatMessage({
                              id: `settings.shortcuts.command.${conflict.ownerCommandId}`,
                            })
                          : "",
                    },
                  ),
          };
        }

        if (current.mode === "add" || current.bindingIndex === null) {
          appendBinding(current.commandId, result.binding);
        } else {
          replaceBindingAt(current.commandId, current.bindingIndex, result.binding);
        }
        return null;
      });
    }

    window.addEventListener("keydown", handleRecordingKeydown, true);
    return () => {
      window.removeEventListener("keydown", handleRecordingKeydown, true);
    };
  }, [
    appendBinding,
    clearBinding,
    effective,
    intl,
    isDesktop,
    overrides,
    recording,
    replaceBindingAt,
    setRecording,
  ]);
}
