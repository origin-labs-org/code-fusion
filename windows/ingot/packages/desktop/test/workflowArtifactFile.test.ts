//
//
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { dirname, join, relative, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setDataBaseDir } from "@origin-ai/cf-services/node";
import {
  WORKFLOW_ARTIFACT_FILE_MAX_BYTES,
  materializeWorkflowArtifactFile,
} from "../src/main/workflowArtifactFile.js";

let tempRoot = "";

function artifactsRoot(): string {
  return join(tempRoot, ".cf", "tmp", "workflow-artifacts");
}

function segmentDir(id: string): string {
  return `${id}-${createHash("sha256").update(id, "utf8").digest("hex").slice(0, 8)}`;
}

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "cf-dwf-artifact-file-"));
  setDataBaseDir(tempRoot);
});

afterEach(async () => {
  setDataBaseDir(null);
  await rm(tempRoot, { recursive: true, force: true });
});

describe("materializeWorkflowArtifactFile", () => {
  it("Write bytes for this version into directories separated by run / artifact / version", async () => {
    const result = await materializeWorkflowArtifactFile({
      runId: "dwfrun-1",
      artifactId: "report",
      version: 2,
      fileName: "report.md",
      bytes: bytesOf("# v2"),
    });

    expect(result.localPath).toBe(
      join(artifactsRoot(), segmentDir("dwfrun-1"), segmentDir("report"), "v2", "report.md"),
    );
    await expect(readFile(result.localPath, "utf8")).resolves.toBe("# v2");
  });

  it("Do not overwrite if file exists at path: preserve externally edited copy so reopening accesses the same file", async () => {
    const request = {
      runId: "dwfrun-1",
      artifactId: "report",
      version: 1,
      fileName: "report.md",
      bytes: bytesOf("# published"),
    };
    const first = await materializeWorkflowArtifactFile(request);
    await writeFile(first.localPath, "# edited by the user");

    const second = await materializeWorkflowArtifactFile(request);

    expect(second.localPath).toBe(first.localPath);
    await expect(readFile(second.localPath, "utf8")).resolves.toBe("# edited by the user");
  });

  it("Two concurrent runs of the same version: both receive the same path with a single complete file and no temporary files left", async () => {
    const request = {
      runId: "dwfrun-1",
      artifactId: "book",
      version: 1,
      fileName: "book.pdf",
      bytes: bytesOf("%PDF-1.7 whole"),
    };
    const [a, b] = await Promise.all([
      materializeWorkflowArtifactFile(request),
      materializeWorkflowArtifactFile(request),
    ]);

    expect(a.localPath).toBe(b.localPath);
    await expect(readFile(a.localPath, "utf8")).resolves.toBe("%PDF-1.7 whole");
    await expect(readdir(dirname(a.localPath))).resolves.toEqual(["book.pdf"]);
  });

  it("Store each version separately without overwriting one another", async () => {
    const v1 = await materializeWorkflowArtifactFile({
      runId: "dwfrun-1",
      artifactId: "report",
      version: 1,
      fileName: "report.md",
      bytes: bytesOf("one"),
    });
    const v2 = await materializeWorkflowArtifactFile({
      runId: "dwfrun-1",
      artifactId: "report",
      version: 2,
      fileName: "report.md",
      bytes: bytesOf("two"),
    });

    expect(v1.localPath).not.toBe(v2.localPath);
    await expect(readFile(v1.localPath, "utf8")).resolves.toBe("one");
    await expect(readFile(v2.localPath, "utf8")).resolves.toBe("two");
  });

  it("Sanitize all path segments provided by renderer: cannot write outside workflow-artifacts directory", async () => {
    const result = await materializeWorkflowArtifactFile({
      runId: "../../escape",
      artifactId: "..",
      version: 1,
      fileName: "../../../etc/evil.md",
      bytes: bytesOf("x"),
    });

    expect(result.localPath.startsWith(artifactsRoot() + sep)).toBe(true);
    const segments = relative(artifactsRoot(), result.localPath).split(sep);
    expect(segments).toHaveLength(4);
    expect(segments.every((segment) => !segment.startsWith("."))).toBe(true);
    expect(segments.at(-1)).toBe("evil.md");
  });

  it("Preserve Unicode and file extensions in filenames, replacing only platform-illegal characters", async () => {
    const result = await materializeWorkflowArtifactFile({
      runId: "dwfrun-1",
      artifactId: "sheet",
      version: 1,
      fileName: "Quarterly:Report<Draft>?.xlsx",
      bytes: bytesOf("x"),
    });

    expect(result.localPath.endsWith(`${sep}季度_Report_Draft__.xlsx`)).toBe(true);
  });

  it("Windows 保留名与空文件名换成可用的名字", async () => {
    const reserved = await materializeWorkflowArtifactFile({
      runId: "dwfrun-1",
      artifactId: "a",
      version: 1,
      fileName: "CON.md",
      bytes: bytesOf("x"),
    });
    const empty = await materializeWorkflowArtifactFile({
      runId: "dwfrun-1",
      artifactId: "b",
      version: 1,
      fileName: "   ",
      bytes: bytesOf("x"),
    });

    expect(reserved.localPath.endsWith(`${sep}_CON.md`)).toBe(true);
    expect(empty.localPath.endsWith(`${sep}b`)).toBe(true);
  });

  it("Artifact IDs considered distinct by engine are saved to separate directories: differing by case or just a leading dot", async () => {
    for (const [first, second] of [
      ["Report", "report"],
      [".notes", "notes"],
    ] as const) {
      const a = await materializeWorkflowArtifactFile({
        runId: "dwfrun-1",
        artifactId: first,
        version: 1,
        fileName: "same.md",
        bytes: bytesOf(first),
      });
      const b = await materializeWorkflowArtifactFile({
        runId: "dwfrun-1",
        artifactId: second,
        version: 1,
        fileName: "same.md",
        bytes: bytesOf(second),
      });

      expect(a.localPath.toLowerCase()).not.toBe(b.localPath.toLowerCase());
      await expect(readFile(a.localPath, "utf8")).resolves.toBe(first);
      await expect(readFile(b.localPath, "utf8")).resolves.toBe(second);
    }
  });

  it("Two run IDs differing only by case are saved to separate directories", async () => {
    const a = await materializeWorkflowArtifactFile({
      runId: "Run-1",
      artifactId: "report",
      version: 1,
      fileName: "report.md",
      bytes: bytesOf("upper"),
    });
    const b = await materializeWorkflowArtifactFile({
      runId: "run-1",
      artifactId: "report",
      version: 1,
      fileName: "report.md",
      bytes: bytesOf("lower"),
    });

    expect(a.localPath.toLowerCase()).not.toBe(b.localPath.toLowerCase());
    await expect(readFile(a.localPath, "utf8")).resolves.toBe("upper");
    await expect(readFile(b.localPath, "utf8")).resolves.toBe("lower");
  });

  it("Refuse to write bytes exceeding 20 MiB (same limit as artifact.file)", async () => {
    await expect(
      materializeWorkflowArtifactFile({
        runId: "dwfrun-1",
        artifactId: "big",
        version: 1,
        fileName: "big.bin",
        bytes: new Uint8Array(WORKFLOW_ARTIFACT_FILE_MAX_BYTES + 1),
      }),
    ).rejects.toThrow(/too large/u);
  });

  it("形状不对的请求在碰磁盘之前就拒绝", async () => {
    const valid = {
      runId: "dwfrun-1",
      artifactId: "report",
      version: 1,
      fileName: "report.md",
      bytes: bytesOf("x"),
    };
    for (const bad of [
      { ...valid, version: 0 },
      { ...valid, version: 1.5 },
      { ...valid, runId: "" },
      { ...valid, artifactId: 3 },
      { ...valid, bytes: "not bytes" },
    ]) {
      await expect(materializeWorkflowArtifactFile(bad as unknown as typeof valid)).rejects.toThrow(
        /invalid/u,
      );
    }
    await expect(readdir(join(tempRoot, ".cf"))).rejects.toThrow();
  });
});
