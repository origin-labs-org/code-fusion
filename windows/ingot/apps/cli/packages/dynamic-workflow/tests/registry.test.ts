import ts from "typescript";
import { describe, expect, it } from "vitest";
import { createWorkflowProgram } from "../src/compiler/compile.js";
import { collectSites } from "../src/analysis/sites.js";
import {
  facadeMemberOf,
  isSiteProducing,
  SITE_MEMBER_NAMES,
  siteProducingFunctionOfSymbol,
  WORLD_READ_REGISTRY,
  worldReadOp,
  worldReadOpOfSymbol,
} from "../src/facade/registry.js";

function symbols(scriptText: string): (name: string) => ts.Symbol | undefined {
  const { program, scriptFile } = createWorkflowProgram(scriptText);
  const checker = program.getTypeChecker();
  const found = new Map<string, ts.Symbol>();
  const walk = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      if (symbol !== undefined && !found.has(node.text)) found.set(node.text, symbol);
    }
    ts.forEachChild(node, walk);
  };
  walk(scriptFile);
  return (name) => found.get(name);
}

describe("world-read registry — pure lookup", () => {
  it("keys on (container, member), so a bare member name never resolves alone", () => {
    expect(worldReadOp("files", "glob")).toBe("glob");
    expect(worldReadOp("files", "read")).toBe("read");
    expect(worldReadOp("files", "grep")).toBe("grep");
    expect(worldReadOp("git", "changedFiles")).toBe("git-changed-files");
    expect(worldReadOp("git", "diff")).toBe("git-diff");
    expect(worldReadOp("git", "status")).toBe("git-status");
    expect(worldReadOp("git", "log")).toBe("git-log");
    expect(worldReadOp(undefined, "glob")).toBeUndefined();
    expect(worldReadOp("git", "glob")).toBeUndefined();
    expect(worldReadOp("files", "log")).toBeUndefined();
    expect(worldReadOp("files", "nope")).toBeUndefined();
  });

  it("gives every op a distinct name and every member a distinct one too", () => {
    const ops = WORLD_READ_REGISTRY.map((row) => row.op);
    expect(new Set(ops).size).toBe(ops.length);
    const members = WORLD_READ_REGISTRY.map((row) => row.member);
    expect(new Set(members).size).toBe(members.length);
  });

  it("derives the site-producing member set from the table (plus ask)", () => {
    for (const row of WORLD_READ_REGISTRY) {
      expect(SITE_MEMBER_NAMES.has(row.member)).toBe(true);
      expect(worldReadOp(row.container, row.member)).toBe(row.op);
    }
    expect(SITE_MEMBER_NAMES.has("ask")).toBe(true);
    expect(SITE_MEMBER_NAMES.has("log")).toBe(true);
    expect(isSiteProducing(undefined, "log")).toBe(false);
  });

  it("treats report as a site-producing top-level function and log as not", () => {
    expect(isSiteProducing(undefined, "report")).toBe(true);
    expect(isSiteProducing(undefined, "log")).toBe(false);
    expect(siteProducingFunctionOfSymbol(undefined)).toBeUndefined();
    expect(worldReadOp(undefined, "report")).toBeUndefined();
    expect(SITE_MEMBER_NAMES.has("report")).toBe(false);
  });

  it("treats agent/Agent.ask as site-producing and log as not", () => {
    expect(isSiteProducing(undefined, "agent")).toBe(true);
    expect(isSiteProducing("Agent", "ask")).toBe(true);
    expect(isSiteProducing("files", "glob")).toBe(true);
    expect(isSiteProducing("files", "grep")).toBe(true);
    expect(isSiteProducing("git", "log")).toBe(true);
    expect(isSiteProducing(undefined, "log")).toBe(false);
    expect(worldReadOp(undefined, "log")).toBeUndefined();
  });
});

describe("world-read registry — declaration-based resolution", () => {
  const lookup = symbols(
    `const paths = await files.glob("src/**");\n` +
      `const body = await files.read(paths[0] ?? "x");\n` +
      `log(body);\n` +
      `const out = await agent("a").ask<string>("go");\n` +
      `return out;\n`,
  );

  it("resolves a facade member's declaring container from its declaration", () => {
    expect(facadeMemberOf(lookup("glob"))).toEqual({ container: "files", member: "glob" });
    expect(facadeMemberOf(lookup("read"))).toEqual({ container: "files", member: "read" });
    expect(facadeMemberOf(lookup("ask"))).toEqual({ container: "Agent", member: "ask" });
    expect(facadeMemberOf(lookup("log"))).toEqual({ container: undefined, member: "log" });
    expect(facadeMemberOf(lookup("agent"))).toEqual({ container: undefined, member: "agent" });
  });

  it("resolves the two bare site-producing functions and rejects log", () => {
    const fns = symbols(
      `report({ a: 1 });\nlog("x");\nconst out = await agent("a").ask<string>("go");\nreturn out;\n`,
    );
    expect(siteProducingFunctionOfSymbol(fns("report"))).toBe("report");
    expect(siteProducingFunctionOfSymbol(fns("agent"))).toBe("agent");
    expect(siteProducingFunctionOfSymbol(fns("log"))).toBeUndefined();
    expect(siteProducingFunctionOfSymbol(fns("ask"))).toBeUndefined();
  });

  it("does not resolve a script-local function named report", () => {
    const local = symbols(
      `const report = (item: unknown): void => { void item; };\nreport({ a: 1 });\nreturn 1;\n`,
    );
    expect(siteProducingFunctionOfSymbol(local("report"))).toBeUndefined();
    expect(facadeMemberOf(local("report"))).toBeUndefined();
  });

  it("maps only facade-declared members to ops", () => {
    expect(worldReadOpOfSymbol(lookup("glob"))).toBe("glob");
    expect(worldReadOpOfSymbol(lookup("read"))).toBe("read");
    expect(worldReadOpOfSymbol(lookup("log"))).toBeUndefined();
    expect(worldReadOpOfSymbol(lookup("ask"))).toBeUndefined();
    expect(worldReadOpOfSymbol(undefined)).toBeUndefined();
  });

  it("resolves the two `log` declarations to different identities in one script", () => {
    const topLevel = symbols(`log("progress");\nreturn 1;\n`);
    expect(facadeMemberOf(topLevel("log"))).toEqual({ container: undefined, member: "log" });
    expect(worldReadOpOfSymbol(topLevel("log"))).toBeUndefined();

    const gitLog = symbols(`const c = await git.log(3);\nreturn c.length;\n`);
    expect(facadeMemberOf(gitLog("log"))).toEqual({ container: "git", member: "log" });
    expect(worldReadOpOfSymbol(gitLog("log"))).toBe("git-log");
  });

  it("resolves the whole git container and files.grep from declarations", () => {
    const git = symbols(
      `const changed = await git.changedFiles();\n` +
        `const d = await git.diff("HEAD");\n` +
        `const s = await git.status();\n` +
        `const hits = await files.grep("TODO", "*.ts");\n` +
        `return [changed.length, d.length, s.clean, hits.length];\n`,
    );
    expect(worldReadOpOfSymbol(git("changedFiles"))).toBe("git-changed-files");
    expect(worldReadOpOfSymbol(git("diff"))).toBe("git-diff");
    expect(worldReadOpOfSymbol(git("status"))).toBe("git-status");
    expect(worldReadOpOfSymbol(git("grep"))).toBe("grep");
    expect(facadeMemberOf(git("grep"))).toEqual({ container: "files", member: "grep" });
  });

  it("does not resolve a script-local object whose members merely share the names", () => {
    const local = symbols(
      `const fake = { glob(p: string): string[] { return [p]; }, read(p: string): string { return p; } };\n` +
        `const out = fake.glob("x").join(fake.read("y"));\n` +
        `return out;\n`,
    );
    expect(facadeMemberOf(local("glob"))).toBeUndefined();
    expect(worldReadOpOfSymbol(local("glob"))).toBeUndefined();
    expect(worldReadOpOfSymbol(local("read"))).toBeUndefined();
  });

  it("does not resolve a script-local `git`-shaped object (shadowing the facade)", () => {
    const local = symbols(
      `const myGit = { status(): string { return "clean"; }, log(n: number): number { return n; } };\n` +
        `return myGit.status() + String(myGit.log(1));\n`,
    );
    expect(worldReadOpOfSymbol(local("status"))).toBeUndefined();
    expect(worldReadOpOfSymbol(local("log"))).toBeUndefined();
  });
});

describe("world-read registry — site collection uses it", () => {
  it("sites facade world reads with the registry op, not the member name", () => {
    const table = collectSites(
      createWorkflowProgram(
        `const paths = await files.glob("src/**");\n` +
          `const body = await files.read(paths[0] ?? "x");\n` +
          `return body;\n`,
      ),
    );
    expect(table.worldReads.map((site) => site.op)).toEqual(["glob", "read"]);
    expect(table.worldReads.map((site) => site.id)).toEqual(["world-read#1", "world-read#2"]);
    expect(table.worldReads[0]?.args).toHaveLength(1);
  });

  it("sites every new op on one shared world-read counter, args packed positionally", () => {
    const table = collectSites(
      createWorkflowProgram(
        `const hits = await files.grep("TODO", "*.ts");\n` +
          `const changed = await git.changedFiles();\n` +
          `const d = await git.diff("main", "src/a.ts");\n` +
          `const s = await git.status();\n` +
          `const c = await git.log(5);\n` +
          `return [hits.length, changed.length, d.length, s.clean, c.length];\n`,
      ),
    );
    expect(table.worldReads.map((site) => site.op)).toEqual([
      "grep",
      "git-changed-files",
      "git-diff",
      "git-status",
      "git-log",
    ]);
    expect(table.worldReads.map((site) => site.id)).toEqual([
      "world-read#1",
      "world-read#2",
      "world-read#3",
      "world-read#4",
      "world-read#5",
    ]);
    expect(table.worldReads.map((site) => site.args.length)).toEqual([2, 0, 2, 0, 1]);
  });

  it("mints no world-read site for a same-named script-local method", () => {
    const table = collectSites(
      createWorkflowProgram(
        `const fake = { glob(p: string): string[] { return [p]; } };\n` +
          `const out = fake.glob("x");\n` +
          `return out.length;\n`,
      ),
    );
    expect(table.worldReads).toEqual([]);
  });

  it("mints a site for git.log and none for the top-level log, in one script", () => {
    const table = collectSites(
      createWorkflowProgram(
        `log("progress");\n` +
          `const c = await git.log(3);\n` +
          `log("done");\n` +
          `const out = await agent("a").ask<string>(String(c.length));\n` +
          `return out;\n`,
      ),
    );
    expect(table.worldReads).toHaveLength(1);
    expect(table.worldReads[0]?.op).toBe("git-log");
    expect(table.worldReads[0]?.id).toBe("world-read#1");
    expect(table.asks).toHaveLength(1);
  });

  it("mints no world-read site for the top-level log alone", () => {
    const table = collectSites(
      createWorkflowProgram(
        `log("progress");\nconst out = await agent("a").ask<string>("go");\nreturn out;\n`,
      ),
    );
    expect(table.worldReads).toEqual([]);
    expect(table.asks).toHaveLength(1);
  });
});
