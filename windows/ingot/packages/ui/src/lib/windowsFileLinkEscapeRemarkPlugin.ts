import type { Plugin } from "unified";

interface MarkdownPoint {
  offset?: number;
}

interface MarkdownNode {
  children?: MarkdownNode[];
  position?: { end?: MarkdownPoint; start?: MarkdownPoint };
  title?: string | null;
  type: string;
  url?: string;
}

const windowsDestinationPattern = /^(?:[a-zA-Z]:[\\/]|\\)/u;

const punctuationEscapePattern = /\\([!-/:-@[-`{-~])/gu;

function unescapeCommonMarkPunctuation(raw: string): string {
  return raw.replace(punctuationEscapePattern, "$1");
}

function extractRawDestination(node: MarkdownNode, slice: string): string | null {
  if (node.type === "definition") {
    const marker = slice.indexOf("]:");
    return marker < 0 ? null : slice.slice(marker + 2).trim();
  }

  if (!slice.endsWith(")")) return null;
  const marker = slice.lastIndexOf("](");
  return marker < 0 ? null : slice.slice(marker + 2, -1).trim();
}

function recoverRawDestination(node: MarkdownNode, source: string): string | null {
  const url = node.url;
  if (typeof url !== "string" || !windowsDestinationPattern.test(url)) return null;
  if (node.title !== null && node.title !== undefined) return null;

  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (typeof start !== "number" || typeof end !== "number" || end <= start) return null;

  const raw = extractRawDestination(node, source.slice(start, end));
  if (raw === null || !raw || raw.startsWith("<") || raw === url) return null;
  if (unescapeCommonMarkPunctuation(raw) !== url) return null;

  return raw;
}

export const windowsFileLinkEscapeRemarkPlugin: Plugin =
  function windowsFileLinkEscapeRemarkPlugin() {
    return (tree: unknown, file: unknown) => {
      const source = String(file ?? "");
      if (!source) return;

      const visit = (node: MarkdownNode): void => {
        if (node.type === "link" || node.type === "image" || node.type === "definition") {
          const raw = recoverRawDestination(node, source);
          if (raw !== null) node.url = raw;
        }

        node.children?.forEach(visit);
      };

      visit(tree as MarkdownNode);
    };
  };
