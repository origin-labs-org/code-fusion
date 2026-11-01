import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoWikiWorkspaceKey, REPO_WIKI_NO_BRANCH } from "@origin-ai/cf-shared";
import { scanRepo, REPO_WIKI_IGNORE_FILE } from "../src/repo-wiki/repoScanner.js";

async function workspaceWith(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "cf-repo-scan-"));
  for (const [relative, content] of Object.entries(files)) {
    const absolute = join(root, ...relative.split("/"));
    await mkdir(join(absolute, ".."), { recursive: true });
    await writeFile(absolute, content, "utf8");
  }
  return root;
}

describe("repoScanner Qoder alignment", () => {
  it("honours .qoderignore directories and globs", async () => {
    const root = await workspaceWith({
      [REPO_WIKI_IGNORE_FILE]: "# keep it small\nignored/\n*.log\n",
      "README.md": "# repo\n",
      "src/index.ts": "export const a = 1;\n",
      "ignored/hidden.ts": "export const b = 2;\n",
      "debug.log": "noise\n",
    });

    const scan = await scanRepo(root);
    const paths = scan.files.map((file) => file.relativePath).sort();
    // The ignore file itself is a real repo file and stays indexed.
    expect(paths).toEqual([REPO_WIKI_IGNORE_FILE, "README.md", "src/index.ts"]);
  });

  it("applies the depth and per-directory ceilings", async () => {
    const root = await workspaceWith({
      "a/b/c/deep.ts": "export const deep = 1;\n",
      "top1.ts": "export const one = 1;\n",
      "top2.ts": "export const two = 2;\n",
    });

    const shallow = await scanRepo(root, { maxDepth: 0 });
    expect(shallow.files.map((file) => file.relativePath)).not.toContain("a/b/c/deep.ts");

    const capped = await scanRepo(root, { maxDirFiles: 1 });
    expect(capped.files.length).toBeLessThanOrEqual(1);
  });
});

describe("repoWikiWorkspaceKey", () => {
  it("uses Qoder's exact key shape", () => {
    expect(repoWikiWorkspaceKey("C:/repo/app", "feature/x", "en")).toBe(
      "C:/repo/app#wiki#feature/x#wiki#en",
    );
  });

  it("falls back to the non-git sentinel branch", () => {
    expect(repoWikiWorkspaceKey("C:/repo/app", undefined, "ja")).toBe(
      `C:/repo/app#wiki#${REPO_WIKI_NO_BRANCH}#wiki#ja`,
    );
    expect(REPO_WIKI_NO_BRANCH).toBe("Q0DeR-MaG1C-BrAnCh-Fo2-NoN-GiT-Or-No-C0MmIt");
  });
});
