const SHARE_CONTEXT_BLOCK_PATTERN =
  /(?:\n\n)?# cf-share-context:\n```cf-share-context\n([\s\S]*?)\n```\s*$/u;

export interface ConversationShareContextReference {
  contextId: string;
  shareUrl: string;
}

export function resolveAttachableShareContext(
  sharedContextImport:
    | { contextId: string; title: string; shareUrl: string; status: string }
    | { title: string }
    | null
    | undefined,
): { contextId: string; title: string; shareUrl: string; status: string } | null {
  if (!sharedContextImport || !("contextId" in sharedContextImport)) return null;
  return sharedContextImport.status === "discarded" ? null : sharedContextImport;
}

function isReference(value: unknown): value is ConversationShareContextReference {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).some((key) => key !== "contextId" && key !== "shareUrl")) return false;
  if (typeof candidate.contextId !== "string" || typeof candidate.shareUrl !== "string")
    return false;
  try {
    const url = new URL(candidate.shareUrl);
    return /^\/cn\/share\/[^/]+$/u.test(url.pathname) && !url.search && !url.hash;
  } catch {
    return false;
  }
}

export function parseConversationShareContext(text: string): {
  visibleContent: string;
  reference: ConversationShareContextReference | null;
} {
  const match = text.match(SHARE_CONTEXT_BLOCK_PATTERN);
  if (!match) return { visibleContent: text, reference: null };
  try {
    const parsed: unknown = JSON.parse(match[1] ?? "");
    return isReference(parsed)
      ? { visibleContent: text.slice(0, match.index).trimEnd(), reference: parsed }
      : { visibleContent: text, reference: null };
  } catch {
    return { visibleContent: text, reference: null };
  }
}
