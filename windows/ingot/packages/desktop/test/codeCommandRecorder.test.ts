import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { createCodeCommandRecorder } from "./e2e/helpers/code-command-recorder.js";

const directories: string[] = [];
const run = promisify(execFile);
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe.skipIf(process.platform === "win32")("原生编辑器 OS 边界录制夹具", () => {
  it("Execute command and accurately record parameter digest without writing authority or plaintext arguments to file", async () => {
    const root = await mkdtemp(join(tmpdir(), "code recorder's "));
    directories.push(root);
    const recorder = await createCodeCommandRecorder(root);
    const args = [
      "--file-uri",
      "vscode-remote://ssh-remote+private-authority/tmp/%E4%B8%AD%20x.md",
    ];
    await run(recorder.commandPath, args);
    expect(await recorder.readCalls()).toEqual([
      {
        argumentCount: 2,
        argumentHashes: args.map((arg) => createHash("sha256").update(arg).digest("hex")),
      },
    ]);
    expect(await readFile(recorder.logPath, "utf8")).not.toContain("private-authority");
  });

  it("Two executions of the same command leave two records without overwriting or hiding duplicate calls", async () => {
    const root = await mkdtemp(join(tmpdir(), "code-recorder-"));
    directories.push(root);
    const recorder = await createCodeCommandRecorder(root);
    expect(await recorder.readCalls()).toEqual([]);
    await run(recorder.commandPath, ["--file-uri", "vscode-remote://ssh-remote+host/a.md"]);
    await run(recorder.commandPath, ["--file-uri", "vscode-remote://ssh-remote+host/a.md"]);
    expect(await recorder.readCalls()).toHaveLength(2);
  });
});
