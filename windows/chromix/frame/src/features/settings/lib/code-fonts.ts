/** Monospaced faces for code, as `ui.code-font` names them. The system's own
 *  is always offered; the rest only once this machine has them. */
export const codeFonts = [
  { id: "menlo", family: "Menlo" },
  { id: "consolas", family: "Consolas" },
  { id: "jetbrains-mono", family: "JetBrains Mono" },
  { id: "fira-code", family: "Fira Code" },
  { id: "ibm-plex-mono", family: "IBM Plex Mono" },
  { id: "cascadia-code", family: "Cascadia Code" },
  { id: "source-code-pro", family: "Source Code Pro" },
] as const;

const SAMPLE = "mmmmmmmmmmlli10O@#";

/** Measured once when the page opens: a face is present when text set in it
 *  differs from both generic fallbacks. */
export function installedCodeFonts(): string[] {
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return [];
  const width = (font: string) => {
    context.font = `72px ${font}`;
    return context.measureText(SAMPLE).width;
  };
  const generic = ["monospace", "serif"].map((fallback) => [fallback, width(fallback)] as const);
  return codeFonts
    .filter(({ family }) =>
      generic.some(([fallback, base]) => width(`"${family}", ${fallback}`) !== base),
    )
    .map(({ id }) => id);
}
