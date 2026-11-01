import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import {
  SHORTCUT_COMMANDS,
  getDefaultShortcutBindings,
  type ShortcutCommandId,
} from "@origin-ai/cf-shared";
import { Button } from "@/components/ui/button.js";
import { toast } from "@/components/ui/toast.js";
import { useConfirmDialogStore } from "@/store/confirmDialogStore.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import {
  buildShortcutOverridesAfterAppend,
  buildShortcutOverridesAfterSteal,
  buildShortcutOverridesWithBindingAt,
  checkShortcutBindingConflict,
  isSamePhysicalBinding,
} from "@/shortcuts/conflicts.js";
import { formatShortcutBindingLabel } from "@/shortcuts/label.js";
import {
  resolveEffectiveShortcutBindings,
  setShortcutRecordingActive,
} from "@/shortcuts/bindings.js";
import { ShortcutBindingRow, type RecordingState } from "@/settings/ShortcutBindingRow.js";
import { ShortcutSearchBar } from "@/settings/ShortcutSearchBar.js";
import { useShortcutKeySearch } from "@/settings/useShortcutKeySearch.js";
import { useShortcutRecording } from "@/settings/useShortcutRecording.js";

export function ShortcutSettingsSection({ isDesktop = false }: { isDesktop?: boolean }) {
  const { intl } = useCfIntl();
  const { settings, update } = useSettings();
  const platform = usePlatform();
  const [query, setQuery] = useState("");
  const [recording, setRecording] = useState<RecordingState | null>(null);
  const keySearch = useShortcutKeySearch();
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  const overrides = settings?.shortcutBindings;
  const effective = useMemo(() => resolveEffectiveShortcutBindings(overrides), [overrides]);
  const commandLabel = useCallback(
    (commandId: ShortcutCommandId) =>
      intl.formatMessage({ id: `settings.shortcuts.command.${commandId}` }),
    [intl],
  );

  const visibleCommands = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const keyBinding = keySearch.binding;
    return SHORTCUT_COMMANDS.filter((entry) => {
      if (entry.id === "openOnboarding" || entry.id === "toggleInterfaceMode") return false;
      if (entry.id === "toggleSidePaneFullView" && !isDesktop) return false;
      const matchesText =
        !keyword ||
        entry.id.toLowerCase().includes(keyword) ||
        commandLabel(entry.id).toLowerCase().includes(keyword);
      const matchesKey =
        keyBinding === null ||
        (effective[entry.id] ?? []).some((binding) => isSamePhysicalBinding(binding, keyBinding));
      return matchesText && matchesKey;
    });
  }, [commandLabel, effective, isDesktop, keySearch.binding, query]);

  const persistBindings = useCallback(
    async (next: Record<string, string[]>) => {
      if (savingRef.current) {
        return;
      }
      savingRef.current = true;
      setSaving(true);
      setSaveFailed(false);
      setRecording(null);
      try {
        await update({ shortcutBindings: next });
      } catch (error) {
        logger.error("[shortcuts] Failed to save shortcut bindings", { error: String(error) });
        setSaveFailed(true);
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [update],
  );

  
  const appendBinding = useCallback(
    (commandId: ShortcutCommandId, binding: string) => {
      void persistBindings(buildShortcutOverridesAfterAppend(overrides, commandId, binding));
    },
    [overrides, persistBindings],
  );

  
  const replaceBindingAt = useCallback(
    (commandId: ShortcutCommandId, bindingIndex: number, binding: string) => {
      void persistBindings(
        buildShortcutOverridesWithBindingAt(overrides, commandId, bindingIndex, binding),
      );
    },
    [overrides, persistBindings],
  );

  
  const stealBinding = useCallback(
    (commandId: ShortcutCommandId, binding: string) => {
      const next = buildShortcutOverridesAfterSteal(overrides, commandId, binding, {
        mode: recording?.mode,
        bindingIndex: recording?.bindingIndex,
      });
      void persistBindings(next);
    },
    [overrides, persistBindings, recording],
  );

  
  const clearAllBindings = useCallback(
    (commandId: ShortcutCommandId) => {
      void persistBindings({ ...overrides, [commandId]: [] });
    },
    [overrides, persistBindings],
  );

  
  const clearBinding = useCallback(
    (commandId: ShortcutCommandId) => {
      if (overrides?.[commandId] === undefined) {
        return;
      }
      const defaultBinding = getDefaultShortcutBindings(commandId)[0];
      if (defaultBinding) {
        const conflict = checkShortcutBindingConflict(commandId, defaultBinding, overrides, {
          menuChannelReserved: !isDesktop,
        });
        if (conflict?.kind === "occupied" && conflict.ownerCommandId) {
          toast(
            intl.formatMessage(
              { id: "settings.shortcuts.clearConflict" },
              { command: commandLabel(conflict.ownerCommandId) },
            ),
          );
          return;
        }
      }
      const next = { ...overrides };
      delete next[commandId];
      void persistBindings(next);
    },
    [overrides, persistBindings, isDesktop, intl, commandLabel],
  );

  const requestConfirmation = useConfirmDialogStore((state) => state.requestConfirmation);
  const resetAll = useCallback(async () => {
    if (!overrides || Object.keys(overrides).length === 0) {
      return;
    }
    const confirmed = await requestConfirmation({
      confirmVariant: "destructive",
      title: intl.formatMessage({ id: "settings.shortcuts.resetAllConfirmTitle" }),
      description: intl.formatMessage({ id: "settings.shortcuts.resetAllConfirmDescription" }),
    });
    if (confirmed) {
      void persistBindings({});
    }
  }, [overrides, persistBindings, requestConfirmation, intl]);

  const keyboardExclusive = recording !== null || keySearch.armed;
  useEffect(() => {
    if (!keyboardExclusive) {
      return;
    }
    setShortcutRecordingActive(true);
    platform.setShortcutRecordingActive?.(true);
    return () => {
      setShortcutRecordingActive(false);
      platform.setShortcutRecordingActive?.(false);
    };
  }, [keyboardExclusive, platform]);

  useShortcutRecording({
    recording,
    setRecording,
    effective,
    overrides,
    isDesktop,
    clearBinding,
    appendBinding,
    replaceBindingAt,
  });

  const recordingCommandId = recording?.commandId ?? null;

  return (
    <div className="min-w-0 space-y-6" aria-busy={saving} data-testid="settings-shortcuts-section">
      <ShortcutSearchBar
        query={query}
        onQueryChange={setQuery}
        keySearch={keySearch}
        onArmKeySearch={() => setRecording(null)}
        actions={
          <Button
            variant="outline"
            onClick={resetAll}
            disabled={saving || !settings || !overrides || Object.keys(overrides).length === 0}
            data-testid="settings-shortcut-reset-all"
          >
            <RotateCcw className="size-3.5" />
            {intl.formatMessage({ id: saving ? "common.saving" : "settings.shortcuts.resetAll" })}
          </Button>
        }
      />

      {saveFailed ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-ui-base text-destructive"
          data-testid="settings-shortcut-save-error"
        >
          {intl.formatMessage({ id: "settings.shortcuts.saveFailed" })}
        </div>
      ) : null}
      <div className="min-w-0 rounded-xl border border-card-border">
        <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)_80px_40px] rounded-t-xl bg-surface sm:grid px-4 py-3 text-ui-sm text-foreground-subtle">
          <span>{intl.formatMessage({ id: "settings.shortcuts.columnHeaderCommand" })}</span>
          <span>{intl.formatMessage({ id: "settings.shortcuts.columnHeaderBinding" })}</span>
          <span>{intl.formatMessage({ id: "settings.shortcuts.columnHeaderScope" })}</span>
          <span>{intl.formatMessage({ id: "settings.shortcuts.columnHeaderActions" })}</span>
        </div>
        {visibleCommands.map((entry) => (
          <ShortcutBindingRow
            key={entry.id}
            entry={entry}
            commandLabel={commandLabel(entry.id)}
            bindings={effective[entry.id] ?? []}
            saving={saving || !settings}
            isOverridden={overrides?.[entry.id] !== undefined}
            isRecording={recordingCommandId === entry.id}
            recording={recording}
            menuChannelUnavailable={entry.channel === "menu" && !isDesktop}
            onRecord={(bindingIndex) => {
              keySearch.disarm();
              setRecording({
                commandId: entry.id,
                mode: "replace",
                bindingIndex,
                preview: null,
                error: null,
                conflictBinding: null,
              });
            }}
            onSteal={(binding) => {
              stealBinding(entry.id, binding);
              setRecording(null);
            }}
            onClearAll={() => clearAllBindings(entry.id)}
          />
        ))}
        {visibleCommands.length === 0 ? (
          <div
            className="border-t border-border px-4 py-8 text-center text-ui-sm text-foreground-subtle"
            data-testid="settings-shortcut-search-empty"
          >
            {keySearch.binding !== null
              ? intl.formatMessage(
                  { id: "settings.shortcuts.keySearchEmpty" },
                  { keys: formatShortcutBindingLabel(keySearch.binding) },
                )
              : intl.formatMessage({ id: "settings.shortcuts.searchEmpty" })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
