// ============================================================
// ============================================================

import type { JsonSchema } from "@origin-ai/cf-contracts";

const STRICT_STRING_FORMATS = new Set([
  "date-time",
  "time",
  "date",
  "duration",
  "email",
  "hostname",
  "uri",
  "ipv4",
  "ipv6",
  "uuid",
]);

const FOLDED_KEYWORDS: Record<string, (value: unknown) => string> = {
  minimum: (v) => `minimum ${String(v)}`,
  maximum: (v) => `maximum ${String(v)}`,
  exclusiveMinimum: (v) => `greater than ${String(v)}`,
  exclusiveMaximum: (v) => `less than ${String(v)}`,
  multipleOf: (v) => `multiple of ${String(v)}`,
  minLength: (v) => `at least ${String(v)} characters`,
  maxLength: (v) => `at most ${String(v)} characters`,
  pattern: (v) => `must match /${String(v)}/`,
  minItems: (v) => `at least ${String(v)} items`,
  maxItems: (v) => `at most ${String(v)} items`,
  default: (v) => `default ${JSON.stringify(v)}`,
};

export function isAnthropicFirstPartyModelId(modelId: string | undefined): boolean {
  return typeof modelId === "string" && modelId.startsWith("claude-");
}

export function toStrictToolSchema(schema: JsonSchema): JsonSchema | undefined {
  const out = strictNode(schema);
  return out === INELIGIBLE ? undefined : out;
}

const INELIGIBLE = Symbol("ineligible");
type StrictNode = JsonSchema | typeof INELIGIBLE;

function strictNode(node: JsonSchema): StrictNode {
  if ("$ref" in node || "$defs" in node || "prefixItems" in node) return INELIGIBLE;

  const notes: string[] = [];
  const out: JsonSchema = {};
  for (const [key, value] of Object.entries(node)) {
    const fold = FOLDED_KEYWORDS[key];
    if (fold !== undefined) {
      notes.push(fold(value));
      continue;
    }
    if (key === "format" && typeof value === "string" && !STRICT_STRING_FORMATS.has(value)) {
      notes.push(`format ${value}`);
      continue;
    }
    out[key] = value;
  }

  if (isRecord(out.properties)) {
    const properties: Record<string, JsonSchema> = {};
    for (const [name, child] of Object.entries(out.properties)) {
      if (!isRecord(child)) return INELIGIBLE;
      const strictChild = strictNode(child);
      if (strictChild === INELIGIBLE) return INELIGIBLE;
      properties[name] = strictChild;
    }
    out.properties = properties;
  }
  if (isRecord(out.items)) {
    const items = strictNode(out.items);
    if (items === INELIGIBLE) return INELIGIBLE;
    out.items = items;
  }
  for (const combinator of ["anyOf", "allOf"] as const) {
    const branches = out[combinator];
    if (!Array.isArray(branches)) continue;
    const strictBranches: JsonSchema[] = [];
    for (const branch of branches) {
      if (!isRecord(branch)) return INELIGIBLE;
      const strictBranch = strictNode(branch);
      if (strictBranch === INELIGIBLE) return INELIGIBLE;
      strictBranches.push(strictBranch);
    }
    out[combinator] = strictBranches;
  }

  const types = Array.isArray(out.type) ? out.type : out.type === undefined ? [] : [out.type];
  if (types.includes("object")) {
    if (isRecord(out.additionalProperties)) return INELIGIBLE;
    if (out.additionalProperties !== false) out.additionalProperties = false;
    if (!isRecord(out.properties)) out.properties = {};
  }
  if (Object.keys(out).length === 0 && notes.length === 0) return INELIGIBLE;

  if (notes.length > 0) {
    const existing = typeof out.description === "string" ? out.description.trim() : "";
    const folded = notes.join("; ");
    out.description = existing.length > 0 ? `${existing} (${folded})` : folded;
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
