// ============================================================
// ============================================================
//

import type { SavedWorkflowArgDeclaration, SavedWorkflowArgsDeclaration } from "@origin-ai/cf-contracts";

export type WorkflowArgsValidation =
  | { ok: true; args: Record<string, unknown> }
  | { ok: false; errors: string[] };

export function validateWorkflowArgs(
  declaration: SavedWorkflowArgsDeclaration | undefined,
  provided: Record<string, unknown> | undefined,
): WorkflowArgsValidation {
  const declared = declaration ?? {};
  const given = provided ?? {};
  const errors: string[] = [];
  const args: Record<string, unknown> = {};

  const declaredNames = Object.keys(declared);
  for (const key of Object.keys(given)) {
    if (declared[key] !== undefined) continue;
    errors.push(
      declaredNames.length === 0
        ? `unknown argument '${key}': this workflow declares no arguments`
        : `unknown argument '${key}' (declared: ${declaredNames.join(", ")})`,
    );
  }

  for (const [key, spec] of Object.entries(declared)) {
    const supplied = given[key];
    if (supplied === undefined) {
      if (spec.default !== undefined) {
        const failure = typeMismatch(key, spec, spec.default, "default value");
        if (failure === undefined) args[key] = spec.default;
        else errors.push(failure);
        continue;
      }
      if (spec.required === true) errors.push(`missing required argument '${key}'`);
      continue;
    }

    const failure = typeMismatch(key, spec, supplied, "value");
    if (failure === undefined) args[key] = supplied;
    else errors.push(failure);
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, args };
}

function typeMismatch(
  key: string,
  spec: SavedWorkflowArgDeclaration,
  value: unknown,
  what: string,
): string | undefined {
  const describe = (expected: string): string =>
    `argument '${key}': expected ${expected}, got ${describeValue(value)} (${what})`;

  switch (spec.type) {
    case "string":
      return typeof value === "string" ? undefined : describe("a string");
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? undefined
        : describe("a finite number");
    case "boolean":
      return typeof value === "boolean" ? undefined : describe("a boolean");
    case "json":
      return undefined;
  }
}

function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return `a ${typeof value}`;
}
