import { Keyboard, Pencil, Trash2 } from "lucide-react";
import type { ShortcutCommandEntry, ShortcutCommandId } from "@origin-ai/cf-shared";
import { Button } from "@/components/ui/button.js";
import { Kbd, KbdGroup } from "@/components/ui/kbd.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { formatShortcutBindingLabelParts } from "@/shortcuts/label.js";

export interface RecordingState {
  commandId: ShortcutCommandId;
  
  mode: "replace" | "add";
  
  bindingIndex: number | null;
  
  preview: string | null;
  
  error: string | null;
  
  conflictBinding: string | null;
}

interface ShortcutBindingRowProps {
  entry: ShortcutCommandEntry;
  
  commandLabel: string;
  bindings: readonly string[];
  
  isOverridden: boolean;
  saving?: boolean;
  isRecording: boolean;
  recording: RecordingState | null;
  
  menuChannelUnavailable: boolean;
  
  onRecord: (bindingIndex: number | null) => void;
  onSteal: (binding: string) => void;
  
  onClearAll: () => void;
}

export function ShortcutBindingRow({
  entry,
  commandLabel,
  bindings,
  isOverridden,
  saving = false,
  isRecording,
  recording,
  menuChannelUnavailable,
  onRecord,
  onSteal,
  onClearAll,
}: ShortcutBindingRowProps) {
  const { intl } = useCfIntl();
  const conflictBinding = isRecording ? recording?.conflictBinding : null;

  function renderRecorder() {
    return (
      <span className="flex min-w-0 max-w-full flex-col gap-1 break-words">
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <Keyboard className="size-4 text-foreground-subtle" />
          <kbd
            ref={(el) => {
              el?.focus();
            }}
            tabIndex={-1}
            className="max-w-full rounded-md bg-surface px-2 py-1 font-mono text-ui-sm outline-none"
          >
            {recording?.preview ?? intl.formatMessage({ id: "settings.shortcuts.recording" })}
          </kbd>
        </span>
        {recording?.error ? (
          <span
            className="text-ui-sm text-destructive"
            data-testid={`settings-shortcut-error-${entry.id}`}
          >
            {recording.error}
          </span>
        ) : (
          <span className="text-ui-xs text-foreground-subtlest">
            {intl.formatMessage({ id: "settings.shortcuts.recordingHint" })}
          </span>
        )}
        {conflictBinding ? (
          <Button
            disabled={saving}
            variant="outline"
            size="xs"
            className="w-fit"
            data-testid={`settings-shortcut-steal-${entry.id}`}
            onClick={() => onSteal(conflictBinding)}
          >
            {intl.formatMessage({ id: "settings.shortcuts.stealConfirm" })}
          </Button>
        ) : null}
      </span>
    );
  }

  
  function renderBinding(binding: string, index: number) {
    return (
      <span key={binding} className="flex min-w-0 max-w-full items-center gap-1.5">
        <button
          type="button"
          disabled={saving || menuChannelUnavailable}
          className="min-w-0 rounded-lg px-0 py-1 text-left focus-visible:outline-2 focus-visible:outline-offset-4 disabled:cursor-not-allowed disabled:opacity-60"
          aria-label={intl.formatMessage(
            { id: "settings.shortcuts.rebindAria" },
            { command: commandLabel },
          )}
          data-testid={`settings-shortcut-bind-${entry.id}-${index}`}
          onClick={() => onRecord(index)}
        >
          <KbdGroup className="flex-wrap">
            {formatShortcutBindingLabelParts(binding).map((part, partIndex) => (
              <Kbd key={`${part}-${partIndex}`} className={isOverridden ? "text-brand" : undefined}>
                {part}
              </Kbd>
            ))}
          </KbdGroup>
        </button>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={saving || menuChannelUnavailable}
          aria-label={intl.formatMessage(
            { id: "settings.shortcuts.rebindAria" },
            { command: commandLabel },
          )}
          data-testid={`settings-shortcut-edit-${entry.id}-${index}`}
          onClick={() => onRecord(index)}
        >
          <Pencil className="size-3.5" />
        </Button>
      </span>
    );
  }

  return (
    <div
      className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-t border-border px-4 py-3 text-ui-base first:border-t-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_80px_40px] sm:gap-x-0"
      data-testid={`settings-shortcut-row-${entry.id}`}
    >
      <span className="order-1 flex min-w-0 items-center">
        <span className="break-words">{commandLabel}</span>
      </span>
      <span className="order-3 flex min-w-0 flex-col items-start gap-1.5 sm:order-2">
        {bindings.map((binding, index) =>
          isRecording && recording?.mode === "replace" && recording.bindingIndex === index
            ? renderRecorder()
            : renderBinding(binding, index),
        )}
        {}
        {isRecording && recording?.mode === "replace" && recording?.bindingIndex === null
          ? renderRecorder()
          : null}
        {bindings.length === 0 && !isRecording ? (
          <button
            type="button"
            disabled={saving || menuChannelUnavailable}
            className="min-w-0 rounded-lg px-0 py-1 text-left focus-visible:outline-2 focus-visible:outline-offset-4 disabled:cursor-not-allowed disabled:opacity-60"
            aria-label={intl.formatMessage(
              { id: "settings.shortcuts.rebindAria" },
              { command: commandLabel },
            )}
            data-testid={`settings-shortcut-bind-${entry.id}-unassigned`}
            onClick={() => onRecord(null)}
          >
            <Kbd>{intl.formatMessage({ id: "settings.shortcuts.notSet" })}</Kbd>
          </button>
        ) : null}
      </span>
      {}
      <span
        className="order-2 text-ui-sm text-foreground-subtle sm:order-3"
        data-testid={`settings-shortcut-scope-${entry.id}`}
      >
        {entry.scope === "composer"
          ? intl.formatMessage({ id: "settings.shortcuts.scopeComposer" })
          : intl.formatMessage({ id: "settings.shortcuts.scopeGlobal" })}
      </span>
      <Button
        className="order-4 justify-self-end sm:justify-self-start"
        variant="ghost"
        size="icon-sm"
        aria-label={intl.formatMessage(
          { id: "settings.shortcuts.clearAria" },
          { command: commandLabel },
        )}
        disabled={saving || menuChannelUnavailable || bindings.length === 0}
        onClick={onClearAll}
        data-testid={`settings-shortcut-clear-${entry.id}`}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  );
}
