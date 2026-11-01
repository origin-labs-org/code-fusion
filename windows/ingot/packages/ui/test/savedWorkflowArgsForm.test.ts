import { describe, expect, it } from "vitest";
import {
  argsDeclarationToRows,
  buildSavedWorkflowArgFields,
  collectSavedWorkflowArgs,
  formatSavedWorkflowArgValue,
  parseSavedWorkflowArgField,
  rowsToArgsDeclaration,
  type SavedWorkflowArgField,
} from "@/settings/saved-workflows/savedWorkflowArgsForm.js";

function field(overrides: Partial<SavedWorkflowArgField>): SavedWorkflowArgField {
  return {
    name: "x",
    type: "string",
    required: false,
    hasDefault: false,
    value: "",
    ...overrides,
  };
}

describe("buildSavedWorkflowArgFields", () => {
  it("Layout fields by declaration and populate default value text", () => {
    const fields = buildSavedWorkflowArgFields({
      branch: { type: "string", required: true, description: "Target Branch" },
      count: { type: "number", default: 3 },
      dry: { type: "boolean", default: true },
      extra: { type: "json", default: { a: 1 } },
      plain: { type: "boolean" },
    });
    expect(fields.map((entry) => entry.name)).toEqual(["branch", "count", "dry", "extra", "plain"]);
    expect(fields[0]).toMatchObject({
      required: true,
      hasDefault: false,
      value: "",
      description: "Target Branch",
    });
    expect(fields[1]).toMatchObject({ hasDefault: true, value: "3" });
    expect(fields[2]).toMatchObject({ value: "true" });
    expect(fields[3]?.value).toBe(JSON.stringify({ a: 1 }, null, 2));
    expect(fields[4]?.value).toBe("false");
    expect(buildSavedWorkflowArgFields(undefined)).toEqual([]);
  });

  it("formatSavedWorkflowArgValue preserves quotes for JSON-type string default values", () => {
    expect(formatSavedWorkflowArgValue("json", "text")).toBe('"text"');
    expect(formatSavedWorkflowArgValue("string", 42)).toBe("42");
    expect(formatSavedWorkflowArgValue("boolean", undefined)).toBe("false");
  });
});

describe("parseSavedWorkflowArgField / collectSavedWorkflowArgs", () => {
  it("Empty text means absent for optional fields; report required only if mandatory and lacks default value", () => {
    expect(parseSavedWorkflowArgField(field({ value: "" }))).toEqual({ ok: true, omitted: true });
    expect(parseSavedWorkflowArgField(field({ value: "", required: true }))).toEqual({
      ok: false,
      error: "required",
    });
    expect(
      parseSavedWorkflowArgField(field({ value: "", required: true, hasDefault: true })),
    ).toEqual({
      ok: true,
      omitted: true,
    });
  });

  it("Parse by type: number rejects NaN/Infinity, json rejects invalid text, boolean always has a value", () => {
    expect(parseSavedWorkflowArgField(field({ type: "number", value: " 12.5 " }))).toEqual({
      ok: true,
      omitted: false,
      value: 12.5,
    });
    expect(parseSavedWorkflowArgField(field({ type: "number", value: "abc" }))).toEqual({
      ok: false,
      error: "invalid_number",
    });
    expect(parseSavedWorkflowArgField(field({ type: "number", value: "Infinity" }))).toEqual({
      ok: false,
      error: "invalid_number",
    });
    expect(parseSavedWorkflowArgField(field({ type: "json", value: '{"a":[1]}' }))).toEqual({
      ok: true,
      omitted: false,
      value: { a: [1] },
    });
    expect(parseSavedWorkflowArgField(field({ type: "json", value: "{a" }))).toEqual({
      ok: false,
      error: "invalid_json",
    });
    expect(parseSavedWorkflowArgField(field({ type: "boolean", value: "true" }))).toEqual({
      ok: true,
      omitted: false,
      value: true,
    });
  });

  it("Collect all errors across the entire form at once instead of reporting them one by one", () => {
    const result = collectSavedWorkflowArgs([
      field({ name: "branch", required: true }),
      field({ name: "count", type: "number", value: "x" }),
      field({ name: "dry", type: "boolean", value: "false" }),
    ]);
    expect(result).toEqual({ ok: false, errors: { branch: "required", count: "invalid_number" } });
    const ok = collectSavedWorkflowArgs([
      field({ name: "branch", value: "main" }),
      field({ name: "note", value: "" }),
      field({ name: "dry", type: "boolean", value: "false" }),
    ]);
    expect(ok).toEqual({ ok: true, args: { branch: "main", dry: false } });
  });
});

describe("argsDeclarationToRows / rowsToArgsDeclaration", () => {
  it("Declaration ↔ table row round-trip preserves semantics (empty table returns undefined)", () => {
    const declaration = {
      branch: { type: "string" as const, required: true, description: "Target Branch" },
      count: { type: "number" as const, default: 3 },
      dry: { type: "boolean" as const, default: false },
      extra: { type: "json" as const, default: { a: 1 } },
    };
    const rows = argsDeclarationToRows(declaration);
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
    expect(rows[2]?.defaultText).toBe("false");
    expect(rowsToArgsDeclaration(rows)).toEqual({ ok: true, args: declaration });
    expect(rowsToArgsDeclaration([])).toEqual({ ok: true, args: undefined });
    expect(argsDeclarationToRows(undefined)).toEqual([]);
  });

  it("Empty name, duplicate name, and mismatched default value type each have distinct error codes", () => {
    const rows = argsDeclarationToRows({ a: { type: "number" } });
    const result = rowsToArgsDeclaration([
      { ...rows[0]!, defaultText: "abc" },
      {
        key: "new:1",
        name: "  ",
        type: "string",
        required: false,
        defaultText: "",
        description: "",
      },
      {
        key: "new:2",
        name: "dup",
        type: "string",
        required: false,
        defaultText: "",
        description: "",
      },
      {
        key: "new:3",
        name: "dup",
        type: "boolean",
        required: false,
        defaultText: "maybe",
        description: "",
      },
    ]);
    expect(result).toEqual({
      ok: false,
      errors: { "0:a": "invalid_default", "new:1": "empty_name", "new:3": "duplicate_name" },
    });
  });

  it("Trim description, write required only when checked, omit default key when default value is absent", () => {
    const result = rowsToArgsDeclaration([
      {
        key: "k",
        name: " name ",
        type: "string",
        required: false,
        defaultText: "",
        description: "  ",
      },
    ]);
    expect(result).toEqual({ ok: true, args: { name: { type: "string" } } });
  });
});
