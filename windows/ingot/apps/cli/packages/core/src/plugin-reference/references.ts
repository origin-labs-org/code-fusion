
const PLUGIN_REFERENCE_SCHEME = "plugin://";
const MARKDOWN_LINK_PATTERN =
  /\[(?:\\.|[^\\\]])*\]\((?:<((?:\\.|[^>])*?)>|((?:\\.|[^)\s])*))\)/g;
const PLUGIN_ID_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const MAX_PLUGIN_REFERENCES_PER_TURN = 8;
const MAX_PLUGIN_STABLE_ID_LENGTH = 256;

export function isValidPluginStableId(candidate: string): boolean {
  if (candidate.length === 0 || candidate.length > MAX_PLUGIN_STABLE_ID_LENGTH) {
    return false;
  }
  const separatorIndex = candidate.indexOf("@");
  if (separatorIndex <= 0 || separatorIndex !== candidate.lastIndexOf("@")) {
    return false;
  }
  const name = candidate.slice(0, separatorIndex);
  const marketplace = candidate.slice(separatorIndex + 1);
  return PLUGIN_ID_SEGMENT_PATTERN.test(name) && PLUGIN_ID_SEGMENT_PATTERN.test(marketplace);
}

function parsePluginDestination(destination: string): string | null {
  if (!destination.startsWith(PLUGIN_REFERENCE_SCHEME)) {
    return null;
  }
  const stableId = destination.slice(PLUGIN_REFERENCE_SCHEME.length);
  if (!isValidPluginStableId(stableId)) {
    return null;
  }
  return stableId;
}

function isPluginSchemeDestination(destination: string): boolean {
  return /^plugin:\/\//i.test(destination);
}

export interface ExtractPluginReferencesResult {
  
  references: string[];
  
  truncatedCount: number;
  
  invalidCount: number;
}

export function extractPluginReferences(input: string): ExtractPluginReferencesResult {
  const references: string[] = [];
  const seen = new Set<string>();
  let truncatedCount = 0;
  let invalidCount = 0;

  MARKDOWN_LINK_PATTERN.lastIndex = 0;
  for (const match of input.matchAll(MARKDOWN_LINK_PATTERN)) {
    const destination = match[1] ?? match[2] ?? "";
    if (!isPluginSchemeDestination(destination)) {
      continue;
    }
    const stableId = parsePluginDestination(destination);
    if (stableId === null) {
      invalidCount++;
      continue;
    }
    if (seen.has(stableId)) {
      continue;
    }
    if (references.length >= MAX_PLUGIN_REFERENCES_PER_TURN) {
      truncatedCount++;
      continue;
    }
    seen.add(stableId);
    references.push(stableId);
  }

  return { references, truncatedCount, invalidCount };
}
