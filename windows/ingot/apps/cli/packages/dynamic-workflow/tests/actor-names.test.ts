import { describe, expect, it } from "vitest";
import { analyzeWorkflowScript } from "../src/index.js";
import { DUPLICATE_ACTOR_NAME_CODE, FANOUT_ACTOR_NAME_CODE } from "../src/analysis/actor-names.js";

function duplicates(scriptText: string) {
  const result = analyzeWorkflowScript(scriptText);
  const hits = result.diagnostics.filter((d) => d.code === DUPLICATE_ACTOR_NAME_CODE);
  return { hits, result };
}

function fanOutNames(scriptText: string) {
  const result = analyzeWorkflowScript(scriptText);
  const hits = result.diagnostics.filter((d) => d.code === FANOUT_ACTOR_NAME_CODE);
  return { hits, result };
}

function expectClean(scriptText: string): void {
  const { result } = duplicates(scriptText);
  expect(result.diagnostics).toEqual([]);
  expect(result.ok).toBe(true);
}

describe("duplicate actor names (compile-time courtesy)", () => {
  it("flags two literal name arguments that are the same string, on the later site", () => {
    const { hits, result } = duplicates(
      `const a = agent("planner");\nconst b = agent("planner");\nreturn 1;`,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]?.line).toBe(2);
    expect(hits[0]?.message).toContain('"planner"');
    expect(result.ok).toBe(false);
    expect(result.graph).toBeUndefined();
  });

  it("reads through an object-literal persona to the name argument", () => {
    const { hits } = duplicates(
      `const a = agent("planner", { system: "You plan first." });\n` +
        `const b = agent("planner", { system: "You plan." });\n` +
        `return 1;`,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]?.line).toBe(2);
  });

  it("takes a string persona as a system prompt, not a name", () => {
    const { hits } = duplicates(
      `const a = agent("planner", "You plan.");\n` +
        `const b = agent("planner", "You also plan.");\n` +
        `return 1;`,
    );
    expect(hits).toHaveLength(1);
  });

  it("reports each later repetition of a name", () => {
    const { hits } = duplicates(
      `const a = agent("w");\nconst b = agent("w");\nconst c = agent("w");\nreturn 1;`,
    );
    expect(hits.map((d) => d.line)).toEqual([2, 3]);
  });

  it("leaves anonymous actors alone, however many", () => {
    expectClean(`const a = agent();\nconst b = agent();\nreturn 1;`);
  });

  it("leaves empty names alone (empty is anonymous, matching the engine)", () => {
    expectClean(`const a = agent("");\nconst b = agent("");\nreturn 1;`);
  });

  it("leaves distinct names alone", () => {
    expectClean(`const a = agent("planner");\nconst b = agent("reviewer");\nreturn 1;`);
  });

  it("skips dynamic names — the runtime check is the real gate", () => {
    expectClean(
      `const workers = [1, 2, 3].map((i) => agent(\`worker-\${i}\`));\n` +
        `const n = "planner";\nconst p = agent(n);\nconst q = agent(n);\n` +
        `return workers.length;`,
    );
  });

  it("skips a persona with a computed key (the key itself could be `name`)", () => {
    expectClean(
      `const a = agent("w", { ["system"]: "You work." });\n` +
        `const b = agent("w", { ["system"]: "You work." });\n` +
        `return 1;`,
    );
  });

  it("skips a template-with-holes persona (it is a runtime string, not a literal)", () => {
    expectClean(
      `const role = "planner";\n` +
        `const a = agent("w", \`You are the \${role}.\`);\n` +
        `const b = agent("w", \`You are the \${role}.\`);\n` +
        `return 1;`,
    );
  });

  it("skips dynamic names inside a fan-out too (per-element names are the fix, not a violation)", () => {
    expectClean(
      `const paths = await files.glob("src/**/*.ts");\n` +
        `const notes = await Promise.all(paths.map((p) => agent(\`reviewer-\${p}\`).ask<string>(\`Review \${p}\`)));\n` +
        `return notes.length;`,
    );
  });

  it("skips a spread persona and a non-literal persona (either could carry a name)", () => {
    expectClean(
      `const base = { system: "You work." };\n` +
        `const a = agent("w", { ...base });\nconst b = agent("w", base);\nreturn 1;`,
    );
  });
});

describe("static actor names inside a fan-out (compile-time)", () => {
  it("flags a literal name inside an array-method fan-out, without withholding the graph", () => {
    const { hits, result } = fanOutNames(
      `const paths = await files.glob("src/**/*.ts");\n` +
        `const verdicts = await Promise.all(paths.map((p) => agent("reviewer").ask<string>(\`Review \${p}\`)));\n` +
        `return verdicts.length;`,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]?.line).toBe(2);
    expect(hits[0]?.message).toContain("fan-out");
    expect(hits[0]?.message).toContain('"reviewer"');
    expect(result.ok).toBe(false);
    expect(result.graph).toBeDefined();
    expect(result.causality).toBeDefined();
  });

  it("flags a literal name inside a for...of body", () => {
    const { hits } = fanOutNames(
      `const items = ["a", "b"];\nconst out: string[] = [];\n` +
        `for (const item of items) {\n  const w = agent("worker");\n  out.push(await w.ask<string>(\`Do \${item}\`));\n}\n` +
        `return out;`,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]?.line).toBe(4);
  });

  it("still withholds the graph when a blocking clause fires alongside it", () => {
    const { result } = fanOutNames(
      `const paths = await files.glob("src/**/*.ts");\n` +
        `const verdicts = await Promise.all(paths.map((p) => agent("reviewer").ask<string>(\`Review \${p}\`)));\n` +
        `const a = agent("dup");\nconst b = agent("dup");\n` +
        `return [verdicts.length, await a.ask<string>("x"), await b.ask<string>("y")];`,
    );
    expect(result.ok).toBe(false);
    expect(result.graph).toBeUndefined();
  });

  it("leaves an anonymous actor inside a fan-out alone", () => {
    expectClean(
      `const paths = await files.glob("src/**/*.ts");\n` +
        `const verdicts = await Promise.all(paths.map((p) => agent().ask<string>(\`Review \${p}\`)));\n` +
        `return verdicts.length;`,
    );
  });

  it("leaves a literal name outside any fan-out alone (single site = runtime's business)", () => {
    expectClean(
      `const reviewer = agent("reviewer");\nreturn await reviewer.ask<string>("Review.");`,
    );
  });

  it("reports one diagnostic per site, preferring the fan-out clause over the duplicate one", () => {
    const script =
      `const paths = await files.glob("src/**/*.ts");\n` +
      `const verdicts = await Promise.all(paths.map((p) => agent("reviewer").ask<string>(\`Review \${p}\`)));\n` +
      `const late = agent("reviewer");\n` +
      `return [verdicts.length, await late.ask<string>("Again?")];`;
    expect(fanOutNames(script).hits.map((d) => d.line)).toEqual([2]);
    expect(duplicates(script).hits.map((d) => d.line)).toEqual([3]);
  });
});
