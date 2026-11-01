import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { serializeSchema, synthesizeWorkflowSchemas } from "../src/index.js";

// Fixture-driven schema-synthesis snapshots: every tests/schemas
function bySiteOrdinal(a: string, b: string): number {
  const ordinal = (id: string): number => Number(id.slice(id.indexOf("#") + 1));
  return ordinal(a) - ordinal(b);
}
