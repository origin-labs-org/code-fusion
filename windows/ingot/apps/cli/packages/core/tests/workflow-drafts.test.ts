import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WORKFLOW_DRAFTS_DIR } from "@origin-ai/cf-contracts";
import {
  WORKFLOW_DRAFT_FALLBACK_SLUG,
  resolveWorkflowDraftName,
  workflowDraftSlug,
  writeWorkflowDraft,
} from "../src/tool/handlers/workflow-drafts.js";

// docs/dynamic-workflow/launch.md「Script files」→「The drafts directory」。

describe("writeWorkflowDraft", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "dwf-drafts-"));
  });

  afterEach(() => {
    rmSync(cwd, { force: true, recursive: true });
  });

  function draftsDir(): string {
    return join(cwd, WORKFLOW_DRAFTS_DIR);
  }

  it("落在 .cf/workflow-drafts/<slug>.dwf.ts，内容逐字节", async () => {
    const source = 'phase("检查");\nreturn 1;\n';
    const written = await writeWorkflowDraft({ cwd, name: "pr-review", source });
    expect(written?.path).toBe(join(draftsDir(), "pr-review.dwf.ts"));
    expect(readFileSync(written!.path, "utf8")).toBe(source);
  });

  it("Do not overwrite same names; append -2, -3 sequentially: drafts are never wiped out behind the model\'s back", async () => {
    const first = await writeWorkflowDraft({ cwd, name: "nightly", source: "a" });
    const second = await writeWorkflowDraft({ cwd, name: "nightly", source: "b" });
    const third = await writeWorkflowDraft({ cwd, name: "nightly", source: "c" });
    expect(first?.path).toBe(join(draftsDir(), "nightly.dwf.ts"));
    expect(second?.path).toBe(join(draftsDir(), "nightly-2.dwf.ts"));
    expect(third?.path).toBe(join(draftsDir(), "nightly-3.dwf.ts"));
    expect(readFileSync(first!.path, "utf8")).toBe("a");
  });

  it("中文名原样成为文件名；名字里没有可用字符时才落到兜底词", async () => {
    const written = await writeWorkflowDraft({ cwd, name: "发布前检查", source: "return 1;" });
    expect(written?.path).toBe(join(draftsDir(), "发布前检查.dwf.ts"));
    const empty = await writeWorkflowDraft({ cwd, name: "???", source: "return 1;" });
    expect(empty?.path).toBe(join(draftsDir(), `${WORKFLOW_DRAFT_FALLBACK_SLUG}.dwf.ts`));
  });

  it("When name is absent, use script\'s first phase name; only use fallback if there are no phases either", () => {
    const graph = {
      phases: [
        { id: "phase#1", name: "检查改动的文件" },
        { id: "phase#2", name: "汇总" },
      ],
    };
    expect(resolveWorkflowDraftName(undefined, graph)).toBe("检查改动的文件");
    expect(resolveWorkflowDraftName("   ", graph)).toBe("检查改动的文件");
    expect(resolveWorkflowDraftName("PR review", graph)).toBe("PR review");
    expect(resolveWorkflowDraftName(undefined, { phases: [{ id: "unphased" }] })).toBe(
      WORKFLOW_DRAFT_FALLBACK_SLUG,
    );
    expect(resolveWorkflowDraftName(undefined, undefined)).toBe(WORKFLOW_DRAFT_FALLBACK_SLUG);
  });

  it("slug 只保留保存名的字符集，截到 64，且不会是纯点", () => {
    expect(workflowDraftSlug("PR review #12")).toBe("PR-review-12");
    expect(workflowDraftSlug("a/../b")).toBe("a..b");
    expect(workflowDraftSlug("代码评审")).toBe("代码评审");
    expect(workflowDraftSlug("  评审: PR #12  ")).toBe("评审-PR-12");
    expect(workflowDraftSlug("-.-")).toBe(WORKFLOW_DRAFT_FALLBACK_SLUG);
    expect(Array.from(workflowDraftSlug("字".repeat(80)))).toHaveLength(64);
    expect(workflowDraftSlug("..")).toBe(WORKFLOW_DRAFT_FALLBACK_SLUG);
    expect(workflowDraftSlug("x".repeat(80))).toHaveLength(64);
  });

  it("目录自带 .gitignore: *，只写一次，用户改过就不再动它", async () => {
    await writeWorkflowDraft({ cwd, name: "one", source: "a" });
    const gitignore = join(draftsDir(), ".gitignore");
    expect(readFileSync(gitignore, "utf8")).toBe("*\n");

    writeFileSync(gitignore, "# mine\n*\n", "utf8");
    await writeWorkflowDraft({ cwd, name: "two", source: "b" });
    expect(readFileSync(gitignore, "utf8")).toBe("# mine\n*\n");
  });

  it("写不进去时返回 undefined 而不是抛：调用方退回旧文案，工具调用照常完成", async () => {
    writeFileSync(join(cwd, ".cf"), "not a directory", "utf8");
    await expect(
      writeWorkflowDraft({ cwd, name: "x", source: "return 1;" }),
    ).resolves.toBeUndefined();
  });

  it("宿主没有工作目录概念时不写任何东西", async () => {
    await expect(
      writeWorkflowDraft({ cwd: undefined, name: "x", source: "return 1;" }),
    ).resolves.toBeUndefined();
    expect(readdirSync(cwd)).toEqual([]);
  });
});
