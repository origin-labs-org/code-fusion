

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export const HOLE_ID_HEX_LENGTH = 8;

export const HOLE_SITE_ID_PATTERN = /^hole#[0-9a-f]{8}$/u;

export function holeSiteId(name: string): string {
  let hash = FNV_OFFSET;
  for (const char of name.trim()) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return `hole#${hash.toString(16).padStart(HOLE_ID_HEX_LENGTH, "0")}`;
}

export function isHoleSiteId(id: string): boolean {
  return HOLE_SITE_ID_PATTERN.test(id);
}

export function holePrefixOf(siteId: string): string | undefined {
  const cut = siteId.indexOf("/");
  return cut < 0 ? undefined : siteId.slice(0, cut);
}
