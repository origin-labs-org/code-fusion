// ============================================================
// ============================================================

import { WORLD_READ_INPUT_MAX_BYTES, type WorldReadInput } from "./types.js";

const TRUNCATED_ARG_MAX_CHARS = 400;
const MAX_ARGS_KEPT = 8;

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

function previewArg(value: unknown): string {
  let text: string;
  if (typeof value === "string") text = value;
  else {
    try {
      text = JSON.stringify(value) ?? String(value);
    } catch {
      text = String(value);
    }
  }
  return text.length > TRUNCATED_ARG_MAX_CHARS
    ? `${text.slice(0, TRUNCATED_ARG_MAX_CHARS)}…`
    : text;
}

export function boundWorldReadInput(op: string, args: readonly unknown[]): WorldReadInput {
  const plain: WorldReadInput = { op, args: [...args] };
  try {
    const text = JSON.stringify(plain);
    if (text !== undefined && utf8Length(text) <= WORLD_READ_INPUT_MAX_BYTES) return plain;
  } catch {
  }
  return {
    op,
    args: args.slice(0, MAX_ARGS_KEPT).map(previewArg),
    truncated: true,
  };
}
