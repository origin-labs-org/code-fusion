import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HookEventName, createWorkspaceHookBundleSnapshot } from "@origin-ai/cf-contracts";
import type { Logger } from "@origin-ai/cf-contracts";
import { createWorkspaceHookRuntimeSecurity } from "../src/app/workspace-hook-trust.js";

const WORKSPACE = "local:/workspace";
const BUNDLE = "c".repeat(64);
const DIGEST_A = "a".repeat(64);

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => logger,
};

describe("createWorkspaceHookRuntimeSecurity reloadTrust", () => {
  const cleanup: (() => Promise<void>)[] = [];

  afterEach(async () => {
    await Promise.all(cleanup.splice(0).map((fn) => fn()));
  });

  async function tempHome(): Promise<{ homeDir: string; storePath: string }> {
    const homeDir = await mkdtemp(join(tmpdir(), "hook-trust-reload-"));
    cleanup.push(async () => {
      const { rm } = await import("node:fs/promises");
      await rm(homeDir, { recursive: true, force: true });
    });
    const { mkdir } = await import("node:fs/promises");
    const securityDir = join(homeDir, ".cf", "security");
    await mkdir(securityDir, { recursive: true });
    const storePath = join(securityDir, "workspace-hook-trust-v1.json");
    await writeFile(storePath, JSON.stringify({ schemaVersion: 1, records: [] }), "utf8");
    return { homeDir, storePath };
  }

  function snapshot() {
    return createWorkspaceHookBundleSnapshot({
      schemaVersion: 1,
      workspaceIdentity: WORKSPACE,
      discoveredAt: "2026-08-06T00:00:00.000Z",
      digestAlgorithm: "sha256",
      bundleDigest: BUNDLE,
      sourceFiles: [
        {
          canonicalPath: "/workspace/.cf/config.json",
          baseDir: "/workspace",
          discoveryOrder: 0,
          configFileKind: ".cf/config.json",
          explicitProjectConfig: false,
          editable: true,
          hooksRoot: { enabled: true },
        },
      ],
      hooks: [
        {
          reviewItemId: "item-0",
          event: HookEventName.SessionStart,
          matcherIndex: 0,
          hookIndex: 0,
          sourceFileIndex: 0,
          sourceRelativePath: ".cf/config.json",
          matcher: "startup",
          type: "command",
          command: "echo project",
          resolvedTimeoutMs: 60_000,
          resolvedMaxOutputBytes: 32_768,
          declarationEnabled: true,
          sourceRootEnabled: true,
          runtimeHooksEnabled: true,
          configuredEnabled: true,
          editable: true,
          declarationDigestAlgorithm: "sha256",
          hookDeclarationDigest: DIGEST_A,
        },
      ],
    });
  }

  it("reloads externally granted trust into the live admission and re-emits state", async () => {
    const { homeDir, storePath } = await tempHome();
    const userConfigPath = join(homeDir, ".cf", "cli", "config.json");

    const emitted: Array<{ pendingCount: number }> = [];
    const security = createWorkspaceHookRuntimeSecurity({
      emitAdmissionEvent: async (event) => {
        emitted.push({ pendingCount: event.payload.pendingCount });
      },
      homeDir,
      logger,
      runtimeRoot: { enabled: true },
      sessionId: "sess_test",
      snapshot: snapshot(),
      userConfigPath,
      workspaceHookTrustEnabled: true,
      workingDirectory: "/workspace",
    });
    if (!security) throw new Error("security not created");

    await security.admission.activate("startup");
    expect(emitted.at(-1)?.pendingCount).toBe(1);

    const grantTime = new Date().toISOString();
    await writeFile(
      storePath,
      JSON.stringify({
        schemaVersion: 1,
        records: [
          {
            workspaceIdentity: WORKSPACE,
            hookDeclarationDigest: DIGEST_A,
            digestAlgorithm: "sha256",
            decision: "trusted",
            grantedAt: grantTime,
            bundleDigestAtGrant: BUNDLE,
            eventAtGrant: "SessionStart",
            displayCommandAtGrant: "echo project",
            sourcePathAtGrant: ".cf/config.json",
            sourceDiscoveryOrderAtGrant: 0,
            matcherAtGrant: "startup",
            matcherIndexAtGrant: 0,
            hookIndexAtGrant: 0,
          },
        ],
      }),
      "utf8",
    );

    await security.reloadTrust();

    expect(emitted.at(-1)?.pendingCount).toBe(0);
    expect(
      security.admission.evaluateDispatch({
        reviewItemId: "item-0",
        hookDeclarationDigest: DIGEST_A,
        bundleDigest: BUNDLE,
      }),
    ).toEqual({ allowed: true });

    const after = JSON.parse(await readFile(storePath, "utf8"));
    expect(after.records).toHaveLength(1);
  });

  it("is a safe no-op when the trust feature is disabled", async () => {
    const { homeDir } = await tempHome();
    const security = createWorkspaceHookRuntimeSecurity({
      homeDir,
      logger,
      runtimeRoot: { enabled: true },
      sessionId: "sess_test",
      snapshot: snapshot(),
      userConfigPath: join(homeDir, ".cf", "cli", "config.json"),
      workspaceHookTrustEnabled: false,
      workingDirectory: "/workspace",
    });
    if (!security) throw new Error("security not created");
    await expect(security.reloadTrust()).resolves.toBeUndefined();
  });
});
