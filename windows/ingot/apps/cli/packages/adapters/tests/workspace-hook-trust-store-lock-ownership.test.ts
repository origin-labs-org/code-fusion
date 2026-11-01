import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceHookTrustRecord } from "@origin-ai/cf-contracts";
import { createFileWorkspaceHookTrustStore } from "../src/storage/workspace-hook-trust-store.js";

const roots: string[] = [];
const DIGEST_A = "a".repeat(64);
const DEAD_PID = 999_999_999;

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "cf-hook-store-lock-"));
  roots.push(value);
  return value;
}

function record(workspaceIdentity: string, digest: string): WorkspaceHookTrustRecord {
  return {
    workspaceIdentity,
    hookDeclarationDigest: digest,
    digestAlgorithm: "sha256",
    decision: "trusted",
    grantedAt: "2026-08-06T00:00:00.000Z",
    eventAtGrant: "SessionStart",
    displayCommandAtGrant: "echo trusted",
    sourcePathAtGrant: ".cf/config.json",
    sourceDiscoveryOrderAtGrant: 0,
    matcherAtGrant: "startup",
    matcherIndexAtGrant: 0,
    hookIndexAtGrant: 0,
  };
}

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function ageLockBeyond(lockPath: string, staleLockMs: number): Promise<void> {
  const staleTime = new Date(Date.now() - staleLockMs * 12);
  await utimes(lockPath, staleTime, staleTime);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true })));
});

describe("FileWorkspaceHookTrustStore lock ownership（CR-02）", () => {
  it("契约 3a（CR-01）：pid 存活但启动时间不一致（PID 复用）→ 超龄锁必须被回收", async () => {
    const dir = await root();
    const filePath = join(dir, "workspace-hook-trust-v1.json");
    const lockPath = `${filePath}.lock`;

    const sleeper = spawn(process.execPath, ["-e", "setInterval(() => {}, 60000)"], {
      stdio: "ignore",
    });
    try {
      const reusedStartTime = Date.now() - 86_400_000;
      await writeFile(
        lockPath,
        `${JSON.stringify({ pid: sleeper.pid, startTime: reusedStartTime, token: "dead-original" })}\n`,
        "utf8",
      );
      await ageLockBeyond(lockPath, 5_000);

      const storeB = createFileWorkspaceHookTrustStore({
        filePath,
        staleLockMs: 5_000,
        lockTimeoutMs: 5_000,
        probeProcessStartTime: async () => Date.now() - 1_000,
      });
      await storeB.grant([record("/ws/owner-b", DIGEST_A)]);

      const loaded = await storeB.load();
      expect(loaded.status).toBe("ok");
      await expect(stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      sleeper.kill();
      await new Promise((resolve) => {
        sleeper.once("exit", resolve);
        setTimeout(resolve, 2_000);
      });
    }
  });

  it("契约 4：owner metadata 写入失败 → 不残留空锁与句柄", async () => {
    const dir = await root();
    const filePath = join(dir, "workspace-hook-trust-v1.json");
    const lockPath = `${filePath}.lock`;

    const store = createFileWorkspaceHookTrustStore({
      filePath,
      writeLockOwnerMetadata: async () => {
        throw new Error("disk full while writing lock metadata");
      },
    });
    await expect(store.grant([record("/ws/owner-b", DIGEST_A)])).rejects.toThrow(/disk full/);
    await expect(stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });

    const retry = createFileWorkspaceHookTrustStore({ filePath });
    await retry.grant([record("/ws/owner-b", DIGEST_A)]);
    const loaded = await retry.load();
    expect(loaded.status).toBe("ok");
  });

  it("契约 1：被回收后恢复的旧 owner 不得删除新持有者的锁", async () => {
    const dir = await root();
    const filePath = join(dir, "workspace-hook-trust-v1.json");
    const lockPath = `${filePath}.lock`;

    const writerAHold = deferred<void>();
    const releaseWriterA = deferred<void>();
    const storeA = createFileWorkspaceHookTrustStore({
      filePath,
      beforeRename: async () => {
        writerAHold.resolve();
        await releaseWriterA.promise;
      },
    });
    const grantA = storeA.grant([record("/ws/owner-a", DIGEST_A)]);
    await writerAHold.promise;

    const lockOfB = `${JSON.stringify({ pid: DEAD_PID, token: "owner-b-token" })}\n`;
    await writeFile(lockPath, lockOfB, "utf8");

    releaseWriterA.resolve();
    await grantA;

    const lockContent = await readFile(lockPath, "utf8");
    expect(lockContent).toBe(lockOfB);
  });

  it("契约 2a：超龄但持有进程存活的锁不得被回收（暂停 ≠ 死亡）", async () => {
    const dir = await root();
    const filePath = join(dir, "workspace-hook-trust-v1.json");
    const lockPath = `${filePath}.lock`;

    await writeFile(
      lockPath,
      `${JSON.stringify({ pid: process.pid, token: "slow-but-alive" })}\n`,
      "utf8",
    );
    await ageLockBeyond(lockPath, 5_000);

    const storeB = createFileWorkspaceHookTrustStore({
      filePath,
      staleLockMs: 5_000,
      lockTimeoutMs: 300,
    });
    await expect(storeB.grant([record("/ws/owner-b", DIGEST_A)])).rejects.toThrow(
      /Timed out acquiring/,
    );
    expect(await readFile(lockPath, "utf8")).toContain("slow-but-alive");
  });

  it("契约 2b：持有进程已死亡的超龄锁正常回收，mutation 不被卡死", async () => {
    const dir = await root();
    const filePath = join(dir, "workspace-hook-trust-v1.json");
    const lockPath = `${filePath}.lock`;

    await writeFile(
      lockPath,
      `${JSON.stringify({ pid: DEAD_PID, token: "dead-owner" })}\n`,
      "utf8",
    );
    await ageLockBeyond(lockPath, 5_000);

    const storeB = createFileWorkspaceHookTrustStore({
      filePath,
      staleLockMs: 5_000,
      lockTimeoutMs: 5_000,
    });
    await storeB.grant([record("/ws/owner-b", DIGEST_A)]);

    const loaded = await storeB.load();
    expect(loaded.status).toBe("ok");
    await expect(stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("契约 2c：旧版本空锁（无 pid 可查）超龄后仍按无主回收，升级不卡死", async () => {
    const dir = await root();
    const filePath = join(dir, "workspace-hook-trust-v1.json");
    const lockPath = `${filePath}.lock`;

    await writeFile(lockPath, "", "utf8");
    await ageLockBeyond(lockPath, 5_000);

    const store = createFileWorkspaceHookTrustStore({
      filePath,
      staleLockMs: 5_000,
      lockTimeoutMs: 5_000,
    });
    await store.grant([record("/ws/upgraded", DIGEST_A)]);
    await expect(stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("并发 grant/revoke 多 writer：已撤销的记录不得被旧 grant 快照恢复", async () => {
    const dir = await root();
    const filePath = join(dir, "workspace-hook-trust-v1.json");

    const seed = createFileWorkspaceHookTrustStore({ filePath });
    await seed.grant([record("/ws/victim", DIGEST_A)]);

    const writers = ["/ws/w1", "/ws/w2", "/ws/w3"].map((identity, index) =>
      createFileWorkspaceHookTrustStore({
        filePath,
        staleLockMs: 1,
        lockTimeoutMs: 10_000,
      }).grant([record(identity, `${String(index + 1).repeat(64)}`)]),
    );
    const revoker = createFileWorkspaceHookTrustStore({
      filePath,
      staleLockMs: 1,
      lockTimeoutMs: 10_000,
    }).revoke({ workspaceIdentity: "/ws/victim" });

    await Promise.all([...writers, revoker]);

    const final = await createFileWorkspaceHookTrustStore({ filePath }).load();
    expect(final.status).toBe("ok");
    if (final.status !== "ok") return;
    expect(final.records.some((item) => item.workspaceIdentity === "/ws/victim")).toBe(false);
    expect(final.records).toHaveLength(3);
  });
});
