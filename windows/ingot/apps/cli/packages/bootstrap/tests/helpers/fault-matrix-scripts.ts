// ============================================================
// ============================================================

export type ScriptShape = "W1" | "W2" | "W4" | "W8" | "W16" | "S-pipe" | "S-nest" | "S-phase";

export interface ShapeSpec {
  script: string;
  
  parallelism: number;
  
  subagents: number;
  
  asks: number;
}

const HEADER = ["interface Out { note: string }", 'const PERSONA = "You are a test worker.";'].join(
  "\n",
);

function flat(n: number): string {
  if (n === 1) {
    return [
      HEADER,
      'const out = await agent("w-1", PERSONA).ask<Out>("Do task 1.");',
      "return out.note;",
    ].join("\n");
  }
  return [
    HEADER,
    `const items = [${Array.from({ length: n }, (_, i) => i + 1).join(", ")}];`,
    "const outs = await Promise.all(",
    "  items.map((i) => agent(`w-${i}`, PERSONA).ask<Out>(`Do task ${i}.`)),",
    ");",
    "return outs.map((o) => o.note);",
  ].join("\n");
}

const PIPE = [
  HEADER,
  "const first = await Promise.all(",
  "  [1, 2, 3, 4].map((i) => agent(`s1-${i}`, PERSONA).ask<Out>(`Stage one, task ${i}.`)),",
  ");",
  "const second = await Promise.all(",
  "  first.map((o, i) => agent(`s2-${i + 1}`, PERSONA).ask<Out>(`Stage two on: ${o.note}`)),",
  ");",
  "return second.map((o) => o.note);",
].join("\n");

const NEST = [
  HEADER,
  "const groups = await Promise.all(",
  "  [1, 2, 3].map((g) =>",
  "    Promise.all(",
  "      [1, 2, 3].map((i) => agent(`g${g}-w${i}`, PERSONA).ask<Out>(`Group ${g}, task ${i}.`)),",
  "    ),",
  "  ),",
  ");",
  "return groups.flat().map((o) => o.note);",
].join("\n");

const PHASE = [
  HEADER,
  'phase("Stage A");',
  "const a = await Promise.all(",
  "  [1, 2, 3, 4].map((i) => agent(`a-${i}`, PERSONA).ask<Out>(`Stage A, task ${i}.`)),",
  ");",
  'phase("Gate");',
  'const gate = await agent("gate", PERSONA).ask<Out>(`Gate on ${a.length} results.`);',
  'phase("Stage B");',
  "const b = await Promise.all(",
  "  [1, 2, 3, 4].map((i) => agent(`b-${i}`, PERSONA).ask<Out>(`Stage B, task ${i}, after ${gate.note}.`)),",
  ");",
  "return b.map((o) => o.note);",
].join("\n");

export const FAULT_MATRIX_SHAPES: Record<ScriptShape, ShapeSpec> = {
  W1: { script: flat(1), parallelism: 1, subagents: 1, asks: 1 },
  W2: { script: flat(2), parallelism: 2, subagents: 2, asks: 2 },
  W4: { script: flat(4), parallelism: 4, subagents: 4, asks: 4 },
  W8: { script: flat(8), parallelism: 8, subagents: 8, asks: 8 },
  W16: { script: flat(16), parallelism: 16, subagents: 16, asks: 16 },
  "S-pipe": { script: PIPE, parallelism: 4, subagents: 8, asks: 8 },
  "S-nest": { script: NEST, parallelism: 9, subagents: 9, asks: 9 },
  "S-phase": { script: PHASE, parallelism: 4, subagents: 9, asks: 9 },
};

export const FAULT_MATRIX_SHAPE_IDS = Object.keys(FAULT_MATRIX_SHAPES) as ScriptShape[];
