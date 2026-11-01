

import { describe, expect, it } from "vitest";
import type { ExecutionPort, FileSystemPort } from "@origin-ai/cf-contracts";
import { InMemoryJournalStore, type WorkflowReportSink } from "@origin-ai/cf-dynamic-workflow";
import { createWorkflowEscalationRegistry } from "../src/app/workflow-escalation-registry.js";
import { createAgentRuntimeWorkflowDriver } from "../src/app/workflow-driver.js";

function stubFileSystemPort(glob: string[], read: string): FileSystemPort {
  const unsupported = (name: string) => () => {
    throw new Error(`stubFileSystemPort.${name} 不应被 world-read 触及`);
  };
  return {
    async searchFiles(request: { path: string; pattern: string }) {
      return {
        path: request.path,
        pattern: request.pattern,
        durationMs: 0,
        files: glob,
        numFiles: glob.length,
        truncated: false,
      };
    },
    async readTextFile(request: { path: string }) {
      return {
        path: request.path,
        content: read,
        encoding: "utf-8",
        bytesRead: read.length,
        sizeBytes: read.length,
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
    searchText: unsupported("searchText"),
  } as unknown as FileSystemPort;
}

function unsupportedExecutionPort(): ExecutionPort {
  return {
    run: () => {
      throw new Error("本用例不应触及 ExecutionPort（git.* world-read）");
    },
  };
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

function makeDriver() {
  return createAgentRuntimeWorkflowDriver({
    journal: new InMemoryJournalStore(),
    emit: () => undefined,
    executionPort: unsupportedExecutionPort(),
    fileSystemPort: stubFileSystemPort(["a.ts"], "body"),
    escalationRegistry: createWorkflowEscalationRegistry(),
    cwd: process.cwd(),
    runId: "run",
    runtimeFactory: () => {
      throw new Error("实参校验不该创建 actor runtime");
    },
  })(noopSink());
}

describe("driver world-read argument validation", () => {
  it("passes well-formed positional args through to the fs port", async () => {
    await expect(makeDriver().executeWorldRead("glob", ["src/**"])).resolves.toEqual(["a.ts"]);
    await expect(makeDriver().executeWorldRead("read", ["a.ts"])).resolves.toBe("body");
  });

  it("rejects a missing argument with a structured DriverError (never a coerced path)", async () => {
    await expect(makeDriver().executeWorldRead("read", [])).rejects.toMatchObject({
      code: "DriverError",
    });
    await expect(makeDriver().executeWorldRead("read", [])).rejects.toThrow(/read/);
    await expect(makeDriver().executeWorldRead("read", [])).rejects.toThrow(/path/);
  });

  it("rejects a wrong-typed argument", async () => {
    await expect(makeDriver().executeWorldRead("glob", [42])).rejects.toMatchObject({
      code: "DriverError",
    });
    await expect(makeDriver().executeWorldRead("glob", [undefined])).rejects.toMatchObject({
      code: "DriverError",
    });
    await expect(makeDriver().executeWorldRead("glob", [["src/**"]])).rejects.toMatchObject({
      code: "DriverError",
    });
  });

  it("rejects extra arguments (only a wiring fault can produce them)", async () => {
    await expect(makeDriver().executeWorldRead("glob", ["src/**", "extra"])).rejects.toMatchObject({
      code: "DriverError",
    });
  });

  it("rejects rather than throwing synchronously (so the node settles as failed)", async () => {
    const driver = makeDriver();
    let promise: Promise<unknown> | undefined;
    let threwSynchronously = false;
    try {
      promise = driver.executeWorldRead("glob", []);
    } catch {
      threwSynchronously = true;
    }
    expect(threwSynchronously).toBe(false);
    await expect(promise).rejects.toMatchObject({ code: "DriverError" });
  });
});
