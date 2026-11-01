import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

//
const distDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const ENTRY = join(distDir, "projections.js");

const SPECIFIER =
  /(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']/g;

function specifiersOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const out: string[] = [];
  for (const match of source.matchAll(SPECIFIER)) out.push((match[1] ?? match[2]) as string);
  return out;
}

function walk(entry: string): { files: string[]; bare: Map<string, string[]> } {
  const files: string[] = [];
  const bare = new Map<string, string[]>();
  const queue = [entry];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    files.push(file);
    for (const spec of specifiersOf(file)) {
      if (spec.startsWith(".") || spec.startsWith("/")) {
        queue.push(resolve(dirname(file), spec));
      } else {
        const list = bare.get(spec) ?? [];
        list.push(file);
        bare.set(spec, list);
      }
    }
  }
  return { bare, files };
}

describe("projections barrel is browser-safe", () => {
  it("no reachable dist file imports typescript (or any other bare specifier)", () => {
    const { bare, files } = walk(ENTRY);
    expect(files.length).toBeGreaterThan(5);
    const leaks = [...bare.entries()].map(
      ([spec, importers]) => `${spec} <- ${importers.join(", ")}`,
    );
    expect(leaks, "bare imports reachable from the browser barrel").toEqual([]);
    expect(bare.has("typescript")).toBe(false);
    expect(walk(join(distDir, "index.js")).bare.has("typescript")).toBe(true);
  });

  it("does not reach the analyzer front-end modules", () => {
    const { files } = walk(ENTRY);
    const names = files.map((file) => file.slice(distDir.length + 1));
    for (const forbidden of [
      "analysis/causality-order.js",
      "analysis/analyze.js",
      "compiler/compile.js",
      "analysis/domain.js",
    ]) {
      expect(names, `${forbidden} must not be reachable`).not.toContain(forbidden);
    }
  });
});
