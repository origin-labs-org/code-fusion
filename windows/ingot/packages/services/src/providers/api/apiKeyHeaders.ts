const STRUCTURED_API_KEY_PATTERN = /[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/;
const HEADER_VISIBLE_ASCII_PREFIX_PATTERN = /^[\x21-\x7e]+/;

export function normalizeApiKeyForHeader(value: string): string {
  const trimmed = value
    .trim()
    .replace(/^Bearer\s+/i, "")
    .trim();
  const matchedStructuredKey = trimmed.match(STRUCTURED_API_KEY_PATTERN)?.[0];
  if (matchedStructuredKey) {
    return matchedStructuredKey;
  }

  const asciiPrefix = trimmed.match(HEADER_VISIBLE_ASCII_PREFIX_PATTERN)?.[0];
  if (!asciiPrefix) {
    return "";
  }

  return asciiPrefix.trim();
}
