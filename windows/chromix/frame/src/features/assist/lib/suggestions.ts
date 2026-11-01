import type { IconSvgElement } from "@hugeicons/svelte";
import * as m from "$shared/i18n/messages";
import type { PageAssistSuggestionV1 } from "$shared/ipc/bindings";
import {
  BalanceScaleIcon,
  BulbIcon,
  ChartLineData01Icon,
  LeftToRightListBulletIcon,
  LeftToRightListNumberIcon,
  LinkSquare02Icon,
  PaintBrush02Icon,
  Moon02Icon,
  SearchVisualIcon,
  TextAlignLeftIcon,
  TextFontIcon,
} from "./icons";

const LABELS: Record<PageAssistSuggestionV1, () => string> = {
  summarize: m.assist_suggest_summarize,
  key_points: m.assist_suggest_key_points,
  key_numbers: m.assist_suggest_key_numbers,
  catch: m.assist_suggest_catch,
  explain: m.assist_suggest_explain,
  steps: m.assist_suggest_steps,
  compare: m.assist_suggest_compare,
  picks: m.assist_suggest_picks,
  redesign: m.assist_suggest_redesign,
  darker: m.assist_suggest_darker,
  readable: m.assist_suggest_readable,
};

const GLYPHS: Record<PageAssistSuggestionV1, IconSvgElement> = {
  summarize: TextAlignLeftIcon,
  key_points: LeftToRightListBulletIcon,
  key_numbers: ChartLineData01Icon,
  catch: SearchVisualIcon,
  explain: BulbIcon,
  steps: LeftToRightListNumberIcon,
  compare: BalanceScaleIcon,
  picks: LinkSquare02Icon,
  redesign: PaintBrush02Icon,
  darker: Moon02Icon,
  readable: TextFontIcon,
};

export const suggestionLabel = (suggestion: PageAssistSuggestionV1) => LABELS[suggestion]();
export const suggestionGlyph = (suggestion: PageAssistSuggestionV1) => GLYPHS[suggestion];

const isRestyle = (suggestion: PageAssistSuggestionV1) =>
  suggestion === "redesign" || suggestion === "darker" || suggestion === "readable";

/** At most four starts, in Rust's order: what the page says first, then one way to restyle it. */
export function startsFor(
  suggestions: readonly PageAssistSuggestionV1[],
): PageAssistSuggestionV1[] {
  const restyle = suggestions.find(isRestyle);
  const understand = suggestions.filter((s) => !isRestyle(s)).slice(0, restyle ? 3 : 4);
  return restyle ? [...understand, restyle] : understand;
}

const SEPARATORS = /\s+[|·•–—-]\s+|\s*::\s*/u;
const LONGEST = 26;

/** What a page calls its site, short enough to say in a sentence: "Hacker News", "GitHub". */
export function siteName(title: string, host: string): string {
  const parts = title
    .split(SEPARATORS)
    .map((part) => part.trim())
    .filter(Boolean);
  const named = [parts.at(-1), parts[0]].find((part) => !!part && part.length <= LONGEST);
  return named ?? host.replace(/^www\./u, "");
}
