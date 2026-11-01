import { describe, expect, it } from "vitest";
import {
  analyzeWorkflowScript,
  collectDiagnostics,
  collectSites,
  collectWorldRunCommands,
  createWorkflowProgram,
  FACADE_DTS,
  lowerWorkflow,
  SNIPPET_FACADE_DTS,
  WORLD_RUN_LITERAL_CODE,
} from "../src/index.js";

describe("facade dts segments", () => {
  it("stays a reference: FACADE_DTS is under 14 000 bytes", () => {
    expect(Buffer.byteLength(FACADE_DTS, "utf8")).toBeLessThan(14_000);
  });

  it("SNIPPET_FACADE_DTS keeps world reads, world.run, log and args, drops actors/report/artifact/phase", () => {
    expect(SNIPPET_FACADE_DTS).toContain("declare const args");
    expect(FACADE_DTS).toContain("declare const args");
    expect(SNIPPET_FACADE_DTS).toContain("declare const files");
    expect(SNIPPET_FACADE_DTS).toContain("declare const git");
    expect(SNIPPET_FACADE_DTS).toContain("declare const world");
    expect(SNIPPET_FACADE_DTS).toContain("declare function log");
    expect(SNIPPET_FACADE_DTS).toContain("declare function channel");
    expect(SNIPPET_FACADE_DTS).toContain("declare function future");
    expect(SNIPPET_FACADE_DTS).toContain("declare interface Channel<T>");
    expect(SNIPPET_FACADE_DTS).not.toContain("declare function agent");
    expect(SNIPPET_FACADE_DTS).not.toContain("declare function report");
    expect(SNIPPET_FACADE_DTS).not.toContain("declare function phase");
    expect(FACADE_DTS).toContain("declare function model");
    expect(SNIPPET_FACADE_DTS).not.toContain("declare function model");
    expect(SNIPPET_FACADE_DTS).not.toContain("ModelRef");
    expect(FACADE_DTS).toContain("declare const artifact");
    expect(SNIPPET_FACADE_DTS).not.toContain("declare const artifact");
    expect(SNIPPET_FACADE_DTS).not.toContain("ArtifactRef");
    expect(FACADE_DTS).toContain(
      "declare function hole<T>(name: string, prompt?: string): Promise<T>;",
    );
    expect(FACADE_DTS).toContain(
      "declare function hole<T>(name: string, body: () => Promise<T>): Promise<T>;",
    );
    expect(FACADE_DTS).toContain(
      "declare function hole<T>(name: string, prompt: string, body: () => Promise<T>): Promise<T>;",
    );
    expect(SNIPPET_FACADE_DTS).not.toContain("declare function hole");
  });

  it("rejects hole() in the snippet facade at compile time (TS2304)", () => {
    const workflow = createWorkflowProgram(`return await hole<string>("决定");`, {
      facadeDts: SNIPPET_FACADE_DTS,
    });
    const diagnostics = collectDiagnostics(workflow.program);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0]?.message).toContain("Cannot find name 'hole'");
  });
});

describe("snippet compilation (scratch facade)", () => {
  const compileSnippet = (scriptText: string) =>
    createWorkflowProgram(scriptText, { facadeDts: SNIPPET_FACADE_DTS });

  it("compiles a world-read + pure-logic snippet cleanly", () => {
    const workflow = compileSnippet(
      `const paths = await files.glob("src/**/*.ts");\n` +
        `log(\`found \${paths.length}\`);\n` +
        `return paths.filter((p) => p.endsWith(".test.ts"));`,
    );
    expect(collectDiagnostics(workflow.program)).toEqual([]);
  });

  it("rejects agent() at compile time (TS2304, not a runtime surprise)", () => {
    const workflow = compileSnippet(`return await agent("a").ask("do it");`);
    const diagnostics = collectDiagnostics(workflow.program);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0]?.message).toContain("Cannot find name 'agent'");
  });

  it("rejects report() and phase() the same way", () => {
    for (const source of [`report({ found: 1 });`, `phase("gate");`]) {
      const workflow = compileSnippet(source);
      expect(collectDiagnostics(workflow.program).length).toBeGreaterThan(0);
    }
  });

  it("lowers files.glob in a snippet to a world-read site (facade filename invariant)", () => {
    const workflow = compileSnippet(`return await files.glob("*.ts");`);
    expect(collectDiagnostics(workflow.program)).toEqual([]);
    const table = collectSites(workflow);
    const lowered = lowerWorkflow(workflow, table);
    expect(lowered.code).toContain(`__host.worldRead("world-read#1", "glob"`);
  });
});

describe("artifact facade (type surface)", () => {
  const diagnosticsOf = (scriptText: string) =>
    collectDiagnostics(createWorkflowProgram(scriptText).program);

  it("types content members as Promise<ArtifactRef>", () => {
    expect(
      diagnosticsOf(
        `const ref = await artifact.file("book", "out/book.pdf", { title: "Book", contentType: "application/pdf" });\n` +
          `const md = await artifact.markdown("notes", "# hi", { description: "d" });\n` +
          `return ref.id + String(ref.version) + md.id;`,
      ),
    ).toEqual([]);
  });

  it("rejects using a content member's result as anything but an ArtifactRef", () => {
    const diagnostics = diagnosticsOf(`const n: number = await artifact.file("book", "b.pdf");`);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0]?.message).toContain("not assignable");
  });

  it("types preset members as void (a declaration has nothing to await)", () => {
    expect(
      diagnosticsOf(
        `artifact.chart("perf", { type: "line", x: { field: "round" }, y: [{ field: "ms", label: "ms" }], scale: "log", baseline: { field: "budget" } });\n` +
          `artifact.table("rows", { columns: [{ field: "name" }], key: "name" });\n` +
          `artifact.metrics("m", { metrics: [{ field: "p95", unit: "ms" }] });\n` +
          `artifact.board("b", { key: "id", status: "state", columns: ["todo", "done"], detail: [{ field: "owner" }] });`,
      ),
    ).toEqual([]);
    const diagnostics = diagnosticsOf(
      `const v: number = artifact.chart("perf", { x: { field: "r" }, y: { field: "m" } });`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("lets a board name itself and its cards separately (the cardTitle rename)", () => {
    expect(
      diagnosticsOf(
        `artifact.board("b", { title: "内存回归", key: "id", status: "state", columns: ["todo"], cardTitle: "name" });`,
      ),
    ).toEqual([]);
    expect(FACADE_DTS).toContain("cardTitle?: string");
  });

  it("accepts primary on every member and rejects a non-boolean one", () => {
    expect(
      diagnosticsOf(
        `await artifact.file("book", "b.pdf", { primary: true });\n` +
          `await artifact.markdown("notes", "# hi", { title: "Notes", primary: false });\n` +
          `artifact.board("b", { key: "id", status: "state", columns: ["todo"], primary: true });`,
      ),
    ).toEqual([]);
    expect(
      diagnosticsOf(`await artifact.file("book", "b.pdf", { primary: "yes" });`).length,
    ).toBeGreaterThan(0);
    expect(FACADE_DTS).toContain("primary?: boolean");
  });

  it("rejects a malformed spec at compile time (missing y, wrong chart type)", () => {
    expect(diagnosticsOf(`artifact.chart("perf", { x: { field: "r" } });`).length).toBeGreaterThan(
      0,
    );
    expect(
      diagnosticsOf(
        `artifact.chart("perf", { x: { field: "r" }, y: { field: "m" }, type: "pie" });`,
      ).length,
    ).toBeGreaterThan(0);
  });

  it("makes report's second argument an optional string", () => {
    expect(diagnosticsOf(`report({ a: 1 });\nreport({ a: 1 }, "perf");`)).toEqual([]);
    expect(diagnosticsOf(`report({ a: 1 }, 1);`).length).toBeGreaterThan(0);
  });

  it("leaves artifact out of the snippet facade (TS2304, not a runtime surprise)", () => {
    const workflow = createWorkflowProgram(`await artifact.file("book", "b.pdf");`, {
      facadeDts: SNIPPET_FACADE_DTS,
    });
    const diagnostics = collectDiagnostics(workflow.program);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0]?.message).toContain("Cannot find name 'artifact'");
  });
});

describe("world.run (compile side)", () => {
  it("typechecks and lowers to the run op with positional args", () => {
    const workflow = createWorkflowProgram(
      `const r = await world.run("lean", ["--make", "proof.lean"], { timeoutMs: 60000 });\n` +
        `return r.exitCode === 0;`,
    );
    expect(collectDiagnostics(workflow.program)).toEqual([]);
    const table = collectSites(workflow);
    const lowered = lowerWorkflow(workflow, table);
    expect(lowered.code).toContain(`__host.worldRead("world-read#1", "run"`);
  });

  it("collects the deduplicated, sorted command set from literals", () => {
    const workflow = createWorkflowProgram(
      `await world.run("node", ["-e", "0"]);\n` +
        `await world.run(\`lean\`, ["a.lean"]);\n` +
        `await world.run("node", ["-e", "1"]);`,
    );
    const table = collectSites(workflow);
    const { commands, diagnostics } = collectWorldRunCommands(workflow, table);
    expect(diagnostics).toEqual([]);
    expect(commands).toEqual(["lean", "node"]);
  });

  it("rejects a non-literal cmd with a positioned WORLD_RUN_LITERAL_CODE diagnostic", () => {
    const workflow = createWorkflowProgram(
      `const cmd = "lean";\nconst r = await world.run(cmd, []);\nreturn r.exitCode;`,
    );
    expect(collectDiagnostics(workflow.program)).toEqual([]);
    const table = collectSites(workflow);
    const { diagnostics } = collectWorldRunCommands(workflow, table);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe(WORLD_RUN_LITERAL_CODE);
    expect(diagnostics[0]?.line).toBe(2);
    expect(diagnostics[0]?.message).toContain("string literal");
    const analyzed = analyzeWorkflowScript(
      `const cmd = "lean";\nconst r = await world.run(cmd, []);\nreturn r.exitCode;`,
    );
    expect(analyzed.ok).toBe(false);
    expect(analyzed.diagnostics[0]?.code).toBe(WORLD_RUN_LITERAL_CODE);
  });

  it("rejects a substitution template cmd", () => {
    const workflow = createWorkflowProgram(
      `const suffix = "n";\nawait world.run(\`lea\${suffix}\`, []);`,
    );
    const table = collectSites(workflow);
    const { diagnostics } = collectWorldRunCommands(workflow, table);
    expect(diagnostics).toHaveLength(1);
  });

  it("keeps the world.run step label carrying the command (confirmation surface)", () => {
    const analyzed = analyzeWorkflowScript(`await world.run("lean", ["a.lean"]);`);
    expect(analyzed.ok).toBe(true);
    const step = analyzed.causality?.steps.find((s) => s.label.includes("lean"));
    expect(step).toBeDefined();
    expect(step?.label).toBe("run lean");
  });
});

describe("args lowering", () => {
  it("lowers a facade args read to __host.args, with no site of its own", () => {
    const workflow = createWorkflowProgram(`const target = String(args.target);\nreturn target;`);
    expect(collectDiagnostics(workflow.program)).toEqual([]);
    const table = collectSites(workflow);
    const lowered = lowerWorkflow(workflow, table);
    expect(lowered.code).toContain("__host.args.target");
    expect(lowered.siteIds).toEqual([]);
  });

  it("lowers args in the snippet facade too (verbatim portability)", () => {
    const workflow = createWorkflowProgram(`return String(args.x);`, {
      facadeDts: SNIPPET_FACADE_DTS,
    });
    expect(collectDiagnostics(workflow.program)).toEqual([]);
    const lowered = lowerWorkflow(workflow, collectSites(workflow));
    expect(lowered.code).toContain("__host.args.x");
  });

  it("leaves a script-declared local `args` alone", () => {
    const workflow = createWorkflowProgram(`const args = { local: 1 };\nreturn args.local;`);
    expect(collectDiagnostics(workflow.program)).toEqual([]);
    const lowered = lowerWorkflow(workflow, collectSites(workflow));
    expect(lowered.code).not.toContain("__host.args");
    expect(lowered.code).toContain("args.local");
  });

  it("leaves a parameter named args and an unrelated `.args` property alone", () => {
    const workflow = createWorkflowProgram(
      [
        "function pick(args: { a: number }): number { return args.a; }",
        "const holder = { args: 7 };",
        "return pick({ a: 1 }) + holder.args;",
      ].join("\n"),
    );
    expect(collectDiagnostics(workflow.program)).toEqual([]);
    const lowered = lowerWorkflow(workflow, collectSites(workflow));
    expect(lowered.code).not.toContain("__host.args");
  });

  it("coexists with ask sites", () => {
    const workflow = createWorkflowProgram(
      `const r = await agent("w").ask(String(args.topic));\nreturn r;`,
    );
    expect(collectDiagnostics(workflow.program)).toEqual([]);
    const table = collectSites(workflow);
    const lowered = lowerWorkflow(workflow, table);
    expect(lowered.code).toContain("__host.args.topic");
    expect(lowered.code).toContain('__host.ask("ask#1"');
  });
});
