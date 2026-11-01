

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { CF_DWF_CHILD_COMMAND } from "@origin-ai/cf-contracts";
import { renderChildEntry } from "@origin-ai/cf-dynamic-workflow-runtime";
import type { RunContext } from "@origin-ai/cf-shared-types";
import { isDwfChildInvocation } from "../src/dwf-child-command.js";
import { run } from "../src/run.js";

const createCapturedStdout = () => {
  let output = "";
  return {
    output: () => output,
    stream: {
      isTTY: false,
      write: (chunk: string | Uint8Array): boolean => {
        output += typeof chunk === "string" ? chunk : chunk.toString();
        return true;
      },
    } as unknown as NodeJS.WriteStream,
  };
};

const createChildContext = (
  argv: string[],
): { ctx: RunContext; stdout: () => string; stderr: () => string } => {
  const stdout = createCapturedStdout();
  const stderr = createCapturedStdout();
  return {
    ctx: {
      argv,
      stderr: stderr.stream,
      stdin: Readable.from([]) as unknown as NodeJS.ReadStream,
      stdout: stdout.stream,
    },
    stdout: stdout.output,
    stderr: stderr.output,
  };
};

const writeEntry = async (lowered: string): Promise<{ path: string; dispose: () => Promise<void> }> => {
  const root = await mkdtemp(join(tmpdir(), "dwf-child-cmd-"));
  const path = join(root, "run.mjs");
  await writeFile(path, renderChildEntry({ lowered }, { runId: "run" }), "utf8");
  return { path, dispose: () => rm(root, { force: true, recursive: true }) };
};

test("recognises the dwf child subcommand only as argv[0]", () => {
  assert.equal(isDwfChildInvocation([CF_DWF_CHILD_COMMAND, "/tmp/run.mjs"]), true);
  assert.equal(isDwfChildInvocation([CF_DWF_CHILD_COMMAND]), true);
  assert.equal(isDwfChildInvocation([]), false);
  assert.equal(isDwfChildInvocation(["--help"]), false);
  assert.equal(isDwfChildInvocation(["-p", CF_DWF_CHILD_COMMAND]), false);
});

test("runs the sandbox child from the entry file and writes the NDJSON completion to stdout", async () => {
  const entry = await writeEntry('__host.log("from the sandbox");\nreturn { ok: 42 };');
  try {
    const { ctx, stdout, stderr } = createChildContext([CF_DWF_CHILD_COMMAND, entry.path]);

    const exitCode = await run(ctx);

    assert.equal(exitCode, 0);
    assert.equal(stderr(), "");
    const lines = stdout()
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
    assert.deepEqual(lines, [
      { kind: "event", type: "log", message: "from the sandbox" },
      { kind: "complete", ok: true, value: { ok: 42 } },
    ]);
  } finally {
    await entry.dispose();
  }
});

test("reports a lowered-body syntax error as an error completion, not a crash", async () => {
  const entry = await writeEntry("this is not javascript(");
  try {
    const { ctx, stdout, stderr } = createChildContext([CF_DWF_CHILD_COMMAND, entry.path]);

    const exitCode = await run(ctx);

    assert.equal(exitCode, 0);
    assert.equal(stderr(), "");
    const message = JSON.parse(stdout().trim());
    assert.equal(message.kind, "complete");
    assert.equal(message.ok, false);
    assert.equal(message.error.name, "SyntaxError");
  } finally {
    await entry.dispose();
  }
});

test("fails with usage when the entry path argument is missing", async () => {
  const { ctx, stdout, stderr } = createChildContext([CF_DWF_CHILD_COMMAND]);

  const exitCode = await run(ctx);

  assert.equal(exitCode, 1);
  assert.equal(stdout(), "");
  assert.match(stderr(), new RegExp(`Usage: ${CF_DWF_CHILD_COMMAND}`));
});

test("fails on stderr when the entry file does not exist", async () => {
  const { ctx, stdout, stderr } = createChildContext([
    CF_DWF_CHILD_COMMAND,
    join(tmpdir(), "dwf-child-cmd-missing", "nope.mjs"),
  ]);

  const exitCode = await run(ctx);

  assert.equal(exitCode, 1);
  assert.equal(stdout(), "");
  assert.match(stderr(), /Workflow child failed: /);
});
