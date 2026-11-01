import { palette, theme, type Mode, type ThemeSpec } from "$domain/appearance";
import { preferences } from "$domain/preferences";
import { writer } from "./preference-writer";

const EDIT_SETTLE_MS = 380;
/** The Appearance page's theme: the stored one, or the one being edited,
 *  which every surface shows at once and the store receives once it rests. */
export function createThemeEditor() {
  let draft = $state<ThemeSpec | null>(null);
  let draftLevel = $state<number | null>(null);
  let failed = $state(false);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let levelTimer: ReturnType<typeof setTimeout> | null = null;

  const stored = $derived(
    palette.resolveTheme(preferences.value("ui.theme"), preferences.value("ui.theme-custom")),
  );
  const savedCustom = $derived(palette.parseTheme(preferences.value("ui.theme-custom")));
  const current = $derived(draft ?? stored.spec);
  const selected = $derived(draft ? palette.CUSTOM_THEME : stored.id);
  const level = $derived(draftLevel ?? palette.contrastOf(preferences.value("ui.theme-contrast")));

  const write = writer(["ui.theme-custom", "ui.theme", "ui.theme-contrast"], (ok) => {
    failed = !ok;
    if (timer === null) {
      draft = null;
      theme.previewTheme(null);
    }
    if (levelTimer === null) {
      draftLevel = null;
      theme.previewContrast(null);
    }
  });

  function flushLevel() {
    if (levelTimer !== null) clearTimeout(levelTimer);
    levelTimer = null;
    if (draftLevel !== null) write.want({ "ui.theme-contrast": String(draftLevel) });
  }

  function flush() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (draft === null) return;
    write.want({ "ui.theme-custom": palette.serializeTheme(draft), "ui.theme": "custom" });
  }

  function show(next: ThemeSpec) {
    draft = next;
    failed = false;
    theme.previewTheme(next);
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(flush, EDIT_SETTLE_MS);
  }

  /** A preset's own spec or the saved custom one; edits fork from here. */
  function base(): ThemeSpec {
    if (draft) return draft;
    if (stored.custom) return stored.spec;
    return { ...stored.spec, from: stored.id };
  }

  function choose(id: string) {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    draft = null;
    failed = false;
    const spec =
      id === palette.CUSTOM_THEME
        ? savedCustom
        : (() => {
            const entry = palette.preset(id);
            return entry ? palette.forkOf(entry) : null;
          })();
    if (!spec) return;
    theme.previewTheme(spec);
    write.want({ "ui.theme": id });
  }

  return {
    get current() {
      return current;
    },
    get selected() {
      return selected;
    },
    /** Contrast is the window's, not the theme's: it never forks a preset. */
    get contrast() {
      return level;
    },
    /** The saved custom theme, which stays choosable after a preset is picked. */
    get custom() {
      return draft ?? savedCustom;
    },
    get failed() {
      return failed;
    },
    choose,
    edit(mode: Mode, field: "bg" | "fg" | "accent", hex: string) {
      const from = base();
      show({ ...from, [mode]: { ...from[mode], [field]: hex } });
    },
    setContrast(value: number) {
      draftLevel = value;
      failed = false;
      theme.previewContrast(value);
      if (levelTimer !== null) clearTimeout(levelTimer);
      levelTimer = setTimeout(flushLevel, EDIT_SETTLE_MS);
    },
    adopt({ spec, contrast }: palette.SharedTheme) {
      draftLevel = contrast;
      theme.previewContrast(contrast);
      show(spec);
      flush();
      flushLevel();
    },
    reset() {
      const origin = current.from ? palette.preset(current.from) : undefined;
      choose(origin?.id ?? palette.DEFAULT_THEME);
    },
    /** Leaving the page writes what was edited rather than dropping it. */
    dispose() {
      flush();
      flushLevel();
    },
  };
}

export type ThemeEditor = ReturnType<typeof createThemeEditor>;
