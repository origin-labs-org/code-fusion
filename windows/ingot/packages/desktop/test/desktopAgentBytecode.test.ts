import { execFile } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import { buildDesktopAgentBytecode } from "../../../scripts/build-desktop-agent-bytecode.mjs";

const execFileAsync = promisify(execFile);
const electronPath = createRequire(import.meta.url)("electron") as string;
const directories: string[] = [];
const runtimeEnv = { ...process.env, ELECTRON_RUN_AS_NODE: "1", NODE_OPTIONS: "" };

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture(source: string) {
  const dir = await mkdtemp(join(tmpdir(), "cf bytecode 中文 "));
  directories.push(dir);
  const entryPath = join(dir, "cf.cjs");
  await writeFile(entryPath, source);
  return { dir, entryPath };
}

it("实际 Electron 字节码保留 CommonJS、argv、资源路径和动态函数源码", async () => {
  const { dir, entryPath } = await fixture(`#!/usr/bin/env node
const path = require('node:path');
const value = require('./value.cjs');
const dynamic = new Function('return 7');
process.stdout.write(JSON.stringify({value, args:process.argv.slice(2),
  filename:path.basename(__filename), directory:__dirname, dynamic:dynamic(),
  hasDynamicSource:dynamic.toString().includes('return 7')}));
`);
  await writeFile(join(dir, "value.cjs"), "module.exports = 42;");
  const artifact = await buildDesktopAgentBytecode({ entryPath, electronPath });
  const result = await execFileAsync(electronPath, [artifact.loaderPath, "app-server", "--stdio"], {
    env: runtimeEnv,
  });
  expect(JSON.parse(result.stdout)).toEqual({
    value: 42,
    args: ["app-server", "--stdio"],
    filename: "cf.cjs",
    directory: await realpath(dir),
    dynamic: 7,
    hasDynamicSource: true,
  });
  expect(result.stderr).toBe("");
  expect(await readFile(entryPath, "utf8")).toContain("不应出现在字节码产物中的源码注释");
  expect(
    (await readFile(artifact.bytecodePath)).includes(
      Buffer.from("不应出现在字节码产物中的源码注释"),
    ),
  ).toBe(false);
});

it.each(["0", "1"])(
  "Dynamic import in bytecode loads ESM from original bundle directory (FORCE_COLOR=%s)",
  async (forceColor) => {
    const { dir, entryPath } = await fixture(
      "import('./value.mjs').then(m => process.stdout.write(String(m.default)));",
    );
    await writeFile(join(dir, "value.mjs"), "export default 43;");
    const artifact = await buildDesktopAgentBytecode({ entryPath, electronPath });
    const result = await execFileAsync(electronPath, [artifact.loaderPath], {
      env: { ...runtimeEnv, FORCE_COLOR: forceColor },
    });
    expect(result.stdout).toBe("43");
  },
);

it("损坏字节码在 CLI 执行前失败且不污染 stdout", async () => {
  const { entryPath } = await fixture("console.log('SHOULD_NOT_EXECUTE');");
  const artifact = await buildDesktopAgentBytecode({ entryPath, electronPath });
  await writeFile(artifact.bytecodePath, "corrupt");
  await expect(
    execFileAsync(electronPath, [artifact.loaderPath], { env: runtimeEnv }),
  ).rejects.toMatchObject({
    code: 1,
    stdout: "",
    stderr: expect.stringContaining("字节码摘要不匹配"),
  });
});

it("不同 V8 运行时在反序列化前失败", async () => {
  const { entryPath } = await fixture("console.log('SHOULD_NOT_EXECUTE');");
  const artifact = await buildDesktopAgentBytecode({ entryPath, electronPath });
  await expect(
    execFileAsync(process.execPath, [artifact.loaderPath], {
      env: { ...process.env, NODE_OPTIONS: "" },
    }),
  ).rejects.toMatchObject({
    code: 1,
    stdout: "",
    stderr: expect.stringContaining("字节码运行时不匹配"),
  });
});

it("Function compilation errors preserve error message and function name, writing diagnostics only to stderr", async () => {
  const { entryPath } = await fixture(
    "function bytecodeFailure() { throw new Error('EXPECTED_BYTECODE_FAILURE'); } bytecodeFailure();",
  );
  const artifact = await buildDesktopAgentBytecode({ entryPath, electronPath });
  await expect(
    execFileAsync(electronPath, [artifact.loaderPath], { env: runtimeEnv }),
  ).rejects.toMatchObject({
    code: 1,
    stdout: "",
    stderr: expect.stringMatching(/EXPECTED_BYTECODE_FAILURE[\s\S]*bytecodeFailure/),
  });
});

it("Compilation failure keeps previous runnable loader; CLI is not executed during compilation", async () => {
  const { dir, entryPath } = await fixture(
    "require('node:fs').writeFileSync(__dirname+'/executed', 'yes');",
  );
  const artifact = await buildDesktopAgentBytecode({ entryPath, electronPath });
  await expect(readFile(join(dir, "executed"))).rejects.toMatchObject({ code: "ENOENT" });
  const loader = await readFile(artifact.loaderPath);
  await writeFile(entryPath, "function {");
  await expect(buildDesktopAgentBytecode({ entryPath, electronPath })).rejects.toThrow();
  expect(await readFile(artifact.loaderPath)).toEqual(loader);
});

it("Reject mixing bytecode in coverage builds", async () => {
  const { entryPath } = await fixture("42;");
  await expect(
    buildDesktopAgentBytecode({ entryPath, electronPath, env: { CF_E2E_COVERAGE: "1" } }),
  ).rejects.toThrow(/coverage/);
});
