import ts from "typescript";
import type { JsonSchema, JsonValue } from "./types.js";

const NUMERIC_TAGS: Record<string, keyof JsonSchema> = {
  exclusiveMaximum: "exclusiveMaximum",
  exclusiveMinimum: "exclusiveMinimum",
  maximum: "maximum",
  maxItems: "maxItems",
  maxLength: "maxLength",
  minimum: "minimum",
  minItems: "minItems",
  minLength: "minLength",
};

const STRING_TAGS: Record<string, keyof JsonSchema> = {
  format: "format",
  pattern: "pattern",
};

export function harvestConstraints(symbol: ts.Symbol, checker: ts.TypeChecker): Partial<JsonSchema> {
  const out: Partial<JsonSchema> = {};

  const doc = ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim();
  if (doc.length > 0) out.description = doc;

  for (const tag of symbol.getJsDocTags(checker)) applyTag(out, tag);
  return out;
}

function applyTag(out: Partial<JsonSchema>, tag: ts.JSDocTagInfo): void {
  const raw = ts.displayPartsToString(tag.text).trim();

  const numericKey = NUMERIC_TAGS[tag.name];
  if (numericKey !== undefined) {
    const value = Number(raw);
    if (Number.isFinite(value)) (out as Record<string, unknown>)[numericKey] = value;
    return;
  }

  const stringKey = STRING_TAGS[tag.name];
  if (stringKey !== undefined) {
    if (raw.length > 0) (out as Record<string, unknown>)[stringKey] = raw;
    return;
  }

  if (tag.name === "default") {
    out.default = parseDefault(raw);
  }
}

function parseDefault(raw: string): JsonValue {
  if (raw.length === 0) return "";
  try {
    return JSON.parse(raw) as JsonValue;
  } catch {
    return raw;
  }
}

export function mergeConstraints(schema: JsonSchema, extra: Partial<JsonSchema>): JsonSchema {
  const merged: JsonSchema = { ...schema };
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) continue;
    if (key === "description" && merged.description !== undefined) continue;
    (merged as Record<string, unknown>)[key] = value;
  }
  return merged;
}
