import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HELPER_APP_NAME, HELPER_DISPLAY_NAME } from "@origin-ai/cf-cua/broker/helperConstants";
import { afterEach, describe, expect, it } from "vitest";

const isWindows = process.platform === "win32";
const tempDirs: string[] = [];
const TEST_FILE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TEST_FILE_DIR, "../../..");

function makeTempDir(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeExecutable(filePath: string, content: string) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, { encoding: "utf-8", mode: 0o755 });
}

function writeFakeMachOExecutable(filePath: string) {
  mkdirSync(dirname(filePath), { recursive: true });
  const buffer = Buffer.alloc(32);
  buffer.writeUInt32LE(0xfeedfacf, 0);
  writeFileSync(filePath, buffer, { mode: 0o755 });
}

function writeFakeTool(binDir: string, toolName: "codesign" | "spctl" | "xcrun", logPath: string) {
  writeExecutable(
    join(binDir, toolName),
    `#!/bin/bash
set -euo pipefail
printf '${toolName}' >> "${logPath}"
for arg in "$@"; do
  printf '\\t%s' "$arg" >> "${logPath}"
done
printf '\\n' >> "${logPath}"
if [[ "${toolName}" == "codesign" && "\${CF_FAKE_CODESIGN_FAIL_HELPER:-0}" == "1" && "$*" == *"${HELPER_APP_NAME}"* ]]; then
  echo "fake helper codesign rejection" >&2
  exit 7
fi
if [[ "${toolName}" == "xcrun" && "\${CF_FAKE_STAPLER_FAIL_HELPER:-0}" == "1" && "$*" == *"${HELPER_APP_NAME}"* ]]; then
  echo "fake helper stapler rejection" >&2
  exit 8
fi
`,
  );
}

function createReleaseApp(rootDir: string, productName = "CodeFusion") {
  const appPath = join(rootDir, `${productName}.app`);

  writeExecutable(join(appPath, "Contents", "MacOS", productName), "#!/bin/bash\n");

  return { appPath };
}

function createCfHomeHelper(cfHome: string, variant?: string) {
  const helperAppPath = join(
    cfHome,
    "computer-use",
    ...(variant ? [variant] : []),
    HELPER_APP_NAME,
  );
  writeFakeMachOExecutable(join(helperAppPath, "Contents", "MacOS", HELPER_DISPLAY_NAME));
  return helperAppPath;
}

function runDoctor(appPath: string, binDir: string, extraEnv: NodeJS.ProcessEnv = {}) {
  return execFileSync("bash", ["scripts/doctor-macos-release-app.sh", appPath], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      CF_ENV: "production",
      // Test selection must not inherit a developer's active dev/preview helper variant.
      CF_CUA_HELPER_INSTALL_VARIANT: "",
      ...extraEnv,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
    },
    encoding: "utf-8",
    stdio: "pipe",
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe.skipIf(isWindows)("doctor-macos-release-app.sh", () => {
  it("Preview automatically infers main executable by bundle name and validates preview Helper directory", () => {
    const workspaceDir = makeTempDir("cf-macos-preview-doctor-");
    const binDir = join(workspaceDir, "bin");
    const toolLog = join(workspaceDir, "tool.log");
    const { appPath } = createReleaseApp(workspaceDir, "CodeFusion Preview");
    const cfHome = join(workspaceDir, ".cf");
    const helperAppPath = createCfHomeHelper(cfHome, "preview");

    mkdirSync(binDir, { recursive: true });
    writeFakeTool(binDir, "codesign", toolLog);
    writeFakeTool(binDir, "spctl", toolLog);
    writeFakeTool(binDir, "xcrun", toolLog);

    const output = runDoctor(appPath, binDir, {
      CF_ENV: "test",
      CF_CUA_REQUIRE_HELPER: "1",
      CF_HOME: cfHome,
    });

    expect(output).toContain(`validating CodeFusion Preview.app: ${appPath}`);
    const log = readFileSync(toolLog, "utf-8");
    expect(log).toContain(`codesign\t--verify\t--deep\t--strict\t${appPath}`);
    expect(log).toContain(`codesign\t--verify\t--deep\t--strict\t${helperAppPath}`);
  });

  it("Only validate installed CodeFusion.app by default without hard coupling Computer Use Helper release", () => {
    const workspaceDir = makeTempDir("cf-macos-release-doctor-");
    const binDir = join(workspaceDir, "bin");
    const toolLog = join(workspaceDir, "tool.log");
    const { appPath } = createReleaseApp(workspaceDir);
    const cfHome = join(workspaceDir, ".cf");

    mkdirSync(binDir, { recursive: true });
    writeFakeTool(binDir, "codesign", toolLog);
    writeFakeTool(binDir, "spctl", toolLog);

    const output = runDoctor(appPath, binDir, { CF_HOME: cfHome });

    expect(output).toContain("[macos-release-doctor] done");
    const log = readFileSync(toolLog, "utf-8");
    expect(log).toContain(`codesign\t--verify\t--deep\t--strict\t${appPath}`);
    expect(log).toContain(`spctl\t-a\t-vv\t-t\texec\t${appPath}`);
    expect(log).not.toContain(HELPER_APP_NAME);
    expect(output).toContain("standalone Computer Use Helper.app not required");
  });

  it("CUA release gate validates external CodeFusion Computer Use.app", () => {
    const workspaceDir = makeTempDir("cf-macos-release-doctor-helper-");
    const binDir = join(workspaceDir, "bin");
    const toolLog = join(workspaceDir, "tool.log");
    const { appPath } = createReleaseApp(workspaceDir);
    const cfHome = join(workspaceDir, ".cf");
    const helperAppPath = createCfHomeHelper(cfHome);

    mkdirSync(binDir, { recursive: true });
    writeFakeTool(binDir, "codesign", toolLog);
    writeFakeTool(binDir, "spctl", toolLog);
    writeFakeTool(binDir, "xcrun", toolLog);

    const output = runDoctor(appPath, binDir, {
      CF_CUA_REQUIRE_HELPER: "1",
      CF_HOME: cfHome,
    });

    expect(output).toContain("[macos-release-doctor] done");
    const log = readFileSync(toolLog, "utf-8");
    expect(log).toContain(`codesign\t--verify\t--deep\t--strict\t${appPath}`);
    expect(log).toContain(`spctl\t-a\t-vv\t-t\texec\t${appPath}`);
    expect(log).toContain(`codesign\t--verify\t--deep\t--strict\t${helperAppPath}`);
    expect(log).toContain(`spctl\t-a\t-vv\t-t\texec\t${helperAppPath}`);
    expect(log).toContain(`xcrun\tstapler\tvalidate\t${helperAppPath}`);
  });

  it("CUA release gate 在 Helper staple 无效时应 fail-closed", () => {
    const workspaceDir = makeTempDir("cf-macos-release-doctor-stapler-fail-");
    const binDir = join(workspaceDir, "bin");
    const toolLog = join(workspaceDir, "tool.log");
    const { appPath } = createReleaseApp(workspaceDir);
    const cfHome = join(workspaceDir, ".cf");
    const helperAppPath = createCfHomeHelper(cfHome);

    mkdirSync(binDir, { recursive: true });
    writeFakeTool(binDir, "codesign", toolLog);
    writeFakeTool(binDir, "spctl", toolLog);
    writeFakeTool(binDir, "xcrun", toolLog);

    expect(() =>
      runDoctor(appPath, binDir, {
        CF_CUA_REQUIRE_HELPER: "1",
        CF_CUA_HELPER_APP_PATH: helperAppPath,
        CF_FAKE_STAPLER_FAIL_HELPER: "1",
      }),
    ).toThrow(/fake helper stapler rejection/);
  });

  it("CUA release gate 缺少外置 Helper.app 时应 fail-closed", () => {
    const workspaceDir = makeTempDir("cf-macos-release-doctor-missing-helper-");
    const binDir = join(workspaceDir, "bin");
    const toolLog = join(workspaceDir, "tool.log");
    const { appPath } = createReleaseApp(workspaceDir);
    const cfHome = join(workspaceDir, ".cf");

    mkdirSync(binDir, { recursive: true });
    writeFakeTool(binDir, "codesign", toolLog);
    writeFakeTool(binDir, "spctl", toolLog);

    expect(() =>
      runDoctor(appPath, binDir, {
        CF_CUA_REQUIRE_HELPER: "1",
        CF_HOME: cfHome,
      }),
    ).toThrow(/Computer Use Helper\.app missing/);
  });

  it("CUA release gate should fail-closed when CF_HOME/HOME is absent", () => {
    const workspaceDir = makeTempDir("cf-macos-release-doctor-no-home-");
    const binDir = join(workspaceDir, "bin");
    const toolLog = join(workspaceDir, "tool.log");
    const { appPath } = createReleaseApp(workspaceDir);

    mkdirSync(binDir, { recursive: true });
    writeFakeTool(binDir, "codesign", toolLog);
    writeFakeTool(binDir, "spctl", toolLog);

    expect(() =>
      runDoctor(appPath, binDir, {
        CF_CUA_REQUIRE_HELPER: "1",
        CF_HOME: "",
        HOME: "",
      }),
    ).toThrow(/no product helper path/);
  });

  it("Should not consider release app acceptance successful when helper codesign fails", () => {
    const workspaceDir = makeTempDir("cf-macos-release-doctor-fail-helper-");
    const binDir = join(workspaceDir, "bin");
    const toolLog = join(workspaceDir, "tool.log");
    const { appPath } = createReleaseApp(workspaceDir);
    const cfHome = join(workspaceDir, ".cf");
    const helperAppPath = createCfHomeHelper(cfHome);

    mkdirSync(binDir, { recursive: true });
    writeFakeTool(binDir, "codesign", toolLog);
    writeFakeTool(binDir, "spctl", toolLog);

    expect(() =>
      runDoctor(appPath, binDir, {
        CF_CUA_REQUIRE_HELPER: "1",
        CF_HOME: cfHome,
        CF_FAKE_CODESIGN_FAIL_HELPER: "1",
      }),
    ).toThrow(/fake helper codesign rejection/);

    const log = readFileSync(toolLog, "utf-8");
    expect(log).toContain(`codesign\t--verify\t--deep\t--strict\t${helperAppPath}`);
    expect(log).not.toContain(`spctl\t-a\t-vv\t-t\texec\t${helperAppPath}`);
  });

  it("Should fail-closed when helper main executable is still a shell wrapper", () => {
    const workspaceDir = makeTempDir("cf-macos-release-doctor-helper-wrapper-");
    const binDir = join(workspaceDir, "bin");
    const toolLog = join(workspaceDir, "tool.log");
    const { appPath } = createReleaseApp(workspaceDir);
    const cfHome = join(workspaceDir, ".cf");
    const helperAppPath = createCfHomeHelper(cfHome);
    writeExecutable(join(helperAppPath, "Contents", "MacOS", HELPER_DISPLAY_NAME), "#!/bin/bash\n");

    mkdirSync(binDir, { recursive: true });
    writeFakeTool(binDir, "codesign", toolLog);
    writeFakeTool(binDir, "spctl", toolLog);

    expect(() =>
      runDoctor(appPath, binDir, {
        CF_CUA_REQUIRE_HELPER: "1",
        CF_HOME: cfHome,
      }),
    ).toThrow(/not a Mach-O executable/);
    const log = existsSync(toolLog) ? readFileSync(toolLog, "utf-8") : "";
    expect(log).toContain(`codesign\t--verify\t--deep\t--strict\t${appPath}`);
    expect(log).not.toContain(`codesign\t--verify\t--deep\t--strict\t${helperAppPath}`);
  });
});
