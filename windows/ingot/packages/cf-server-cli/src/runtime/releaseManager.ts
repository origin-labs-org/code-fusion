import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { releaseManifestSchema, type ReleaseManifest } from "../contracts.js";
import type { ServerLayout } from "./paths.js";
import { ensureServerInstallOwnership } from "./installationOwnership.js";

interface UpdateTransaction {
  previous: ReleaseManifest | null;
}

async function renameWithWindowsRetry(temporary: string, path: string): Promise<void> {
  const maxAttempts = process.platform === "win32" ? 5 : 1;
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rename(temporary, path);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | null)?.code;
      if (attempt >= maxAttempts || (code !== "EPERM" && code !== "EBUSY")) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 10 * attempt));
    }
  }
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await renameWithWindowsRetry(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

export class ReleaseManager {
  public constructor(private readonly layout: ServerLayout) {}

  public async ensure(): Promise<void> {
    await Promise.all([
      mkdir(this.layout.serverRoot, { recursive: true, mode: 0o700 }),
      mkdir(this.layout.releasesDir, { recursive: true, mode: 0o700 }),
      mkdir(this.layout.runDir, { recursive: true, mode: 0o700 }),
    ]);
    await ensureServerInstallOwnership(this.layout);
  }

  public async beginUpdate(previous: ReleaseManifest | null): Promise<void> {
    await atomicWriteJson(this.layout.updateTransactionFile, { previous });
  }

  public async completeUpdate(): Promise<void> {
    await rm(this.layout.updateTransactionFile, { force: true });
  }

  public async applyPendingWithTransaction(
    previous: ReleaseManifest | null,
  ): Promise<ReleaseManifest> {
    await this.beginUpdate(previous);
    return await this.applyPending();
  }

  public async recoverInterruptedUpdate(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.layout.updateTransactionFile, "utf8");
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
      throw error;
    }
    let transaction: UpdateTransaction;
    try {
      const parsed = JSON.parse(raw) as { previous?: unknown };
      transaction = {
        previous: parsed.previous === null ? null : releaseManifestSchema.parse(parsed.previous),
      };
    } catch (error: unknown) {
      throw new Error(`Update transaction is invalid: ${this.layout.updateTransactionFile}`, {
        cause: error,
      });
    }
    await this.restoreCurrent(transaction.previous);
    await this.completeUpdate();
  }

  public async readCurrent(): Promise<ReleaseManifest | null> {
    return await this.readManifest(this.layout.currentFile);
  }

  public async readCurrentForExecution(): Promise<ReleaseManifest | null> {
    const manifest = await this.readCurrent();
    if (!manifest) return null;
    await this.assertReleaseDir(manifest);
    return manifest;
  }

  public async readPending(): Promise<ReleaseManifest | null> {
    return await this.readManifest(this.layout.pendingFile);
  }

  public async removePending(): Promise<void> {
    await rm(this.layout.pendingFile, { force: true });
  }

  public async writePending(manifest: ReleaseManifest): Promise<void> {
    const parsed = releaseManifestSchema.parse({
      ...manifest,
      releaseDir: resolve(manifest.releaseDir),
    });
    await this.assertReleaseDir(parsed);
    await atomicWriteJson(this.layout.pendingFile, parsed);
  }

  public async applyPending(): Promise<ReleaseManifest> {
    const pending = await this.readPending();
    if (!pending) {
      throw new Error("No pending release is prepared");
    }
    await this.assertReleaseDir(pending);
    await atomicWriteJson(this.layout.currentFile, pending);
    await rm(this.layout.pendingFile, { force: true });
    return pending;
  }

  public async restoreCurrent(manifest: ReleaseManifest | null): Promise<void> {
    if (manifest) {
      await this.assertReleaseDir(manifest);
      await atomicWriteJson(this.layout.currentFile, manifest);
      return;
    }
    await rm(this.layout.currentFile, { force: true });
  }

  private async readManifest(path: string): Promise<ReleaseManifest | null> {
    try {
      const raw = await readFile(path, "utf8");
      return releaseManifestSchema.parse(JSON.parse(raw));
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
  }

  private async assertReleaseDir(manifest: ReleaseManifest): Promise<void> {
    const releaseDir = resolve(manifest.releaseDir);
    const canonicalReleaseDir = await realpath(releaseDir).catch(() => releaseDir);
    const canonicalReleasesDir = await realpath(this.layout.releasesDir).catch(() =>
      resolve(this.layout.releasesDir),
    );
    if (
      !canonicalReleaseDir.startsWith(
        `${canonicalReleasesDir}${process.platform === "win32" ? "\\" : "/"}`,
      )
    ) {
      throw new Error("Release directory must be inside the server releases directory");
    }
    const releaseStat = await stat(releaseDir).catch(() => null);
    if (!releaseStat?.isDirectory()) {
      throw new Error(`Release directory does not exist: ${releaseDir}`);
    }
  }
}
