import path from "node:path";

const INLINE_LINK_DESTINATION = /\]\(\s*(<[^>\r\n]+>|[^)\s\r\n]+)(?:\s+(?:"[^"\r\n]*"|'[^'\r\n]*'|\([^)]*\)))?\s*\)/gu;
const REFERENCE_DEFINITION_DESTINATION = /^\s{0,3}\[[^\]\r\n]+\]:\s*(<[^>\r\n]+>|[^\s\r\n]+)(?:\s+(?:"[^"\r\n]*"|'[^'\r\n]*'|\([^)]*\)))?\s*$/u;
const URI_SCHEME = /^[a-z][a-z0-9+.-]*:/iu;

function maskHtmlComments(markdown) {
  return String(markdown ?? "").replace(/<!--[\s\S]*?(?:-->|$)/gu, (comment) =>
    comment.replace(/[^\r\n]/gu, " "));
}

function maskInlineCode(line) {
  return line.replace(/(`+)(.*?)\1/gu, (span) => " ".repeat(span.length));
}

function fenceMarker(line) {
  const match = /^\s{0,3}(`{3,}|~{3,})/u.exec(line);
  return match ? { character: match[1][0], length: match[1].length } : null;
}

function decodeUriComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function relativeMarkdownDestination(rawTarget) {
  let target = String(rawTarget ?? "").trim();
  if (target.startsWith("<") && target.endsWith(">")) {
    target = target.slice(1, -1).trim();
  }
  if (!target
    || target.startsWith("#")
    || target.startsWith("/")
    || URI_SCHEME.test(target)) {
    return null;
  }

  const queryIndex = target.indexOf("?");
  const fragmentIndex = target.indexOf("#");
  const pathEnd = [queryIndex, fragmentIndex]
    .filter((index) => index >= 0)
    .reduce((lowest, index) => Math.min(lowest, index), target.length);
  const decodedPath = decodeUriComponent(target.slice(0, pathEnd)).replaceAll("\\", "/");
  if (!decodedPath.toLowerCase().endsWith(".md")) return null;
  return {
    target: decodedPath,
    fragment: fragmentIndex >= 0 ? decodeUriComponent(target.slice(fragmentIndex + 1)) : null,
  };
}

function githubHeadingSlug(value) {
  return String(value ?? "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/<[^>]+>/gu, "")
    .replace(/[`*_~]/gu, "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/gu, "-");
}

export function markdownDocumentAnchors(markdown) {
  const anchors = new Set();
  const slugCounts = new Map();
  const lines = maskHtmlComments(markdown).split(/\r?\n/u);
  let fence = null;

  for (const line of lines) {
    const marker = fenceMarker(line);
    if (marker) {
      if (!fence) {
        fence = marker;
      } else if (marker.character === fence.character && marker.length >= fence.length) {
        fence = null;
      }
      continue;
    }
    if (fence) continue;

    for (const match of line.matchAll(/<(?:a|span)\b[^>]*(?:id|name)=["']([^"']+)["'][^>]*>/giu)) {
      anchors.add(match[1]);
    }
    const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*$/u.exec(line);
    if (!heading) continue;
    const headingText = heading[1].replace(/\s+#+\s*$/u, "");
    const baseSlug = githubHeadingSlug(headingText);
    if (!baseSlug) continue;
    const duplicateCount = slugCounts.get(baseSlug) ?? 0;
    slugCounts.set(baseSlug, duplicateCount + 1);
    anchors.add(duplicateCount === 0 ? baseSlug : `${baseSlug}-${duplicateCount}`);
  }

  return anchors;
}

export function relativeMarkdownDocumentLinks(markdown) {
  const links = [];
  const lines = maskHtmlComments(markdown).split(/\r?\n/u);
  let fence = null;

  for (const [index, originalLine] of lines.entries()) {
    const marker = fenceMarker(originalLine);
    if (marker) {
      if (!fence) {
        fence = marker;
      } else if (marker.character === fence.character && marker.length >= fence.length) {
        fence = null;
      }
      continue;
    }
    if (fence) continue;

    const line = maskInlineCode(originalLine);
    INLINE_LINK_DESTINATION.lastIndex = 0;
    for (const match of line.matchAll(INLINE_LINK_DESTINATION)) {
      const destination = relativeMarkdownDestination(match[1]);
      if (destination) links.push({ ...destination, line: index + 1 });
    }
    const reference = REFERENCE_DEFINITION_DESTINATION.exec(line);
    const destination = relativeMarkdownDestination(reference?.[1]);
    if (destination) links.push({ ...destination, line: index + 1 });
  }

  return links;
}

export function archiveMarkdownLinkErrors(archive, { prefix = "", surface = "archive" } = {}) {
  if (!(archive instanceof Map)) throw new TypeError("archive must be a Map of entry names to contents");
  const normalizedPrefix = prefix && !prefix.endsWith("/") ? `${prefix}/` : prefix;
  const errors = [];
  const anchorCache = new Map();

  for (const [entryName, content] of archive.entries()) {
    if (!entryName.startsWith(normalizedPrefix) || !entryName.toLowerCase().endsWith(".md")) continue;
    const sourcePath = entryName.slice(normalizedPrefix.length);
    for (const link of relativeMarkdownDocumentLinks(content.toString("utf8"))) {
      const targetPath = path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), link.target));
      const escapesRoot = targetPath === ".."
        || targetPath.startsWith("../")
        || path.posix.isAbsolute(targetPath);
      const targetEntry = `${normalizedPrefix}${targetPath}`;
      if (escapesRoot) {
        errors.push(`${surface} ${sourcePath}:${link.line} relative Markdown link escapes the archive root: ${link.target}`);
      } else if (!archive.has(targetEntry)) {
        errors.push(`${surface} ${sourcePath}:${link.line} links to missing relative Markdown target ${link.target} (${targetPath})`);
      } else if (link.fragment) {
        const anchors = anchorCache.get(targetEntry)
          ?? markdownDocumentAnchors(archive.get(targetEntry).toString("utf8"));
        anchorCache.set(targetEntry, anchors);
        if (!anchors.has(link.fragment)) {
          errors.push(`${surface} ${sourcePath}:${link.line} links to missing Markdown anchor ${link.target}#${link.fragment}`);
        }
      }
    }
  }

  return errors;
}
