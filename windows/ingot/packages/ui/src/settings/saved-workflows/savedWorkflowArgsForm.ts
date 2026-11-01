import type { CfSavedWorkflowArgType, CfSavedWorkflowArgsDeclaration } from "@origin-ai/cf-shared";

export interface SavedWorkflowArgField {
  name: string;
  type: CfSavedWorkflowArgType;
  description?: string;
  required: boolean;
  hasDefault: boolean;
  
  value: string;
}

export type SavedWorkflowArgFieldError = "required" | "invalid_number" | "invalid_json";

export function formatSavedWorkflowArgValue(
  type: CfSavedWorkflowArgType,
  value: unknown,
): string {
  if (value === undefined) return type === "boolean" ? "false" : "";
  switch (type) {
    case "string":
      return typeof value === "string" ? value : JSON.stringify(value);
    case "number":
      return typeof value === "number" ? String(value) : String(value);
    case "boolean":
      return value === true ? "true" : "false";
    case "json":
      return typeof value === "string" ? JSON.stringify(value) : JSON.stringify(value, null, 2);
  }
}

export function buildSavedWorkflowArgFields(
  declaration: CfSavedWorkflowArgsDeclaration | undefined,
  initialArgs?: Record<string, unknown>,
): SavedWorkflowArgField[] {
  if (!declaration) return [];
  return Object.entries(declaration).map(([name, spec]) => {
    const initial = initialArgs?.[name];
    return {
      name,
      type: spec.type,
      ...(spec.description === undefined ? {} : { description: spec.description }),
      required: spec.required === true,
      hasDefault: spec.default !== undefined,
      value: formatSavedWorkflowArgValue(spec.type, initial === undefined ? spec.default : initial),
    };
  });
}

type SavedWorkflowArgParse =
  | { ok: true; omitted: true }
  | { ok: true; omitted: false; value: unknown }
  | { ok: false; error: SavedWorkflowArgFieldError };

export function parseSavedWorkflowArgField(field: SavedWorkflowArgField): SavedWorkflowArgParse {
  const raw = field.value;
  if (field.type === "boolean") {
    return { ok: true, omitted: false, value: raw === "true" };
  }
  if (raw.trim().length === 0) {
    if (field.required && !field.hasDefault) return { ok: false, error: "required" };
    return { ok: true, omitted: true };
  }
  switch (field.type) {
    case "string":
      return { ok: true, omitted: false, value: raw };
    case "number": {
      const parsed = Number(raw.trim());
      if (!Number.isFinite(parsed)) return { ok: false, error: "invalid_number" };
      return { ok: true, omitted: false, value: parsed };
    }
    case "json": {
      try {
        return { ok: true, omitted: false, value: JSON.parse(raw) as unknown };
      } catch {
        return { ok: false, error: "invalid_json" };
      }
    }
  }
}

type SavedWorkflowArgsCollect =
  | { ok: true; args: Record<string, unknown> }
  | { ok: false; errors: Record<string, SavedWorkflowArgFieldError> };

export function collectSavedWorkflowArgs(
  fields: readonly SavedWorkflowArgField[],
): SavedWorkflowArgsCollect {
  const args: Record<string, unknown> = {};
  const errors: Record<string, SavedWorkflowArgFieldError> = {};
  for (const field of fields) {
    const parsed = parseSavedWorkflowArgField(field);
    if (!parsed.ok) {
      errors[field.name] = parsed.error;
      continue;
    }
    if (!parsed.omitted) args[field.name] = parsed.value;
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, args };
}

export interface SavedWorkflowArgRow {
  
  key: string;
  name: string;
  type: CfSavedWorkflowArgType;
  required: boolean;
  
  defaultText: string;
  description: string;
}

export type SavedWorkflowArgRowError = "empty_name" | "duplicate_name" | "invalid_default";

export function argsDeclarationToRows(
  declaration: CfSavedWorkflowArgsDeclaration | undefined,
): SavedWorkflowArgRow[] {
  if (!declaration) return [];
  return Object.entries(declaration).map(([name, spec], index) => ({
    key: `${index}:${name}`,
    name,
    type: spec.type,
    required: spec.required === true,
    defaultText:
      spec.default === undefined
        ? ""
        : spec.type === "boolean"
          ? spec.default === true
            ? "true"
            : "false"
          : formatSavedWorkflowArgValue(spec.type, spec.default),
    description: spec.description ?? "",
  }));
}

function parseDefaultText(
  type: CfSavedWorkflowArgType,
  text: string,
): { ok: true; value?: unknown } | { ok: false } {
  if (text.trim().length === 0) return { ok: true };
  switch (type) {
    case "string":
      return { ok: true, value: text };
    case "number": {
      const parsed = Number(text.trim());
      return Number.isFinite(parsed) ? { ok: true, value: parsed } : { ok: false };
    }
    case "boolean":
      if (text === "true") return { ok: true, value: true };
      if (text === "false") return { ok: true, value: false };
      return { ok: false };
    case "json":
      try {
        return { ok: true, value: JSON.parse(text) as unknown };
      } catch {
        return { ok: false };
      }
  }
}

type SavedWorkflowArgRowsCollect =
  | { ok: true; args: CfSavedWorkflowArgsDeclaration | undefined }
  | { ok: false; errors: Record<string, SavedWorkflowArgRowError> };

export function rowsToArgsDeclaration(
  rows: readonly SavedWorkflowArgRow[],
): SavedWorkflowArgRowsCollect {
  const errors: Record<string, SavedWorkflowArgRowError> = {};
  const seen = new Set<string>();
  const args: CfSavedWorkflowArgsDeclaration = {};
  for (const row of rows) {
    const name = row.name.trim();
    if (name.length === 0) {
      errors[row.key] = "empty_name";
      continue;
    }
    if (seen.has(name)) {
      errors[row.key] = "duplicate_name";
      continue;
    }
    seen.add(name);
    const parsedDefault = parseDefaultText(row.type, row.defaultText);
    if (!parsedDefault.ok) {
      errors[row.key] = "invalid_default";
      continue;
    }
    const description = row.description.trim();
    args[name] = {
      type: row.type,
      ...(description.length === 0 ? {} : { description }),
      ...(row.required ? { required: true } : {}),
      ...(parsedDefault.value === undefined ? {} : { default: parsedDefault.value }),
    };
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, args: Object.keys(args).length === 0 ? undefined : args };
}
