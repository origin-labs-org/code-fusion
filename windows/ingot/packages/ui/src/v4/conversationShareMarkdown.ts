import {
  findMarkdownCodeRanges,
  overlapsAssistantTextRanges,
  type AssistantTextRange,
} from "@/lib/assistantDirectiveParser.js";
import { extractCfFileCitationDirectives } from "@/lib/cfFileCitation.js";

function resolveCitationFileName(path: string): string {
  const normalizedPath = path.trim().replaceAll("\\", "/");
  return normalizedPath.split("/").at(-1) ?? normalizedPath;
}

const markdownImagePattern = /!(\[[^\]]*\]\((?:<[^>\n]*>|[^)\s]*)(?:[^)\n]*)\))/gu;

function isRemoteImageDestination(destination: string): boolean {
  const trimmed = destination.trim().replace(/^<|>$/gu, "");
  return /^(?:https?:)?\/\//iu.test(trimmed);
}

function readImageDestination(imageSyntax: string): string {
  const open = imageSyntax.indexOf("(");
  const inner = imageSyntax.slice(open + 1, -1);
  if (inner.startsWith("<")) return inner.slice(0, inner.indexOf(">") + 1);
  const whitespace = inner.search(/\s/u);
  return whitespace < 0 ? inner : inner.slice(0, whitespace);
}

function degradeRemoteImages(
  markdown: string,
  protectedRanges: readonly AssistantTextRange[],
): string {
  const matches = [...markdown.matchAll(markdownImagePattern)].filter(
    (match) =>
      !overlapsAssistantTextRanges(match.index, match.index + match[0].length, protectedRanges) &&
      isRemoteImageDestination(readImageDestination(match[1]!)),
  );
  let result = markdown;
  for (const match of matches.reverse()) {
    result = `${result.slice(0, match.index)}${match[1]!}${result.slice(match.index + match[0].length)}`;
  }
  return result;
}

export function normalizeConversationShareMarkdown(
  markdown: string,
  artifactNames: ReadonlyMap<string, string> = new Map(),
): string {
  const protectedRanges = findMarkdownCodeRanges(markdown);
  const directives = extractCfFileCitationDirectives(markdown).filter(
    (directive) => !overlapsAssistantTextRanges(directive.start, directive.end, protectedRanges),
  );

  let result = markdown;
  for (const directive of [...directives].reverse()) {
    const fileName = directive.path ? resolveCitationFileName(directive.path) : "";
    const candidates = [...artifactNames.values()].filter(
      (displayName) => displayName.trim().toLowerCase() === fileName.toLowerCase(),
    );
    const replacement = candidates.length === 1 ? candidates[0]!.trim() : "";
    result = `${result.slice(0, directive.start)}${replacement}${result.slice(directive.end)}`;
  }
  return degradeRemoteImages(result, findMarkdownCodeRanges(result));
}
