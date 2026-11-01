import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseSavedWorkflow,
  resolveSavedWorkflow,
  saveSavedWorkflow,
  serializeSavedWorkflow,
} from "../src/tool/handlers/saved-workflows/index.js";

describe("parseSavedWorkflow — bodyLineOffset", () => {
  it("Body之前的行Count = From始Label记 + YAML + End止行", () => {
    const source = serializeSavedWorkflow({ description: "d" }, "return 1;\n");
    const parsed = parseSavedWorkflow(source);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.bodyLineOffset).toBe(3);
    const fileLines = source.split("\n");
    expect(fileLines[parsed.bodyLineOffset]).toBe("return 1;");
  });

  it("前导空行也算进去", () => {
    const source = `\n\n${serializeSavedWorkflow({ description: "d" }, "return 1;\n")}`;
    const parsed = parseSavedWorkflow(source);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.bodyLineOffset).toBe(5);
    expect(source.split("\n")[parsed.bodyLineOffset]).toBe("return 1;");
  });

  it("多行 args 声明同样对得上", () => {
    const source = serializeSavedWorkflow(
      { description: "d", args: { pr: { type: "string", required: true } } },
      "const x = 1;\nreturn x;\n",
    );
    const parsed = parseSavedWorkflow(source);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(source.split("\n")[parsed.bodyLineOffset]).toBe("const x = 1;");
    expect(source.split("\n")[parsed.bodyLineOffset + 1]).toBe("return x;");
  });
});

describe("resolveSavedWorkflow — source / bodyLineOffset", () => {
  it("带回FileOriginal text（Draft拷贝拿的就Yes它）与偏移", () => {
    const cwd = mkdtempSync(join(tmpdir(), "dwf-frontmatter-"));
    try {
      const { path } = saveSavedWorkflow({
        cwd,
        name: "nightly",
        meta: { description: "d" },
        script: "return 1;\n",
      });
      const found = resolveSavedWorkflow({ cwd, name: "nightly" });
      expect(found.ok).toBe(true);
      if (!found.ok) return;
      expect(found.path).toBe(path);
      expect(found.source).toBe(serializeSavedWorkflow({ description: "d" }, "return 1;\n"));
      expect(found.source.split("\n")[found.bodyLineOffset]).toBe("return 1;");
    } finally {
      rmSync(cwd, { force: true, recursive: true });
    }
  });
});
