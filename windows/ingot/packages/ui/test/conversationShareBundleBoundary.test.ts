import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

//
const UI_SRC_ROOT = fileURLToPath(new URL("../src", import.meta.url));

const SHARE_BOUNDARY_SOURCES = [
  "v4/ConversationShareReadonlyTimeline.tsx",
  "ToolCallBlocks/ToolPresentation.tsx",
  "ToolCallBlocks/resolveRenderer.ts",
  "ToolCallBlocks/ToolCallBody.tsx",
  "ToolCallBlocks/renderers/cuaAppSummaryIcon.tsx",
  "ToolCallBlocks/renderers/cuaListDetails.tsx",
  "ToolCallBlocks/renderers/list-models.tsx",
  "v4/ConversationShareWorkflow.tsx",
  "ToolCallBlocks/renderers/list-saved-workflows-presentation.tsx",
  "chat-input-toolbar/thoughtLevelLabels.ts",
] as const;

const VALUE_IMPORT_DENYLIST: ReadonlySet<string> = new Set([
  "@/OpenSplitButton.js",
  "@/hooks/usePlatform.js",
  "@/hooks/useServices.js",
  "@/ToolCallBlocks.js",
  "@/plugin-ui/index.js",
  "@/chat-input-toolbar/display.js",
  "@/hooks/useFileContextActions.js",
  "@/hooks/useWorkspaceOpenInEditorTarget.js",
  "@/lib/editorPreference.js",
  "@/lib/workspaceEditorSelection.js",
  "@/workspace-file-tree/model.js",
]);

type DeniedValueImportKind = "from-clause" | "side-effect" | "dynamic-import";

interface DeniedValueImport {
  specifier: string;
  kind: DeniedValueImportKind;
}

function normalizeSpecifier(sourceDir: string, specifier: string): string {
  if (!specifier.startsWith(".")) return specifier;
  const fromSrcRoot = relative(UI_SRC_ROOT, resolve(sourceDir, specifier)).replaceAll("\\", "/");
  return fromSrcRoot.startsWith("..") ? specifier : `@/${fromSrcRoot}`;
}

function findDeniedValueImports(source: string, sourceDir: string): DeniedValueImport[] {
  const violations: DeniedValueImport[] = [];
  const fromClausePatterns: ReadonlyArray<readonly [RegExp, DeniedValueImportKind]> = [
    [/^import\s+([^"']*?)\s+from\s*["']([^"']+)["']/gm, "from-clause"],
    [/^export\s+([^"']*?)\s+from\s*["']([^"']+)["']/gm, "from-clause"],
  ];
  for (const [pattern, kind] of fromClausePatterns) {
    for (const match of source.matchAll(pattern)) {
      const clause = match[1] ?? "";
      const specifier = normalizeSpecifier(sourceDir, match[2] ?? "");
      if (VALUE_IMPORT_DENYLIST.has(specifier) && !/^type\b/u.test(clause)) {
        violations.push({ specifier, kind });
      }
    }
  }
  const bareSpecifierPatterns: ReadonlyArray<readonly [RegExp, DeniedValueImportKind]> = [
    [/^import\s+["']([^"']+)["']/gm, "side-effect"],
    [/\bimport\s*\(\s*["']([^"']+)["']/g, "dynamic-import"],
  ];
  for (const [pattern, kind] of bareSpecifierPatterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = normalizeSpecifier(sourceDir, match[1] ?? "");
      if (VALUE_IMPORT_DENYLIST.has(specifier)) violations.push({ specifier, kind });
    }
  }
  return violations;
}

describe("conversation share public-page bundle boundary", () => {
  it("分享只读时间线对 open-with 子树只允许 import type 引用", () => {
    for (const sourceRelPath of SHARE_BOUNDARY_SOURCES) {
      const sourcePath = resolve(UI_SRC_ROOT, sourceRelPath);
      const violations = findDeniedValueImports(
        readFileSync(sourcePath, "utf8"),
        dirname(sourcePath),
      );
      expect(
        violations,
        `${sourceRelPath} 对 open-with 子树存在静态Value import（公开页 bundle Boundaries回归）：` +
          JSON.stringify(violations) +
          ". For Desktop-side capabilities, please inject via consumer components instead (see artifactOpenAction injection contract).",
      ).toEqual([]);
    }
  });

  describe("denylist 提取器形态覆盖（盲区自测）", () => {
    const sourceDir = resolve(UI_SRC_ROOT, "v4/share/nested");

    it("Multi-level relative path from clauses hit denylist after normalization by alias root", () => {
      const violations = findDeniedValueImports(
        'import { OpenSplitButton } from "../../../OpenSplitButton.js";\n',
        sourceDir,
      );
      expect(violations).toEqual([{ specifier: "@/OpenSplitButton.js", kind: "from-clause" }]);
    });

    it("副作用导入（无 from 子句）命中 denylist", () => {
      const violations = findDeniedValueImports('import "@/OpenSplitButton.js";\n', sourceDir);
      expect(violations).toEqual([{ specifier: "@/OpenSplitButton.js", kind: "side-effect" }]);
    });

    it("动态 import() 命中 denylist（公开页会生成异步 chunk）", () => {
      const violations = findDeniedValueImports(
        'const mod = await import("@/OpenSplitButton.js");\n',
        sourceDir,
      );
      expect(violations).toEqual([{ specifier: "@/OpenSplitButton.js", kind: "dynamic-import" }]);
    });

    it("Value-form re-exports hit denylist", () => {
      const violations = findDeniedValueImports(
        'export { OpenSplitButton } from "@/OpenSplitButton.js";\n',
        sourceDir,
      );
      expect(violations).toEqual([{ specifier: "@/OpenSplitButton.js", kind: "from-clause" }]);
    });

    it("import type / export type / 非 denylist 模块不产生违规", () => {
      const violations = findDeniedValueImports(
        [
          'import type { OpenSplitButtonTarget } from "@/OpenSplitButton.js";',
          'export type { OpenSplitButtonTarget } from "@/OpenSplitButton.js";',
          'import { TooltipProvider } from "@/components/ui/tooltip.js";',
          'const x = await import("@origin-ai/cf-shared");',
        ].join("\n"),
        sourceDir,
      );
      expect(violations).toEqual([]);
    });
  });
});
