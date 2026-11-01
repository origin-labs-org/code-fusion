import type { FileDiffOptions } from "@pierre/diffs";
import type { BundledTheme } from "shiki";

import { DIFFS_PREFERRED_HIGHLIGHTER } from "@/lib/diffsHighlighterEngine.js";
import type { ResolvedTheme } from "@/useTheme.js";

interface PatchDiffSettings {
  lightTheme: BundledTheme;
  darkTheme: BundledTheme;
  showLineNumbers: boolean;
  wrapLongLines: boolean;
}

type PatchDiffSeparatorStyle = "line-info" | "simple";

const PATCH_DIFF_UNSAFE_CSS = `

:host {
  --diffs-light-bg: var(--color-background, #fff);
  --diffs-dark-bg: var(--color-background, #000);
}

[data-code],
[data-separator-content],
pre {
  padding: 0 !important;
  background: transparent !important;
}

[data-code] span,
[data-separator-content] span {
  background: transparent !important;
}

[data-code] {
  background-color: transparent !important;
}

[data-separator-wrapper] {
  padding-left: 64px !important;
}

[data-separator-wrapper] {
  background: var(--color-surface) !important;
}

[data-separator-content] {
  background-color: transparent !important;
}
[data-column-number] {
  border-right-color: rgba(0, 0, 0, 0.1) !important;
}
`;

export function createPatchDiffOptions(
  codePreviewSettings: PatchDiffSettings,
  resolvedTheme: ResolvedTheme,
  options?: {
    separatorStyle?: PatchDiffSeparatorStyle;
  },
): FileDiffOptions<undefined> {
  return {
    diffStyle: "unified",
    diffIndicators: "classic",
    disableFileHeader: true,
    disableLineNumbers: !codePreviewSettings.showLineNumbers,
    hunkSeparators: options?.separatorStyle ?? "line-info",
    overflow: codePreviewSettings.wrapLongLines ? "wrap" : "scroll",
    theme: {
      light: codePreviewSettings.lightTheme,
      dark: codePreviewSettings.darkTheme,
    },
    themeType: resolvedTheme,
    preferredHighlighter: DIFFS_PREFERRED_HIGHLIGHTER,
    unsafeCSS: PATCH_DIFF_UNSAFE_CSS,
  };
}
