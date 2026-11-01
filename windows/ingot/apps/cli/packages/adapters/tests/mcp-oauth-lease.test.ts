import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSharedCfCredentialStore } from "../src/auth/shared-credentials.js";
import {
  deletePendingAuthorizationIfOwned,
  loadPendingAuthorization,
  publishPendingAuthorization,
  resolveAuthorizationLeasePath,
  tryAcquireAuthorizationLease,
} from "../src/mcp/oauth-lease.js";

const KEY_PREFIX = "mcp:oauth:c50fd1fa63fb88a233be0688";
const temporaryDirectories: string[] = [];
const spawnedPids: number[] = [];

afterEach(async () => {
  for (const pid of spawnedPids.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
    }
  }
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function createCredentialsPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "cf-mcp-oauth-lease-"));
  temporaryDirectories.push(directory);
  return join(directory, "credentials.json");
}

async function spawnIdleProcess(): Promise<number> {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60_000)"], {
    stdio: "ignore",
  });
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  const pid = child.pid;
  if (pid === undefined) throw new Error("Failed to spawn helper process");
  spawnedPids.push(pid);
  return pid;
}

async function writeForeignLease(leasePath: string, pid: number): Promise<void> {
  const lockDirectory = `${leasePath}.lock`;
  await mkdir(lockDirectory, { recursive: true });
  await writeFile(
    join(lockDirectory, `owner-${pid}-foreign.json`),
    `${JSON.stringify({ pid, createdAt: Date.now(), token: `${pid}-foreign` })}\n`,
    "utf-8",
  );
}

describe("MCP OAuth authorization lease", () => {
  it("uses a lease path whose basename is legal on Windows", async () => {
    const credentialsPath = await createCredentialsPath();
    const leasePath = resolveAuthorizationLeasePath(credentialsPath, KEY_PREFIX);

    expect(leasePath).not.toContain(":");
    expect(leasePath.endsWith(".authz")).toBe(true);
  });

  it("grants the lease to exactly one holder and releases it again", async () => {
    const credentialsPath = await createCredentialsPath();
    const first = await tryAcquireAuthorizationLease({
      credentialsFilePath: credentialsPath,
      keyPrefix: KEY_PREFIX,
    });
    expect(first).toBeDefined();

    const second = await tryAcquireAuthorizationLease({
      credentialsFilePath: credentialsPath,
      keyPrefix: KEY_PREFIX,
    });
    expect(second).toBeUndefined();

    await first?.release();
    const third = await tryAcquireAuthorizationLease({
      credentialsFilePath: credentialsPath,
      keyPrefix: KEY_PREFIX,
    });
    expect(third).toBeDefined();
    expect(third?.attemptId).not.toBe(first?.attemptId);
    await third?.release();
  });

  it("does not steal a lease held by a live process, and reclaims it once that process dies", async () => {
    const credentialsPath = await createCredentialsPath();
    const leasePath = resolveAuthorizationLeasePath(credentialsPath, KEY_PREFIX);
    const holderPid = await spawnIdleProcess();
    await writeForeignLease(leasePath, holderPid);

    const contended = await tryAcquireAuthorizationLease({
      credentialsFilePath: credentialsPath,
      keyPrefix: KEY_PREFIX,
    });
    expect(contended).toBeUndefined();

    process.kill(holderPid, "SIGKILL");
    await new Promise((resolve) => setTimeout(resolve, 50));

    const reclaimed = await tryAcquireAuthorizationLease({
      credentialsFilePath: credentialsPath,
      keyPrefix: KEY_PREFIX,
    });
    expect(reclaimed).toBeDefined();
    await reclaimed?.release();
    await expect(readdir(`${leasePath}.lock`)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("MCP OAuth pending authorization record", () => {
  it("only lets the owning attempt delete the pending record", async () => {
    const credentialsPath = await createCredentialsPath();
    const credentialStore = createSharedCfCredentialStore({
      env: { CF_CREDENTIAL_SECRET: "mcp-oauth-pending-secret" },
      filePath: credentialsPath,
    });
    await publishPendingAuthorization(credentialStore, KEY_PREFIX, {
      attemptId: "attempt-new",
      authorizationUrl: "https://auth.example.test/authorize?state=new",
      baselineGeneration: "generation-0",
      expiresAt: Date.now() + 60_000,
      state: "state-new",
    });

    await expect(
      deletePendingAuthorizationIfOwned(credentialStore, KEY_PREFIX, "attempt-stale"),
    ).resolves.toBe(false);
    await expect(loadPendingAuthorization(credentialStore, KEY_PREFIX)).resolves.toMatchObject({
      attemptId: "attempt-new",
      authorizationUrl: "https://auth.example.test/authorize?state=new",
    });

    await expect(
      deletePendingAuthorizationIfOwned(credentialStore, KEY_PREFIX, "attempt-new"),
    ).resolves.toBe(true);
    await expect(loadPendingAuthorization(credentialStore, KEY_PREFIX)).resolves.toBeUndefined();
  });

  it("hides an expired pending record without deleting it", async () => {
    const credentialsPath = await createCredentialsPath();
    const credentialStore = createSharedCfCredentialStore({
      env: { CF_CREDENTIAL_SECRET: "mcp-oauth-pending-expiry-secret" },
      filePath: credentialsPath,
    });
    await publishPendingAuthorization(credentialStore, KEY_PREFIX, {
      attemptId: "attempt-expired",
      authorizationUrl: "https://auth.example.test/authorize?state=expired",
      expiresAt: Date.now() - 1,
      state: "state-expired",
    });

    await expect(loadPendingAuthorization(credentialStore, KEY_PREFIX)).resolves.toBeUndefined();
    await expect(
      deletePendingAuthorizationIfOwned(credentialStore, KEY_PREFIX, "attempt-other"),
    ).resolves.toBe(false);
    await expect(
      deletePendingAuthorizationIfOwned(credentialStore, KEY_PREFIX, "attempt-expired"),
    ).resolves.toBe(true);
  });
});
