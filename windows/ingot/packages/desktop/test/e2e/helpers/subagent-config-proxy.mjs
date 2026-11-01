import { spawn } from "node:child_process";
import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

if (process.argv.includes("app-server") && process.argv.includes("--stdio")) {
  const preload = `--import=${JSON.stringify(fileURLToPath(import.meta.url))}`;
  const child = spawn(process.execPath, process.argv.slice(1), {
    stdio: ["pipe", "pipe", "inherit"],
    env: {
      ...process.env,
      NODE_OPTIONS: (process.env.NODE_OPTIONS ?? "").replace(preload, "").trim(),
    },
  });
  const root = process.env.CF_E2E_ARTIFACT_DIR;
  const control = join(root, "subagent-config-control.json");
  const log = join(root, `subagent-config-rpc-${child.pid}.jsonl`);
  const pending = new Map();
  let outbound = Promise.resolve(),
    inbound = Promise.resolve();
  const writeLog = (event) =>
    appendFile(
      log,
      JSON.stringify({
        time: Date.now(),
        pid: child.pid,
        hostPid: process.ppid,
        cwd: process.cwd(),
        ...event,
      }) + "\n",
    );
  createInterface({ input: child.stdout }).on("line", (line) => {
    outbound = outbound
      .then(async () => {
        let frame;
        try {
          frame = JSON.parse(line);
        } catch {
          process.stdout.write(line + "\n");
          return;
        }
        if (frame.method === "subagents/readRuntimeConfig") {
          const state = JSON.parse(await readFile(control, "utf8").catch(() => "{}"));
          const sessionId = frame.params.sessionId;
          const failed = state.failedSessionIds?.includes(sessionId) === true;
          await writeLog({ kind: "read", sessionId, failed });
          if (state.heldSessionIds?.includes(sessionId)) {
            await writeLog({ kind: "held", sessionId });
            return;
          }
          if (failed) {
            child.stdin.write(
              JSON.stringify({
                id: frame.id,
                error: { code: -32603, message: "E2E_CONFIG_UNAVAILABLE" },
              }) + "\n",
            );
            return;
          }
          pending.set(frame.id, sessionId);
        }
        process.stdout.write(line + "\n");
      })
      .catch((error) => {
        process.stderr.write(String(error));
        process.exitCode = 1;
        child.kill();
      });
  });
  createInterface({ input: process.stdin })
    .on("line", (line) => {
      inbound = inbound
        .then(async () => {
          const frame = JSON.parse(line);
          if (pending.has(frame.id)) {
            await writeLog({
              kind: "snapshot",
              sessionId: pending.get(frame.id),
              snapshot: frame.result,
              error: frame.error,
            });
            pending.delete(frame.id);
          }
          child.stdin.write(line + "\n");
        })
        .catch((error) => {
          process.stderr.write(String(error));
          process.exitCode = 1;
          child.kill();
        });
    })
    .on("close", () => {
      void inbound.then(() => child.stdin.end());
    });
  for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => child.kill(signal));
  child.on("exit", (code) => {
    void Promise.all([inbound, outbound]).finally(() => process.exit(code ?? 1));
  });
  await new Promise(() => {});
}
