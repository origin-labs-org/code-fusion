

import { describe, expect, it } from "vitest";
import type {
  ExecutionPort,
  ExecutionRequest,
  ExecutionResult,
  FileSystemPort,
  FileSystemSearchFilesRequest,
  FileSystemSearchTextEntry,
  FileSystemSearchTextRequest,
} from "@origin-ai/cf-contracts";
import {
  FACADE_DTS,
  InMemoryJournalStore,
  WORLD_READ_CAPS,
  type WorkflowReportSink,
} from "@origin-ai/cf-dynamic-workflow";
import { createWorkflowEscalationRegistry } from "../src/app/workflow-escalation-registry.js";
import { createAgentRuntimeWorkflowDriver } from "../src/app/workflow-driver.js";

const CWD = "/ws";

interface GitCall {
  argv: string[];
  cwd?: string;
  maxInlineBytes?: number;
}

interface GitReply {
  stdout?: string;
  
  bytes?: number;
  truncated?: boolean;
  exitCode?: number;
  status?: ExecutionResult["status"];
  stderr?: string;
}

function nul(...segments: string[]): string {
  return segments.map((segment) => `${segment}\u0000`).join("");
}

const PREFIX_AT_ROOT: GitReply = { stdout: "\n" };

function fakeExecutionPort(replies: GitReply[]): {
  port: ExecutionPort;
  calls: GitCall[];
} {
  const calls: GitCall[] = [];
  let at = 0;
  const port: ExecutionPort = {
    async run(request: ExecutionRequest): Promise<ExecutionResult> {
      if (request.command.mode !== "argv") {
        throw new Error(`world-read git 必须用 argv Mode，收到 ${request.command.mode}`);
      }
      expect(request.command.file).toBe("git");
      calls.push({
        argv: [...(request.command.args ?? [])],
        ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
        ...(request.outputLimit?.maxInlineBytes === undefined
          ? {}
          : { maxInlineBytes: request.outputLimit.maxInlineBytes }),
      });
      const reply = replies[at] ?? {};
      at += 1;
      const stdout = reply.stdout ?? "";
      return {
        status: reply.status ?? "completed",
        exitCode: reply.exitCode ?? 0,
        stdout: {
          text: stdout,
          bytes: reply.bytes ?? Buffer.byteLength(stdout, "utf8"),
          truncated: reply.truncated ?? false,
        },
        stderr: { text: reply.stderr ?? "", bytes: 0, truncated: false },
        durationMs: 0,
        timedOut: false,
        cancelled: false,
        startedAt: new Date(0),
        completedAt: new Date(0),
      };
    },
  };
  return { calls, port };
}

function fakeFileSystemPort(
  entries: FileSystemSearchTextEntry[],
  options: { truncated?: boolean; globFiles?: string[]; globTruncated?: boolean } = {},
): {
  port: FileSystemPort;
  requests: FileSystemSearchTextRequest[];
  readPaths: string[];
  globRequests: FileSystemSearchFilesRequest[];
} {
  const requests: FileSystemSearchTextRequest[] = [];
  const readPaths: string[] = [];
  const globRequests: FileSystemSearchFilesRequest[] = [];
  const unsupported = (name: string) => () => {
    throw new Error(`fakeFileSystemPort.${name} 不应被本用例触及`);
  };
  const port = {
    async searchFiles(request: FileSystemSearchFilesRequest) {
      globRequests.push(request);
      const all = options.globFiles ?? [];
      const files =
        request.maxResults === undefined ? [...all] : all.slice(0, request.maxResults);
      return {
        path: request.path,
        pattern: request.pattern,
        durationMs: 0,
        files,
        numFiles: files.length,
        truncated: options.globTruncated ?? files.length < all.length,
      };
    },
    async searchText(request: FileSystemSearchTextRequest) {
      requests.push(request);
      const limited =
        request.headLimit === undefined ? entries : entries.slice(0, request.headLimit);
      return {
        path: request.path,
        pattern: request.pattern,
        mode: "content" as const,
        durationMs: 0,
        files: [...new Set(limited.map((e) => e.path))],
        entries: limited,
        numMatches: limited.length,
        truncated: options.truncated ?? entries.length > (request.headLimit ?? Infinity),
      };
    },
    async readTextFile(request: { path: string }) {
      readPaths.push(request.path);
      return {
        path: request.path,
        content: "body",
        encoding: "utf-8",
        bytesRead: 4,
        sizeBytes: 4,
        truncated: false,
      };
    },
    createDirectory: unsupported("createDirectory"),
    stat: unsupported("stat"),
    readBinaryFile: unsupported("readBinaryFile"),
    readTextFileRange: unsupported("readTextFileRange"),
    writeTextFile: unsupported("writeTextFile"),
    removeFile: unsupported("removeFile"),
    listDirectory: unsupported("listDirectory"),
  } as unknown as FileSystemPort;
  return { port, readPaths, requests, globRequests };
}

function noopSink(): WorkflowReportSink {
  const unexpected = (name: string) => (): never => {
    throw new Error(`noopSink.${name} 不应被触及`);
  };
  return {
    askSubmitAttempted: unexpected("askSubmitAttempted"),
    askTurnEnded: unexpected("askTurnEnded"),
    askProgress: unexpected("askProgress"),
    askStats: unexpected("askStats"),
    askFailed: unexpected("askFailed"),
  };
}

function makeDriver(input: {
  git?: GitReply[];
  grep?: FileSystemSearchTextEntry[];
  grepTruncated?: boolean;
  glob?: string[];
  globTruncated?: boolean;
}) {
  const exec = fakeExecutionPort(input.git ?? []);
  const fs = fakeFileSystemPort(input.grep ?? [], {
    ...(input.grepTruncated === undefined ? {} : { truncated: input.grepTruncated }),
    ...(input.glob === undefined ? {} : { globFiles: input.glob }),
    ...(input.globTruncated === undefined ? {} : { globTruncated: input.globTruncated }),
  });
  const driver = createAgentRuntimeWorkflowDriver({
    cwd: CWD,
    emit: () => undefined,
    escalationRegistry: createWorkflowEscalationRegistry(),
    executionPort: exec.port,
    fileSystemPort: fs.port,
    journal: new InMemoryJournalStore(),
    runId: "run",
    runtimeFactory: () => {
      throw new Error("世界读取不该创建 actor runtime");
    },
  })(noopSink());
  return {
    driver,
    gitCalls: exec.calls,
    grepRequests: fs.requests,
    readPaths: fs.readPaths,
    globRequests: fs.globRequests,
  };
}

// ————————————————————————————————————————————————————————————————
// ————————————————————————————————————————————————————————————————

describe("git world reads — exact argv", () => {
  it("changedFiles with no base unions tracked changes with untracked files", async () => {
    const { driver, gitCalls } = makeDriver({
      git: [PREFIX_AT_ROOT, { stdout: nul("b.ts", "a.ts") }, { stdout: nul("c.ts", "a.ts") }],
    });
    await expect(driver.executeWorldRead("git-changed-files", [])).resolves.toEqual([
      "a.ts",
      "b.ts",
      "c.ts",
    ]);
    expect(gitCalls.map((c) => c.argv)).toEqual([
      ["rev-parse", "--show-prefix"],
      ["diff", "--name-only", "-z", "HEAD", "--", "."],
      ["ls-files", "--others", "--exclude-standard", "-z", "--full-name", "--", "."],
    ]);
    expect(gitCalls.every((c) => c.cwd === CWD)).toBe(true);
  });

  it("changedFiles with a base asks only about tracked history", async () => {
    const { driver, gitCalls } = makeDriver({
      git: [PREFIX_AT_ROOT, { stdout: nul("src/a.ts") }],
    });
    await expect(driver.executeWorldRead("git-changed-files", ["main"])).resolves.toEqual([
      "src/a.ts",
    ]);
    expect(gitCalls.map((c) => c.argv)).toEqual([
      ["rev-parse", "--show-prefix"],
      ["diff", "--name-only", "-z", "main", "--", "."],
    ]);
  });

  it("diff defaults base to HEAD and pathspec to the workspace, always after --", async () => {
    const noPath = makeDriver({ git: [{ stdout: "@@ -1 +1 @@\n" }] });
    await expect(noPath.driver.executeWorldRead("git-diff", [])).resolves.toContain("@@");
    expect(noPath.gitCalls[0]?.argv).toEqual(["diff", "--relative", "HEAD", "--", "."]);

    const withPath = makeDriver({ git: [{ stdout: "diff" }] });
    await withPath.driver.executeWorldRead("git-diff", ["main", "src/a.ts"]);
    expect(withPath.gitCalls[0]?.argv).toEqual([
      "diff",
      "--relative",
      "main",
      "--",
      "src/a.ts",
    ]);

    const pathOnly = makeDriver({ git: [{ stdout: "diff" }] });
    await pathOnly.driver.executeWorldRead("git-diff", [undefined, "src/a.ts"]);
    expect(pathOnly.gitCalls[0]?.argv).toEqual([
      "diff",
      "--relative",
      "HEAD",
      "--",
      "src/a.ts",
    ]);
  });

  it("does not need a prefix lookup for the patch diff (git --relative does that base)", async () => {
    const { driver, gitCalls } = makeDriver({ git: [{ stdout: "diff" }] });
    await driver.executeWorldRead("git-diff", []);
    expect(gitCalls).toHaveLength(1);
    expect(gitCalls[0]?.argv[0]).toBe("diff");
  });

  it("normalizes a windows-style relative path into a git pathspec", async () => {
    const { driver, gitCalls } = makeDriver({ git: [{ stdout: "diff" }] });
    await driver.executeWorldRead("git-diff", ["HEAD", "src\\app\\a.ts"]);
    expect(gitCalls[0]?.argv).toEqual(["diff", "--relative", "HEAD", "--", "src/app/a.ts"]);
  });

  it("status and log use their fixed argv", async () => {
    const status = makeDriver({
      git: [PREFIX_AT_ROOT, { stdout: nul("# branch.head main") }],
    });
    await status.driver.executeWorldRead("git-status", []);
    expect(status.gitCalls.map((c) => c.argv)).toEqual([
      ["rev-parse", "--show-prefix"],
      ["status", "--porcelain=v2", "-z", "--branch", "--", "."],
    ]);

    const dflt = makeDriver({ git: [{ stdout: "" }] });
    await dflt.driver.executeWorldRead("git-log", []);
    expect(dflt.gitCalls[0]?.argv).toEqual([
      "log",
      `-n${WORLD_READ_CAPS.gitLogDefaultCount}`,
      "--pretty=format:%H%x00%s%x00%an%x00%aI",
    ]);
    expect(dflt.gitCalls).toHaveLength(1);

    const five = makeDriver({ git: [{ stdout: "" }] });
    await five.driver.executeWorldRead("git-log", [5]);
    expect(five.gitCalls[0]?.argv).toEqual([
      "log",
      "-n5",
      "--pretty=format:%H%x00%s%x00%an%x00%aI",
    ]);
  });
});

// ————————————————————————————————————————————————————————————————
// ————————————————————————————————————————————————————————————————

describe("git world reads — workspace-relative paths", () => {
  it("strips the workspace prefix when the workspace is a repo subdirectory", async () => {
    const { driver } = makeDriver({
      git: [
        { stdout: "sub/nested/\n" },
        { stdout: nul("sub/nested/deep.ts", "sub/nested/other.ts") },
        { stdout: nul("sub/nested/untracked.ts") },
      ],
    });
    await expect(driver.executeWorldRead("git-changed-files", [])).resolves.toEqual([
      "deep.ts",
      "other.ts",
      "untracked.ts",
    ]);
  });

  it("strips the prefix in status buckets too", async () => {
    const { driver } = makeDriver({
      git: [
        { stdout: "sub/\n" },
        {
          stdout: nul(
            "# branch.head main",
            "1 M. N... 100644 100644 100644 aaa bbb sub/staged.ts",
            "? sub/new.ts",
          ),
        },
      ],
    });
    await expect(driver.executeWorldRead("git-status", [])).resolves.toEqual({
      branch: "main",
      clean: false,
      staged: ["staged.ts"],
      unstaged: [],
      untracked: ["new.ts"],
    });
  });

  it("fails loudly if git reports a path outside the workspace prefix", async () => {
    const { driver } = makeDriver({
      git: [{ stdout: "sub/\n" }, { stdout: nul("outside/elsewhere.ts") }],
    });
    await expect(driver.executeWorldRead("git-changed-files", ["main"])).rejects.toMatchObject({
      code: "DriverError",
    });
  });

  it("is identity at the repo root (the common case pays nothing)", async () => {
    const { driver } = makeDriver({
      git: [PREFIX_AT_ROOT, { stdout: nul("a.ts", "sub/b.ts") }],
    });
    await expect(driver.executeWorldRead("git-changed-files", ["main"])).resolves.toEqual([
      "a.ts",
      "sub/b.ts",
    ]);
  });
});

// ————————————————————————————————————————————————————————————————
// ————————————————————————————————————————————————————————————————

describe("git status — porcelain v2 -z parsing", () => {
  
  function statusDriver(...segments: string[]) {
    return makeDriver({ git: [PREFIX_AT_ROOT, { stdout: nul(...segments) }] });
  }

  it("reports a clean tree with its branch", async () => {
    const { driver } = statusDriver(
      "# branch.oid 1111111111111111111111111111111111111111",
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab +0 -0",
    );
    await expect(driver.executeWorldRead("git-status", [])).resolves.toEqual({
      branch: "main",
      clean: true,
      staged: [],
      unstaged: [],
      untracked: [],
    });
  });

  it("splits staged / unstaged / untracked, and reports a file in both when it is", async () => {
    const { driver } = statusDriver(
      "# branch.head feature/x",
      "1 M. N... 100644 100644 100644 aaa bbb staged-only.ts",
      "1 .M N... 100644 100644 100644 aaa bbb worktree only.ts",
      "1 MM N... 100644 100644 100644 aaa bbb both.ts",
      "? untracked one.ts",
      "? another.ts",
    );
    await expect(driver.executeWorldRead("git-status", [])).resolves.toEqual({
      branch: "feature/x",
      clean: false,
      staged: ["both.ts", "staged-only.ts"],
      unstaged: ["both.ts", "worktree only.ts"],
      untracked: ["another.ts", "untracked one.ts"],
    });
  });

  it("consumes a rename entry's second segment instead of misreading it as a record", async () => {
    const { driver } = statusDriver(
      "# branch.head main",
      "2 R. N... 100644 100644 100644 aaa bbb R100 new/name.ts",
      "old/name.ts",
      "1 .M N... 100644 100644 100644 aaa bbb after-rename.ts",
    );
    await expect(driver.executeWorldRead("git-status", [])).resolves.toEqual({
      branch: "main",
      clean: false,
      staged: ["new/name.ts"],
      unstaged: ["after-rename.ts"],
      untracked: [],
    });
  });

  it("carries a non-ASCII filename through verbatim", async () => {
    const { driver } = statusDriver(
      "# branch.head main",
      "1 .M N... 100644 100644 100644 aaa bbb 文档 中文.md",
      "? 未跟踪.txt",
    );
    await expect(driver.executeWorldRead("git-status", [])).resolves.toMatchObject({
      unstaged: ["文档 中文.md"],
      untracked: ["未跟踪.txt"],
    });
  });

  it("carries a newline-containing filename through intact", async () => {
    const { driver } = statusDriver("# branch.head main", "? has\nnewline.txt");
    await expect(driver.executeWorldRead("git-status", [])).resolves.toMatchObject({
      untracked: ["has\nnewline.txt"],
    });
  });

  it("omits branch entirely on a detached HEAD", async () => {
    const { driver } = statusDriver("# branch.oid abc", "# branch.head (detached)");
    const status = (await driver.executeWorldRead("git-status", [])) as Record<string, unknown>;
    expect(status.branch).toBeUndefined();
    expect("branch" in status).toBe(false);
    expect(status.clean).toBe(true);
  });

  it("counts an unmerged entry as unstaged work", async () => {
    const { driver } = statusDriver(
      "# branch.head main",
      "u UU N... 100644 100644 100644 100644 aaa bbb ccc conflicted.ts",
    );
    await expect(driver.executeWorldRead("git-status", [])).resolves.toMatchObject({
      clean: false,
      staged: [],
      unstaged: ["conflicted.ts"],
    });
  });
});

describe("git path lists — -z parsing", () => {
  it("carries non-ASCII and newline-containing filenames through changedFiles", async () => {
    const { driver } = makeDriver({
      git: [
        PREFIX_AT_ROOT,
        { stdout: nul("文档 中文.md", "src/a.ts") },
        { stdout: nul("未跟踪.txt", "has\nnewline.txt") },
      ],
    });
    await expect(driver.executeWorldRead("git-changed-files", [])).resolves.toEqual([
      "has\nnewline.txt",
      "src/a.ts",
      "文档 中文.md",
      "未跟踪.txt",
    ]);
  });

  it("tolerates the trailing NUL terminator without emitting an empty path", async () => {
    const { driver } = makeDriver({
      git: [PREFIX_AT_ROOT, { stdout: nul("a.ts") }],
    });
    await expect(driver.executeWorldRead("git-changed-files", ["main"])).resolves.toEqual(["a.ts"]);
  });

  it("returns an empty list for an empty -z output", async () => {
    const { driver } = makeDriver({ git: [PREFIX_AT_ROOT, { stdout: "" }] });
    await expect(driver.executeWorldRead("git-changed-files", ["main"])).resolves.toEqual([]);
  });
});

describe("git log — NUL field parsing", () => {
  it("parses NUL-separated records into commits, newest first", async () => {
    const { driver } = makeDriver({
      git: [
        {
          stdout:
            "aaa\u0000feat: add thing\u0000Ada\u00002026-08-20T10:00:00+08:00\n" +
            "bbb\u0000fix: a | pipe, a: colon and  spaces\u0000Bob Builder\u00002026-08-19T09:00:00+08:00",
        },
      ],
    });
    await expect(driver.executeWorldRead("git-log", [2])).resolves.toEqual([
      { hash: "aaa", subject: "feat: add thing", author: "Ada", date: "2026-08-20T10:00:00+08:00" },
      {
        hash: "bbb",
        subject: "fix: a | pipe, a: colon and  spaces",
        author: "Bob Builder",
        date: "2026-08-19T09:00:00+08:00",
      },
    ]);
  });

  it("returns an empty list for an empty log", async () => {
    const { driver } = makeDriver({ git: [{ stdout: "" }] });
    await expect(driver.executeWorldRead("git-log", [])).resolves.toEqual([]);
  });

  it("fails loudly on a record whose field count is wrong", async () => {
    const { driver } = makeDriver({ git: [{ stdout: "aaa\u0000only-two" }] });
    await expect(driver.executeWorldRead("git-log", [])).rejects.toMatchObject({
      code: "DriverError",
    });
  });
});

// ————————————————————————————————————————————————————————————————
// ————————————————————————————————————————————————————————————————

describe("git world reads — argument validation", () => {
  const rejects = async (op: "git-diff" | "git-changed-files" | "git-log", args: unknown[]) => {
    const { driver, gitCalls } = makeDriver({ git: [PREFIX_AT_ROOT, { stdout: "" }] });
    await expect(driver.executeWorldRead(op, args)).rejects.toMatchObject({
      code: "DriverError",
    });
    expect(gitCalls).toEqual([]);
  };

  it("rejects a base that would be read as an option", async () => {
    await rejects("git-diff", ["-foo"]);
    await rejects("git-changed-files", ["--cached"]);
  });

  it("rejects a range base (v1 accepts a single ref only)", async () => {
    await rejects("git-diff", ["main..HEAD"]);
    await rejects("git-diff", ["main...HEAD"]);
    await rejects("git-changed-files", ["a..b"]);
  });

  it("rejects whitespace and reflog/rev syntax in a base", async () => {
    await rejects("git-diff", ["main HEAD"]);
    await rejects("git-diff", ["main\tx"]);
    await rejects("git-diff", ["HEAD@{1}"]);
    await rejects("git-diff", ["HEAD:src/a.ts"]);
    await rejects("git-diff", [""]);
  });

  it("accepts the single-ref forms a script actually writes", async () => {
    for (const base of ["HEAD", "HEAD~3", "HEAD^", "main", "origin/main", "v1.2.3", "abc123"]) {
      const { driver, gitCalls } = makeDriver({ git: [{ stdout: "" }] });
      await driver.executeWorldRead("git-diff", [base]);
      expect(gitCalls[0]?.argv).toEqual(["diff", "--relative", base, "--", "."]);
    }
  });

  it("accepts a legitimate nested path", async () => {
    const { driver, gitCalls } = makeDriver({ git: [{ stdout: "" }] });
    await driver.executeWorldRead("git-diff", ["HEAD", "sub/nested/deep.ts"]);
    expect(gitCalls[0]?.argv).toEqual([
      "diff",
      "--relative",
      "HEAD",
      "--",
      "sub/nested/deep.ts",
    ]);
  });

  it("rejects an absolute or escaping path", async () => {
    await rejects("git-diff", ["HEAD", "/etc/passwd"]);
    await rejects("git-diff", ["HEAD", "C:\\Windows\\x"]);
    await rejects("git-diff", ["HEAD", "\\\\server\\share"]);
    await rejects("git-diff", ["HEAD", "../outside/a.ts"]);
    await rejects("git-diff", ["HEAD", "src/../../a.ts"]);
    await rejects("git-diff", ["HEAD", "-foo"]);
    await rejects("git-diff", ["HEAD", ""]);
  });

  it("rejects a log count above the cap rather than silently clamping it", async () => {
    await rejects("git-log", [WORLD_READ_CAPS.gitLogMaxCount + 1]);
    await rejects("git-log", [1000]);
    await rejects("git-log", [0]);
    await rejects("git-log", [-1]);
    await rejects("git-log", [2.5]);
    await rejects("git-log", ["5"]);
    await rejects("git-log", [5, 6]);
  });

  it("accepts a log count exactly at the cap", async () => {
    const { driver, gitCalls } = makeDriver({ git: [{ stdout: "" }] });
    await driver.executeWorldRead("git-log", [WORLD_READ_CAPS.gitLogMaxCount]);
    expect(gitCalls[0]?.argv[1]).toBe(`-n${WORLD_READ_CAPS.gitLogMaxCount}`);
  });

  it("rejects extra arguments on a no-argument op", async () => {
    const { driver, gitCalls } = makeDriver({ git: [{ stdout: "" }] });
    await expect(driver.executeWorldRead("git-status", ["extra"])).rejects.toMatchObject({
      code: "DriverError",
    });
    await expect(driver.executeWorldRead("git-diff", ["a", "b", "c"])).rejects.toMatchObject({
      code: "DriverError",
    });
    expect(gitCalls).toEqual([]);
  });
});

// ————————————————————————————————————————————————————————————————
// ————————————————————————————————————————————————————————————————

describe("git world reads — failure and caps", () => {
  it("turns a non-repository / missing-binary failure into a catchable DriverError", async () => {
    const failed: GitReply = {
      exitCode: 128,
      status: "failed",
      stderr: "fatal: not a git repository\n",
    };
    const { driver } = makeDriver({ git: [failed, failed] });
    await expect(driver.executeWorldRead("git-status", [])).rejects.toMatchObject({
      code: "DriverError",
    });
    await expect(driver.executeWorldRead("git-status", [])).rejects.toThrow(/not a git repository/);
  });

  it("treats a spawn error as a DriverError too", async () => {
    const { driver } = makeDriver({
      git: [{ status: "spawn_error", stderr: "spawn git ENOENT" }],
    });
    await expect(driver.executeWorldRead("git-log", [])).rejects.toMatchObject({
      code: "DriverError",
    });
  });

  it("rejects an over-cap diff with WorldReadCapExceeded and actionable guidance", async () => {
    const cap = WORLD_READ_CAPS.gitDiffMaxBytes;
    const overflowing: GitReply = { stdout: "x".repeat(64), bytes: cap + 1, truncated: true };
    const { driver, gitCalls } = makeDriver({ git: [overflowing, overflowing] });
    await expect(driver.executeWorldRead("git-diff", [])).rejects.toMatchObject({
      code: "WorldReadCapExceeded",
    });
    await expect(driver.executeWorldRead("git-diff", [])).rejects.toThrow(/path/);
    expect(gitCalls[0]?.maxInlineBytes).toBe(cap + 1);
  });

  it("passes a diff exactly at the cap through", async () => {
    const cap = WORLD_READ_CAPS.gitDiffMaxBytes;
    const { driver } = makeDriver({ git: [{ stdout: "ok", bytes: cap, truncated: false }] });
    await expect(driver.executeWorldRead("git-diff", [])).resolves.toBe("ok");
  });
});

// ————————————————————————————————————————————————————————————————
// files.glob
// ————————————————————————————————————————————————————————————————

describe("files.glob world read", () => {
  it("maps the port's mtime-ordered absolute paths to lexicographic workspace-relative", async () => {
    const { driver, globRequests } = makeDriver({
      glob: ["/ws/src/z.ts", "/ws/a.ts", "src/m.ts"],
    });
    await expect(driver.executeWorldRead("glob", ["**/*.ts"])).resolves.toEqual([
      "a.ts",
      "src/m.ts",
      "src/z.ts",
    ]);
    expect(globRequests[0]).toMatchObject({
      path: CWD,
      pattern: "**/*.ts",
      maxResults: WORLD_READ_CAPS.globMaxFiles + 1,
    });
  });

  it("rejects over-cap file counts with actionable guidance, never a truncated view", async () => {
    const cap = WORLD_READ_CAPS.globMaxFiles;
    const tooMany = Array.from({ length: cap + 1 }, (_, i) => `/ws/f${i}.ts`);
    const { driver } = makeDriver({ glob: tooMany });
    await expect(driver.executeWorldRead("glob", ["**/*"])).rejects.toMatchObject({
      code: "WorldReadCapExceeded",
    });
    await expect(driver.executeWorldRead("glob", ["**/*"])).rejects.toThrow(/pattern/);
  });

  it("passes a file count exactly at the cap through", async () => {
    const cap = WORLD_READ_CAPS.globMaxFiles;
    const exact = Array.from({ length: cap }, (_, i) => `/ws/f${i}.ts`);
    const { driver } = makeDriver({ glob: exact });
    const files = (await driver.executeWorldRead("glob", ["**/*"])) as string[];
    expect(files).toHaveLength(cap);
  });

  it("rejects when the port reports truncation even under the count cap", async () => {
    const { driver } = makeDriver({ glob: ["/ws/a.ts"], globTruncated: true });
    await expect(driver.executeWorldRead("glob", ["*.ts"])).rejects.toMatchObject({
      code: "WorldReadCapExceeded",
    });
  });
});

// ————————————————————————————————————————————————————————————————
// files.grep
// ————————————————————————————————————————————————————————————————

describe("files.grep world read", () => {
  it("maps port entries to workspace-relative {path, line, text}", async () => {
    const { driver, grepRequests } = makeDriver({
      grep: [
        { path: "/ws/src/a.ts", lineNumber: 12, text: "// TODO: fix" },
        { path: "src/b.ts", lineNumber: 3, text: "// TODO: later" },
        { path: "/ws/src/c.ts", count: 4 },
      ],
    });
    await expect(driver.executeWorldRead("grep", ["TODO", "*.ts"])).resolves.toEqual([
      { path: "src/a.ts", line: 12, text: "// TODO: fix" },
      { path: "src/b.ts", line: 3, text: "// TODO: later" },
    ]);
    expect(grepRequests[0]).toMatchObject({
      path: CWD,
      pattern: "TODO",
      glob: "*.ts",
      outputMode: "content",
      showLineNumbers: true,
      headLimit: WORLD_READ_CAPS.grepMaxMatches + 1,
    });
  });

  it("omits glob entirely when the script did not pass one", async () => {
    const { driver, grepRequests } = makeDriver({ grep: [] });
    await expect(driver.executeWorldRead("grep", ["TODO"])).resolves.toEqual([]);
    expect("glob" in grepRequests[0]!).toBe(false);
    const explicit = makeDriver({ grep: [] });
    await explicit.driver.executeWorldRead("grep", ["TODO", undefined]);
    expect("glob" in explicit.grepRequests[0]!).toBe(false);
  });

  it("rejects over-cap match counts with actionable guidance, never a truncated view", async () => {
    const cap = WORLD_READ_CAPS.grepMaxMatches;
    const tooMany = Array.from({ length: cap + 1 }, (_, i) => ({
      path: `/ws/f${i}.ts`,
      lineNumber: 1,
      text: "hit",
    }));
    const { driver } = makeDriver({ grep: tooMany });
    await expect(driver.executeWorldRead("grep", ["."])).rejects.toMatchObject({
      code: "WorldReadCapExceeded",
    });
    await expect(driver.executeWorldRead("grep", ["."])).rejects.toThrow(/glob/);
  });

  it("passes a match count exactly at the cap through", async () => {
    const cap = WORLD_READ_CAPS.grepMaxMatches;
    const exact = Array.from({ length: cap }, (_, i) => ({
      path: `f${i}.ts`,
      lineNumber: 1,
      text: "h",
    }));
    const { driver } = makeDriver({ grep: exact });
    const matches = (await driver.executeWorldRead("grep", ["."])) as unknown[];
    expect(matches).toHaveLength(cap);
  });

  it("rejects when the port reports truncation even under the count cap", async () => {
    const { driver } = makeDriver({
      grep: [{ path: "a.ts", lineNumber: 1, text: "h" }],
      grepTruncated: true,
    });
    await expect(driver.executeWorldRead("grep", ["."])).rejects.toMatchObject({
      code: "WorldReadCapExceeded",
    });
  });

  it("rejects an over-cap serialized size even when the match count is fine", async () => {
    const bigLine = "x".repeat(WORLD_READ_CAPS.grepMaxSerializedBytes);
    const { driver } = makeDriver({
      grep: [{ path: "bundle.js", lineNumber: 1, text: bigLine }],
    });
    await expect(driver.executeWorldRead("grep", ["x"])).rejects.toMatchObject({
      code: "WorldReadCapExceeded",
    });
  });

  it("rejects malformed grep arity", async () => {
    const { driver } = makeDriver({ grep: [] });
    await expect(driver.executeWorldRead("grep", [])).rejects.toMatchObject({
      code: "DriverError",
    });
    await expect(driver.executeWorldRead("grep", [42])).rejects.toMatchObject({
      code: "DriverError",
    });
    await expect(driver.executeWorldRead("grep", ["a", 42])).rejects.toMatchObject({
      code: "DriverError",
    });
    await expect(driver.executeWorldRead("grep", ["a", "b", "c"])).rejects.toMatchObject({
      code: "DriverError",
    });
  });
});

// ————————————————————————————————————————————————————————————————
// ————————————————————————————————————————————————————————————————

describe("facade / driver shape agreement", () => {
  it("returns exactly the fields the facade declares", () => {
    for (const declaration of [
      "declare interface GrepMatch",
      "declare interface GitStatus",
      "declare interface GitCommit",
      "declare const git",
      "glob(pattern: string): Promise<string[]>",
      "grep(pattern: string, glob?: string)",
      "changedFiles(base?: string)",
      "diff(base?: string, path?: string)",
      "status(): Promise<GitStatus>",
      "log(count?: number): Promise<GitCommit[]>",
    ]) {
      expect(FACADE_DTS).toContain(declaration);
    }
  });
});

// ————————————————————————————————————————————————————————————————
// ————————————————————————————————————————————————————————————————

describe("files.read — workspace containment", () => {
  it("resolves a legitimate nested path against the workspace", async () => {
    const { driver, readPaths } = makeDriver({});
    await expect(driver.executeWorldRead("read", ["sub/nested/a.ts"])).resolves.toBe("body");
    expect(readPaths).toEqual([`${CWD}/sub/nested/a.ts`]);
  });

  it("rejects a path that escapes the workspace with ..", async () => {
    const { driver, readPaths } = makeDriver({});
    for (const escape of ["../outside.ts", "sub/../../outside.ts", "../../etc/passwd"]) {
      await expect(driver.executeWorldRead("read", [escape])).rejects.toMatchObject({
        code: "DriverError",
      });
    }
    expect(readPaths).toEqual([]);
  });

  it("rejects an absolute path outside the workspace", async () => {
    const { driver, readPaths } = makeDriver({});
    await expect(driver.executeWorldRead("read", ["/etc/passwd"])).rejects.toMatchObject({
      code: "DriverError",
    });
    expect(readPaths).toEqual([]);
  });

  it("accepts a path that normalizes back inside the workspace", async () => {
    const { driver } = makeDriver({});
    await expect(driver.executeWorldRead("read", ["sub/../a.ts"])).resolves.toBe("body");
  });
});
