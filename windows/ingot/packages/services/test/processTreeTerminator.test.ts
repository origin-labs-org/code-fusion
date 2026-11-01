import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  captureProcessTreeSnapshot,
  shouldSpawnInDetachedProcessGroup,
  terminateProcessTree,
  terminateProcessTreeAndWait,
  type ProcessIdentity,
  type ProcessTreeSnapshot,
} from "@origin-ai/cf-services/process/processTreeTerminator";

const activeChildren = new Set<ChildProcessWithoutNullStreams>();
const tempDirs = new Set<string>();

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isPidRunning(pid: number): boolean {
  if (!isPidAlive(pid)) {
    return false;
  }
  if (process.platform === "win32") {
    return true;
  }
  const result = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], {
    encoding: "utf8",
  });
  const status = result.stdout.trim();
  return status.length > 0 && !status.startsWith("Z");
}

async function waitForPidExit(
  pid: number,
  timeoutMs = 4_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) {
      return true;
    }
    await delay(50);
  }
  return !isPidAlive(pid);
}

async function waitForProcessTreeSnapshotIdentity(
  child: ChildProcessWithoutNullStreams,
  pid: number,
  timeoutMs = 4_000,
): Promise<
  | {
    snapshot: ProcessTreeSnapshot;
    identity: ProcessIdentity;
  }
  | undefined
> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = captureProcessTreeSnapshot(child);
    const identity = snapshot?.identities.find((item) => item.pid === pid);
    if (snapshot && identity) {
      return { snapshot, identity };
    }
    await delay(50);
  }
  const snapshot = captureProcessTreeSnapshot(child);
  const identity = snapshot?.identities.find((item) => item.pid === pid);
  return snapshot && identity ? { snapshot, identity } : undefined;
}

function readFirstStdoutLine(child: ChildProcessWithoutNullStreams): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    let stderrBuffer = "";
    const cleanup = () => {
      child.stdout.off("data", onStdout);
      child.stderr.off("data", onStderr);
      child.off("error", onError);
      child.off("close", onClose);
    };
    const onStdout = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex < 0) {
        return;
      }
      cleanup();
      resolve(buffer.slice(0, newlineIndex).trim());
    };
    const onStderr = (chunk: Buffer) => {
      stderrBuffer += chunk.toString("utf8");
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onClose = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(
        new Error(
          `child exited before reporting pid code=${code} signal=${signal} stdout=${JSON.stringify(buffer)} stderr=${JSON.stringify(stderrBuffer)}`,
        ),
      );
    };
    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.once("error", onError);
    child.once("close", onClose);
  });
}

async function readReportedPid(
  child: ChildProcessWithoutNullStreams,
  pidFilePath?: string,
): Promise<number> {
  let stdoutLine = "";
  try {
    stdoutLine = await readFirstStdoutLine(child);
    const stdoutPid = Number(stdoutLine);
    if (Number.isInteger(stdoutPid)) {
      return stdoutPid;
    }
  } catch (error) {
    if (!pidFilePath) {
      throw error;
    }
  }

  if (pidFilePath) {
    const filePid = Number((await readFile(pidFilePath, "utf8")).trim());
    if (Number.isInteger(filePid)) {
      return filePid;
    }
  }

  throw new Error(`child reported invalid pid: ${JSON.stringify(stdoutLine)}`);
}

afterEach(async () => {
  for (const child of activeChildren) {
    if (child.pid && process.platform !== "win32") {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        
      }
    }
    terminateProcessTree(child);
  }
  activeChildren.clear();
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  tempDirs.clear();
});

describe("terminateProcessTree", () => {
  it("回收 runtime wrapper 时会一并结束其派生子进程", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cf-runtime-terminator-"));
    tempDirs.add(dir);
    const grandchildPidPath = join(dir, "grandchild.pid");
    const child = spawn(
      process.execPath,
      [
        "-e",
        `
const { writeFileSync } = require("node:fs");
const { spawn } = require("node:child_process");
const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  stdio: "ignore",
});
writeFileSync(${JSON.stringify(grandchildPidPath)}, String(child.pid));
process.stdout.write(String(child.pid) + "\\n");
setInterval(() => {}, 1000);
`,
      ],
      {
        detached: shouldSpawnInDetachedProcessGroup(),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    activeChildren.add(child);

    const grandchildPid = await readReportedPid(child, grandchildPidPath);
    expect(isPidAlive(grandchildPid)).toBe(true);

    terminateProcessTree(child);

    expect(await waitForPidExit(child.pid!)).toBe(true);
    expect(await waitForPidExit(grandchildPid)).toBe(true);
    activeChildren.delete(child);
  });

  it.runIf(process.platform !== "win32")(
    "关闭 runtime wrapper 时先给进程处理 SIGTERM 的窗口",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "cf-runtime-terminator-"));
      tempDirs.add(dir);
      const markerPath = join(dir, "graceful-exit.txt");
      const child = spawn(
        process.execPath,
        [
          "-e",
          `
const { writeFileSync } = require("node:fs");
process.on("SIGTERM", () => {
  writeFileSync(${JSON.stringify(markerPath)}, "sigterm");
  setTimeout(() => process.exit(0), 150);
});
console.log("ready");
setInterval(() => {}, 1000);
`,
        ],
        {
          detached: shouldSpawnInDetachedProcessGroup(),
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        },
      );
      activeChildren.add(child);
      await readFirstStdoutLine(child);

      terminateProcessTree(child);

      await delay(50);
      expect(isPidAlive(child.pid!)).toBe(true);
      expect(await readFile(markerPath, "utf8")).toBe("sigterm");
      expect(await waitForPidExit(child.pid!)).toBe(true);
      activeChildren.delete(child);
    },
  );

  it.runIf(process.platform !== "win32")(
    "POSIX 下会兜底清理脱离原进程组的后代进程",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "cf-runtime-terminator-"));
      tempDirs.add(dir);
      const grandchildPidPath = join(dir, "detached-grandchild.pid");
      const child = spawn(
        process.execPath,
        [
          "-e",
          `
const { writeFileSync } = require("node:fs");
const { spawn } = require("node:child_process");
const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  detached: true,
  stdio: "ignore",
});
child.unref();
writeFileSync(${JSON.stringify(grandchildPidPath)}, String(child.pid));
process.stdout.write(String(child.pid) + "\\n");
setInterval(() => {}, 1000);
`,
        ],
        {
          detached: shouldSpawnInDetachedProcessGroup(),
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        },
      );
      activeChildren.add(child);

      const grandchildPid = await readReportedPid(child, grandchildPidPath);
      expect(isPidAlive(grandchildPid)).toBe(true);

      terminateProcessTree(child);

      expect(await waitForPidExit(child.pid!)).toBe(true);
      expect(await waitForPidExit(grandchildPid)).toBe(true);
      activeChildren.delete(child);
    },
  );

  it.runIf(process.platform !== "win32")(
    "非等待式回收会强制结束忽略 SIGTERM 的 runtime 进程树",
    async () => {
      const child = spawn(
        process.execPath,
        [
          "-e",
          `
const { spawn } = require("node:child_process");
const descendant = spawn(
  process.execPath,
  ["-e", 'process.on("SIGTERM", () => {}); process.send?.("ready"); setInterval(() => {}, 1000);'],
  { detached: true, stdio: ["ignore", "ignore", "ignore", "ipc"] },
);
process.on("SIGTERM", () => {});
descendant.once("message", () => process.stdout.write(String(descendant.pid) + "\\n"));
setInterval(() => {}, 1000);
`,
        ],
        {
          detached: shouldSpawnInDetachedProcessGroup(),
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        },
      );
      activeChildren.add(child);
      const descendantPid = await readReportedPid(child);

      try {
        terminateProcessTree(child, { forceAfterMs: 20 });

        expect(await waitForPidExit(child.pid!)).toBe(true);
        expect(await waitForPidExit(descendantPid)).toBe(true);
      } finally {
        for (const pid of [child.pid, descendantPid]) {
          if (pid && isPidRunning(pid)) {
            try {
              process.kill(-pid, "SIGKILL");
            } catch {
              
            }
          }
        }
      }
      activeChildren.delete(child);
    },
  );

  it.runIf(process.platform !== "win32")(
    "查询 root 身份失败时记录 warn 且延迟 force 不沿裸 PID 重新发现",
    async () => {
      const child = spawn(
        process.execPath,
        ["-e", "setInterval(() => {}, 1000)"],
        {
          detached: shouldSpawnInDetachedProcessGroup(),
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        },
      );
      activeChildren.add(child);
      await delay(50);

      const warnMessages: string[] = [];
      const originalPath = process.env.PATH;
      process.env.PATH = "";
      try {
        terminateProcessTree(child, {
          forceAfterMs: 20,
          log: {
            warn: (_traceId, ...args) => {
              warnMessages.push(args.map(String).join(" "));
            },
          },
        });
      } finally {
        if (originalPath === undefined) {
          delete process.env.PATH;
        } else {
          process.env.PATH = originalPath;
        }
      }

      expect(
        warnMessages.some((message) =>
          message.includes("查询 runtime 后代进程失败"),
        ),
      ).toBe(true);
      await delay(100);
      expect(isPidAlive(child.pid!)).toBe(true);
    },
  );

  it.runIf(process.platform !== "win32")(
    "等待式回收会撑到 SIGKILL 兜底完成",
    async () => {
      const child = spawn(
        process.execPath,
        [
          "-e",
          `
process.on("SIGTERM", () => {});
console.log("ready");
setInterval(() => {}, 1000);
`,
        ],
        {
          detached: shouldSpawnInDetachedProcessGroup(),
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        },
      );
      activeChildren.add(child);
      await readFirstStdoutLine(child);

      const result = await terminateProcessTreeAndWait(child, {
        forceAfterMs: 20,
        waitAfterForceMs: 20,
      });

      expect(result).toEqual({ remainingPids: [] });
      expect(await waitForPidExit(child.pid!, 1_000)).toBe(true);
      activeChildren.delete(child);
    },
  );

  it.runIf(process.platform !== "win32")(
    "根进程先退出时仍等待 detached 后代完成强制回收",
    async () => {
      const child = spawn(
        process.execPath,
        [
          "-e",
          `
const { spawn } = require("node:child_process");
const descendant = spawn(
  process.execPath,
  ["-e", 'process.on("SIGTERM", () => {}); process.send?.("ready"); setInterval(() => {}, 1000);'],
  { detached: true, stdio: ["ignore", "ignore", "ignore", "ipc"] },
);
descendant.once("message", () => process.stdout.write(String(descendant.pid) + "\\n"));
setInterval(() => {}, 1000);
`,
        ],
        {
          detached: shouldSpawnInDetachedProcessGroup(),
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        },
      );
      activeChildren.add(child);

      const descendantPid = await readReportedPid(child);
      expect(isPidAlive(descendantPid)).toBe(true);

      try {
        await terminateProcessTreeAndWait(child, {
          forceAfterMs: 30,
          waitAfterForceMs: 30,
        });

        expect(isPidRunning(descendantPid)).toBe(false);
      } finally {
        if (isPidAlive(descendantPid)) {
          try {
            process.kill(-descendantPid, "SIGKILL");
          } catch {
            
          }
        }
      }
      activeChildren.delete(child);
    },
  );

  it.runIf(process.platform !== "win32")(
    "延迟回收不会终止 PID 相同但创建标识已变化的进程",
    async () => {
      const child = spawn(
        process.execPath,
        [
          "-e",
          `
const { spawn } = require("node:child_process");
const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  detached: true,
  stdio: "ignore",
});
descendant.unref();
process.on("message", (message) => {
  if (message === "exit") process.exit(0);
});
process.stdout.write(String(descendant.pid) + "\\n");
`,
        ],
        {
          detached: shouldSpawnInDetachedProcessGroup(),
          stdio: ["ignore", "pipe", "pipe", "ipc"],
          windowsHide: true,
        },
      );
      activeChildren.add(child);
      const descendantPid = await readReportedPid(child);
      const captured = await waitForProcessTreeSnapshotIdentity(child, descendantPid);
      expect(captured).toBeDefined();
      const { snapshot, identity: descendantIdentity } = captured!;
      child.send("exit");
      expect(await waitForPidExit(child.pid!)).toBe(true);

      try {
        await terminateProcessTreeAndWait(child, {
          forceAfterMs: 20,
          waitAfterForceMs: 20,
          snapshot: {
            ...snapshot,
            identities: snapshot.identities.map((identity) =>
              identity.pid === descendantIdentity.pid
                ? { ...identity, startTime: `${descendantIdentity.startTime}-reused` }
                : identity,
            ),
          },
        });
        expect(isPidRunning(descendantPid)).toBe(true);
      } finally {
        if (isPidRunning(descendantPid)) {
          process.kill(-descendantPid, "SIGKILL");
        }
      }
      activeChildren.delete(child);
    },
  );

  it.runIf(process.platform !== "win32")("根进程已退出时仍按原进程组回收同组后代", async () => {
    const child = spawn(
      process.execPath,
      [
        "-e",
        `
const { spawn } = require("node:child_process");
const descendant = spawn(
  process.execPath,
  ["-e", 'process.on("SIGTERM", () => {}); process.send?.("ready"); setInterval(() => {}, 1000);'],
  { stdio: ["ignore", "ignore", "ignore", "ipc"] },
);
descendant.once("message", () => {
  process.stdout.write(String(descendant.pid) + "\\n");
});
process.on("message", (message) => {
  if (message === "exit") process.exit(0);
});
`,
      ],
      {
        detached: shouldSpawnInDetachedProcessGroup(),
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        windowsHide: true,
      },
    );
    activeChildren.add(child);
    const descendantPid = await readReportedPid(child);
    const captured = await waitForProcessTreeSnapshotIdentity(child, descendantPid);
    expect(captured).toBeDefined();
    const { snapshot } = captured!;
    child.send("exit");
    expect(await waitForPidExit(child.pid!)).toBe(true);
    expect(isPidRunning(descendantPid)).toBe(true);

    try {
      await terminateProcessTreeAndWait(child, {
        forceAfterMs: 30,
        waitAfterForceMs: 30,
        snapshot,
      });
      expect(isPidRunning(descendantPid)).toBe(false);
    } finally {
      if (isPidRunning(descendantPid)) {
        process.kill(-child.pid!, "SIGKILL");
      }
    }
    activeChildren.delete(child);
  });

  it.runIf(process.platform !== "win32")(
    "健康 runtime 提前退出时不会固定等待兜底窗口",
    async () => {
      const child = spawn(
        process.execPath,
        ["-e", "setInterval(() => {}, 1000)"],
        {
          detached: shouldSpawnInDetachedProcessGroup(),
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        },
      );
      activeChildren.add(child);
      await delay(50);

      const startedAt = Date.now();
      const waitPromise = terminateProcessTreeAndWait(child, {
        forceAfterMs: 1_500,
        waitAfterForceMs: 100,
      });
      setTimeout(() => {
        child.kill();
      }, 100).unref?.();
      await waitPromise;
      const durationMs = Date.now() - startedAt;

      expect(await waitForPidExit(child.pid!, 1_000)).toBe(true);
      expect(durationMs).toBeLessThan(1_200);
      activeChildren.delete(child);
    },
  );
});
