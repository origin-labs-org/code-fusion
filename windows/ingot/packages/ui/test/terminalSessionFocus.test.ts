import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readSource(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("persistentKey path input pipeline keep-alive contract", () => {
  it("persistent 路径的 term.onData 挂在 registryDisposers 而非 localDisposers", () => {
    const source = readSource("packages/ui/src/terminal/TerminalSession.tsx");
    const onDataIdx = source.indexOf("term.onData(");
    expect(onDataIdx).toBeGreaterThanOrEqual(0);
    const beforeOnData = source.slice(0, onDataIdx);
    expect(beforeOnData.lastIndexOf("registryDisposers.push(")).toBeGreaterThan(
      beforeOnData.lastIndexOf("localDisposers.push("),
    );
  });

  it("persistent 路径的 Windows Input法 textarea 兜底也挂在 registryDisposers", () => {
    const source = readSource("packages/ui/src/terminal/TerminalSession.tsx");
    const removeIdx = source.indexOf('removeEventListener("input", handleInput, true)');
    expect(removeIdx).toBeGreaterThanOrEqual(0);
    const beforeRemove = source.slice(0, removeIdx);
    expect(beforeRemove.lastIndexOf("registryDisposers.push(")).toBeGreaterThan(
      beforeRemove.lastIndexOf("localDisposers.push("),
    );
  });
});
