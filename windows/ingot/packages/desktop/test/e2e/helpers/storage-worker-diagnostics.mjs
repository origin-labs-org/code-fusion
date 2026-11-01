import workerThreads from "node:worker_threads";
import { syncBuiltinESMExports } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const outputDir = process.env.CF_E2E_STORAGE_WORKER_DIAGNOSTICS_DIR;
if (outputDir) {
  const OriginalWorker = workerThreads.Worker;
  workerThreads.Worker = class extends OriginalWorker {
    constructor(entry, options) {
      super(entry, options);
      if (!options?.argv?.includes("--prepare-storage")) return;
      const workerId = this.threadId;
      let stderr = "";
      let pendingLine = "";
      let lastFrame = null;
      let workerError = null;
      this.stderr?.on("data", (chunk) => {
        stderr = (stderr + chunk.toString()).slice(-65_536);
      });
      this.stdout?.on("data", (chunk) => {
        pendingLine += chunk.toString();
        const lines = pendingLine.split("\n");
        pendingLine = lines.pop().slice(-65_536);
        for (const line of lines) {
          try {
            const frame = JSON.parse(line);
            lastFrame = { method: frame.method, params: frame.params };
          } catch {
            lastFrame = { invalidControlFrame: true };
          }
        }
      });
      this.on("error", (error) => {
        workerError = error.message;
      });
      this.on("exit", (exitCode) => {
        void mkdir(outputDir, { recursive: true })
          .then(() =>
            writeFile(
              join(outputDir, `storage-worker-${process.pid}-${workerId}.json`),
              JSON.stringify(
                {
                  exitCode,
                  stderr,
                  lastFrame,
                  workerError,
                  entry: String(entry),
                  argv: options.argv,
                },
                null,
                2,
              ),
              { mode: 0o600 },
            ),
          )
          .catch(() => {
            
          });
      });
    }
  };
  syncBuiltinESMExports();
}
