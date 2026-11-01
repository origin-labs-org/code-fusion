import { spawnSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { brotliCompressSync, gzipSync, zstdCompressSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZipFile } from "yazl";
import { NodeExecutionAdapter, resolveEffectiveBashShellSelection } from "@origin-ai/cf-adapters/exec";
import {
  createSessionId,
  createTraceId,
  createTurnId,
  type BashOutput,
  type EmbeddedSearchBackend,
  windowsPathToGitBashPath,
} from "@origin-ai/cf-contracts";
import { builtInTools, type ToolExecutionContext } from "@origin-ai/cf-core";
import { resolveDefaultEmbeddedSearchBackend } from "../src/app/embedded-search-backend.js";

const bfsPath = process.env.CF_BFS_BINARY;
const rgPath = process.env.CF_RG_BINARY;
const ugrepPath = process.env.CF_UGREP_BINARY;
const windowsShellResolution =
  process.platform === "win32"
    ? resolveEffectiveBashShellSelection({ env: process.env, platform: "win32" })
    : undefined;
const windowsGitBashPath =
  windowsShellResolution?.selection.dialect === "git-bash"
    ? windowsShellResolution.selection.path
    : undefined;
const nativeE2eEnabled = Boolean(
  rgPath && ugrepPath && (process.platform === "win32" ? windowsGitBashPath : bfsPath),
);
const outputSectionPattern = /^__CF_[A-Z0-9_]+__$/u;

if (process.env.CF_REQUIRE_NATIVE_SEARCH_E2E === "1" && !nativeE2eEnabled) {
  throw new Error(
    "native embedded search E2E prerequisites are missing (bfs on Unix, ugrep, rg, or Windows Git Bash)",
  );
}

describe.skipIf(!nativeE2eEnabled)("native embedded search E2E", () => {
  let adapter: NodeExecutionAdapter;
  let backend: EmbeddedSearchBackend;
  let fixtureRoot: string;
  let systemRgAdapter: NodeExecutionAdapter;

  beforeAll(async () => {
    fixtureRoot = await mkdtemp(join(tmpdir(), "cf-native-embedded-search-"));
    const home = join(fixtureRoot, "home");
    const isolatedBin = join(fixtureRoot, "isolated-bin");
    const systemBin = join(fixtureRoot, "system-bin");
    await mkdir(home, { recursive: true });
    await mkdir(join(fixtureRoot, "src", "deep"), { recursive: true });
    await mkdir(join(fixtureRoot, "ignored"), { recursive: true });
    await mkdir(join(fixtureRoot, ".git"), { recursive: true });
    await mkdir(join(fixtureRoot, "binary"), { recursive: true });
    await mkdir(join(fixtureRoot, "compressed"), { recursive: true });
    await mkdir(isolatedBin, { recursive: true });
    await mkdir(systemBin, { recursive: true });

    await writeFile(join(fixtureRoot, "src", "alpha.ts"), "before\nneedle alpha\nafter\n");
    await writeFile(join(fixtureRoot, "src", "deep", "beta.ts"), "needle beta\n");
    await writeFile(join(fixtureRoot, ".hidden.ts"), "needle hidden\n");
    await writeFile(join(fixtureRoot, "ignored", "skip.ts"), "needle ignored\n");
    await writeFile(join(fixtureRoot, ".git", "config"), "needle vcs\n");
    await writeFile(join(fixtureRoot, ".gitignore"), "ignored/\n");
    await writeFile(join(fixtureRoot, "binary", "data.ts"), Buffer.from("needle\0binary\n"));
    await writeFile(join(fixtureRoot, "many.txt"), "needle\n".repeat(100_000));
    await writeCompressedFixtures(join(fixtureRoot, "compressed"));

    const systemGrepPath = join(isolatedBin, "grep");
    await writeFile(systemGrepPath, "#!/bin/sh\nprintf 'system-grep-bypass:%s\\n' \"$*\"\n");
    await chmod(systemGrepPath, 0o755);

    const systemRgPath = join(systemBin, "rg");
    await writeFile(systemRgPath, "#!/bin/sh\nprintf 'system-rg\\n'\n");
    await chmod(systemRgPath, 0o755);

    backend = resolveDefaultEmbeddedSearchBackend({
      env: {
        ...(bfsPath ? { CF_BFS_BINARY: bfsPath } : {}),
        CF_RG_BINARY: rgPath!,
        CF_UGREP_BINARY: ugrepPath!,
      },
    });
    const shellPath = nativeShellPathEntries();
    const bundledShellPath = process.platform === "win32" ? shellPath : [];
    adapter = createAdapter([isolatedBin, ...bundledShellPath].join(delimiter), "bundled", home);
    systemRgAdapter = createAdapter([systemBin, ...shellPath].join(delimiter), "system-rg", home);
  });

  afterAll(async () => {
    await Promise.all([adapter?.close(), systemRgAdapter?.close()]);
    if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
  });

  it("covers the complete platform native search contract through one Bash toolcall", async () => {
    const isolatedBinShellPath =
      process.platform === "win32"
        ? windowsPathToGitBashPath(join(fixtureRoot, "isolated-bin"))
        : join(fixtureRoot, "isolated-bin");
    expect(backend).toEqual({
      kind: "native-binaries",
      findCommand: bfsPath ?? "bfs",
      grepCommand: ugrepPath,
      rgCommand: rgPath,
    });

    const result = await runBashToolCall(
      [
        "printf '%s\\n' __CF_VERSIONS__",
        "find --version",
        "grep --version",
        "rg --version",
        "printf '%s\\n' __CF_BFS_NAME__",
        "find . -maxdepth 3 -type f -name '*.ts' | /usr/bin/sort",
        "printf '%s\\n' __CF_BFS_REGEX__",
        "find . -type f -regex '.*\\(alpha\\|beta\\)\\.ts' | /usr/bin/sort",
        "printf '%s\\n' __CF_UGREP_RECURSIVE__",
        "grep -Rni --include='*.ts' needle . | /usr/bin/sort",
        "printf '%s\\n' __CF_UGREP_STDIN__",
        "printf 'before\\nneedle from stdin\\nafter\\n' | grep needle",
        "printf '%s\\n' __CF_UGREP_MATCHERS__",
        "grep -E 'needle (alpha|beta)' src/alpha.ts",
        "grep -F 'needle alpha' src/alpha.ts",
        "grep -P '(?<=needle )alpha' src/alpha.ts",
        "printf '%s\\n' __CF_UGREP_BYPASS__",
        `(export PATH=${quoteShellValue(isolatedBinShellPath)}:"$PATH"; for _arg in --file-filter=stub --pager=stub --view=stub --format-open=stub --config=stub ---stub -@stub --save-config=stub -z -Z -Rz -nZ --null --null-data; do grep "$_arg"; done)`,
        "printf '%s\\n' __CF_UGREP_COMPRESSED__",
        "for _file in compressed/sample.txt.gz compressed/sample.txt.bz2 compressed/sample.txt.zst compressed/sample.txt.br compressed/sample.zip compressed/sample.tar; do printf 'FILE:%s\\n' \"$_file\"; grep --decompress 'archive needle' \"$_file\"; done",
        "printf '%s\\n' __CF_UGREP_EARLY_CLOSE__",
        "grep needle many.txt | /usr/bin/head -n 5",
        "printf '%s\\n' __CF_UGREP_EXIT_CODES__",
        "grep absent src/alpha.ts >/dev/null; printf 'no-match=%s\\n' \"$?\"",
        "grep '[' src/alpha.ts >/dev/null 2>&1; printf 'invalid-regex=%s\\n' \"$?\"",
        "printf '%s\\n' __CF_RG_FILES__",
        "rg -n -g '*.ts' needle src | /usr/bin/sort",
        "printf '%s\\n' __CF_RG_HIDDEN__",
        "rg --hidden -Hn needle .hidden.ts",
        "printf '%s\\n' __CF_RG_STDIN__",
        "printf 'before\\nneedle from rg stdin\\nafter\\n' | rg needle",
        "printf '%s\\n' __CF_RG_MATCHERS__",
        "rg -F 'needle alpha' src/alpha.ts",
        "rg -P '(?<=needle )alpha' src/alpha.ts",
        "printf '%s\\n' __CF_RG_EARLY_CLOSE__",
        "rg needle many.txt | /usr/bin/head -n 5",
        "printf '%s\\n' __CF_RG_EXIT_CODES__",
        "rg absent src/alpha.ts >/dev/null; printf 'no-match=%s\\n' \"$?\"",
        "rg '[' src/alpha.ts >/dev/null 2>&1; printf 'invalid-regex=%s\\n' \"$?\"",
        "printf '%s\\n' __CF_DONE__",
        "printf 'ok\\n'",
      ].join("\n"),
    );

    expectToolCallExit(result, 0);
    expect(result.stderr).toBe("");

    const versions = outputSection(result.stdout, "VERSIONS");
    if (process.platform === "win32") {
      expect(versions).toContain("GNU findutils");
    } else {
      expect(versions).toContain("bfs 4.1.1");
      expect(versions).not.toContain("GNU findutils");
    }
    expect(versions).toContain("ugrep 7.8.4");
    expect(versions).toContain(process.platform === "darwin" ? "-P:pcre2" : "-P:pcre2jit");
    expect(versions).toContain("-z:zlib,bzip2,zstd,brotli,7z,tar/pax/cpio/zip");
    expect(versions).toContain("ripgrep 14.1.1");
    expect(versions).toContain("features:+pcre2");
    expect(versions).toContain("PCRE2 10.43 is available");

    expect(outputLines(outputSection(result.stdout, "BFS_NAME"))).toEqual([
      "./.hidden.ts",
      "./binary/data.ts",
      "./ignored/skip.ts",
      "./src/alpha.ts",
      "./src/deep/beta.ts",
    ]);
    expect(outputLines(outputSection(result.stdout, "BFS_REGEX"))).toEqual([
      "./src/alpha.ts",
      "./src/deep/beta.ts",
    ]);

    const recursive = normalizeNativeSearchResultPaths(
      outputSection(result.stdout, "UGREP_RECURSIVE"),
    );
    expect(recursive).toContain(".hidden.ts:1:needle hidden");
    expect(recursive).toContain("src/alpha.ts:2:needle alpha");
    expect(recursive).toContain("src/deep/beta.ts:1:needle beta");
    expect(recursive).not.toContain("ignored/skip.ts");
    expect(recursive).not.toContain(".git/config");
    expect(recursive).not.toContain("binary/data.ts");
    expect(outputSection(result.stdout, "UGREP_STDIN")).toBe("needle from stdin");
    expect(outputLines(outputSection(result.stdout, "UGREP_MATCHERS"))).toEqual([
      "needle alpha",
      "needle alpha",
      "needle alpha",
    ]);
    expect(outputLines(outputSection(result.stdout, "UGREP_BYPASS"))).toEqual([
      "system-grep-bypass:--file-filter=stub",
      "system-grep-bypass:--pager=stub",
      "system-grep-bypass:--view=stub",
      "system-grep-bypass:--format-open=stub",
      "system-grep-bypass:--config=stub",
      "system-grep-bypass:---stub",
      "system-grep-bypass:-@stub",
      "system-grep-bypass:--save-config=stub",
      "system-grep-bypass:-z",
      "system-grep-bypass:-Z",
      "system-grep-bypass:-Rz",
      "system-grep-bypass:-nZ",
      "system-grep-bypass:--null",
      "system-grep-bypass:--null-data",
    ]);

    const compressed = outputSection(result.stdout, "UGREP_COMPRESSED");
    for (const fileName of [
      "sample.txt.gz",
      "sample.txt.bz2",
      "sample.txt.zst",
      "sample.txt.br",
      "sample.zip",
      "sample.tar",
    ]) {
      expect(compressed).toContain(`FILE:compressed/${fileName}`);
    }
    expect(compressed.match(/archive needle/gu)).toHaveLength(6);
    expect(outputSection(result.stdout, "UGREP_EARLY_CLOSE")).toBe(
      "needle\nneedle\nneedle\nneedle\nneedle",
    );
    expect(outputLines(outputSection(result.stdout, "UGREP_EXIT_CODES"))).toEqual([
      "no-match=1",
      "invalid-regex=2",
    ]);

    expect(
      outputLines(normalizeNativeSearchResultPaths(outputSection(result.stdout, "RG_FILES"))),
    ).toEqual(["src/alpha.ts:2:needle alpha", "src/deep/beta.ts:1:needle beta"]);
    expect(outputSection(result.stdout, "RG_HIDDEN")).toBe(".hidden.ts:1:needle hidden");
    expect(outputSection(result.stdout, "RG_STDIN")).toBe("needle from rg stdin");
    expect(outputLines(outputSection(result.stdout, "RG_MATCHERS"))).toEqual([
      "needle alpha",
      "needle alpha",
    ]);
    expect(outputSection(result.stdout, "RG_EARLY_CLOSE")).toBe(
      "needle\nneedle\nneedle\nneedle\nneedle",
    );
    expect(outputLines(outputSection(result.stdout, "RG_EXIT_CODES"))).toEqual([
      "no-match=1",
      "invalid-regex=2",
    ]);
    expect(outputSection(result.stdout, "DONE")).toBe("ok");
  }, 30_000);

  it("keeps an existing executable rg instead of shadowing it", async () => {
    const result = await runBashToolCall("rg --version", backend, systemRgAdapter);
    expectToolCallExit(result, 0);
    expect(result.stdout).toBe("system-rg\n");
    expect(result.stderr).toBe("");
  });

  it("falls back to system find and grep when native binaries are unavailable", async () => {
    const missingBackend: EmbeddedSearchBackend = {
      kind: "native-binaries",
      findCommand: join(fixtureRoot, "missing-bfs"),
      grepCommand: join(fixtureRoot, "missing-ugrep"),
      rgCommand: join(fixtureRoot, "missing-rg"),
    };
    const result = await runBashToolCall(
      [
        "find src -type f -name '*.ts' | /usr/bin/sort",
        "printf '%s\\n' ---",
        "printf 'before\\nneedle fallback\\nafter\\n' | grep needle",
      ].join("\n"),
      missingBackend,
      systemRgAdapter,
    );

    expectToolCallExit(result, 0);
    expect(result.stdout).toBe("src/alpha.ts\nsrc/deep/beta.ts\n---\nneedle fallback\n");
    expect(result.stderr).toBe("");
  });

  it.each(["ugrep-direct", "ugrep-pipe", "system-grep-pipe"])(
    "isolates live output from recursive search (%s)",
    async (mode) => {
      const searchRoot = join(fixtureRoot, `self-search-${mode}`);
      const tempParent = join(fixtureRoot, `temporary-${mode}`);
      await mkdir(searchRoot);
      await mkdir(tempParent);
      await writeFile(join(searchRoot, "00-seed.txt"), "self_search_needle\n".repeat(200_000));
      const shellPath = (path: string) =>
        process.platform === "win32" ? windowsPathToGitBashPath(path) : path;
      const grep =
        mode === "system-grep-pipe"
          ? "command grep -rn -m200001 self_search_needle ."
          : "grep -J1 --sort=name -rn -m200001 self_search_needle .";
      const command = `cd ${quoteShellValue(shellPath(searchRoot))} && ${grep}${mode.endsWith("pipe") ? " | cut -c 1-4096" : ""}`;
      for (const useTmp of [false, true]) {
        const outputRoot = join(searchRoot, "zz-output");
        const execution = new NodeExecutionAdapter({
          outputRootDir: outputRoot,
          ...(useTmp ? { bashOutputTempDir: tempParent } : {}),
          processEnv: { ...process.env, PATH: nativeShellPathEntries().join(delimiter) },
        });
        const deadline = setTimeout(() => void execution.close(), 10_000);
        const controlPath = join(
          outputRoot,
          "native-search-e2e",
          "tool_native_search_e2e-stdout.log",
        );
        const sizeGuard = setInterval(() => {
          void stat(controlPath).then(
            (file) => {
              if (file.size >= 64 * 1024 * 1024) return execution.close();
            },
            () => undefined,
          );
        }, 25);
        try {
          const result = await runBashToolCall(command, backend, execution);
          expectToolCallExit(result, 0);
          const outputPath = result.persistedOutputPath!;
          expect(outputPath).toBeTruthy();
          expect((await stat(outputPath)).size).toBeLessThan(64 * 1024 * 1024);
          const text = await readFile(outputPath, "utf8");
          const nested = /stdout\.log:\d+:/u.test(text);
          if (useTmp) {
            expect(outputPath.startsWith(tempParent)).toBe(true);
            expect(nested).toBe(false);
            expect(text.match(/self_search_needle/g)).toHaveLength(200_000);
          } else if (
            mode === "ugrep-pipe" ||
            process.platform === "win32" ||
            (mode === "system-grep-pipe" && process.platform === "linux")
          ) {
            expect(nested).toBe(true);
          }
        } finally {
          clearTimeout(deadline);
          clearInterval(sizeGuard);
          await execution.close();
          await rm(outputRoot, { recursive: true, force: true });
        }
      }
    },
    30_000,
  );

  async function runBashToolCall(
    command: string,
    selectedBackend: EmbeddedSearchBackend = backend,
    selectedAdapter: NodeExecutionAdapter = adapter,
  ): Promise<BashOutput> {
    const bashTool = builtInTools.find((entry) => entry.metadata.name === "Bash");
    if (!bashTool) throw new Error("Bash tool entry is not registered");

    const context: ToolExecutionContext = {
      toolCallId: "tool_native_search_e2e",
      traceId: createTraceId(),
      abortSignal: new AbortController().signal,
      bashShellSelection: windowsShellResolution?.selection ?? {
        dialect: "posix",
        display: { name: "bash" },
        path: "/bin/bash",
        source: "auto-detected",
      },
      embeddedSearch: {
        backend: selectedBackend,
        enabled: true,
      },
      executionPort: selectedAdapter,
      runtimeScope: "main",
      workingDirectory: fixtureRoot,
      workspaceRoot: fixtureRoot,
      sessionId: createSessionId("native-search-e2e"),
      turnId: createTurnId("native-search-e2e"),
    };

    return (await bashTool.handler(
      {
        command,
        dangerouslyDisableSandbox: true,
        timeout: 30_000,
      },
      context,
    )) as BashOutput;
  }

  function createAdapter(path: string, id: string, home: string): NodeExecutionAdapter {
    return new NodeExecutionAdapter({
      outputRootDir: join(fixtureRoot, `exec-output-${id}`),
      processEnv: {
        ...process.env,
        HOME: home,
        PATH: path,
        SHELL: "/bin/bash",
      },
    });
  }

  function nativeShellPathEntries(): string[] {
    if (process.platform !== "win32" || !windowsGitBashPath) return ["/usr/bin", "/bin"];
    const gitRoot = dirname(dirname(windowsGitBashPath));
    const comSpec = process.env.ComSpec?.trim() || process.env.COMSPEC?.trim();
    return [
      dirname(windowsGitBashPath),
      join(gitRoot, "usr", "bin"),
      join(gitRoot, "mingw64", "bin"),
      ...(comSpec ? [dirname(comSpec)] : []),
    ];
  }
});

function quoteShellValue(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function writeCompressedFixtures(compressedDir: string): Promise<void> {
  const archiveText = Buffer.from("archive needle\n");
  const rawPath = join(compressedDir, "raw.txt");
  await writeFile(rawPath, archiveText);
  await writeFile(join(compressedDir, "sample.txt.gz"), gzipSync(archiveText));
  await writeFile(join(compressedDir, "sample.txt.zst"), zstdCompressSync(archiveText));
  await writeFile(join(compressedDir, "sample.txt.br"), brotliCompressSync(archiveText));

  const zip = new ZipFile();
  zip.addBuffer(archiveText, basename(rawPath));
  zip.end();
  await pipeline(zip.outputStream, createWriteStream(join(compressedDir, "sample.zip")));

  if (process.platform === "win32" && windowsGitBashPath) {
    const archiveFixtures = spawnSync(
      windowsGitBashPath,
      [
        "--noprofile",
        "--norc",
        "-c",
        "bzip2 -c raw.txt > sample.txt.bz2 && tar -cf sample.tar raw.txt",
      ],
      { cwd: compressedDir, encoding: "utf8" },
    );
    expectNativeFixtureCommand(archiveFixtures, "Git Bash archive fixture creation");
    return;
  }

  const bzip2 = spawnSync("bzip2", ["-c", rawPath], { encoding: null });
  expectNativeFixtureCommand(bzip2, "bzip2 fixture creation");
  await writeFile(join(compressedDir, "sample.txt.bz2"), bzip2.stdout);

  const tar = spawnSync("tar", ["-cf", "sample.tar", basename(rawPath)], {
    cwd: compressedDir,
    encoding: "utf8",
  });
  expectNativeFixtureCommand(tar, "tar fixture creation");
}

function expectNativeFixtureCommand(result: ReturnType<typeof spawnSync>, label: string): void {
  if (result.error) throw result.error;
  if (result.status === 0) return;
  throw new Error(
    `${label} exited with ${result.status}\nstdout:\n${String(result.stdout ?? "")}\nstderr:\n${String(result.stderr ?? "")}`,
  );
}

function outputSection(output: string, name: string): string {
  const lines = output.trimEnd().split("\n");
  const marker = `__CF_${name}__`;
  const start = lines.indexOf(marker);
  if (start < 0) throw new Error(`missing output marker: ${marker}\n${output}`);
  const next = lines.findIndex((line, index) => index > start && outputSectionPattern.test(line));
  return lines
    .slice(start + 1, next < 0 ? lines.length : next)
    .join("\n")
    .trimEnd();
}

function outputLines(output: string): string[] {
  return output.split("\n").filter((line) => line.length > 0);
}

function normalizeNativeSearchResultPaths(output: string): string {
  return process.platform === "win32" ? output.replaceAll("\\", "/") : output;
}

function expectToolCallExit(result: BashOutput, exitCode: number): void {
  const diagnostic = [
    `status: ${result.status}`,
    `exitCode: ${String(result.exitCode)}`,
    `signal: ${String(result.signal)}`,
    `timedOut: ${String(result.timedOut)}`,
    `cancelled: ${String(result.cancelled)}`,
    `error: ${JSON.stringify(result.error)}`,
    `stdout:\n${result.stdout}`,
    `stderr:\n${result.stderr}`,
  ].join("\n");
  expect(result.status, diagnostic).toBe(exitCode === 0 ? "completed" : "failed");
  expect(result.exitCode, diagnostic).toBe(exitCode);
}
