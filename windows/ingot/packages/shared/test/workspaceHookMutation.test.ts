import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildWorkspaceHookBundleSnapshot,
  createWorkspaceHookSourceInput,
} from "../src/workspace-hook-discovery.js";
import {
  atomicWriteWorkspaceHookConfig,
  writeWorkspaceHookConfiguredToggle,
} from "../src/workspace-hook-mutation.js";

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "workspace-hook-mutation-"));
  roots.push(root);
  return root;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("workspace Hook atomic mutation", () => {
  it("Only modify the enabled gate of the declaration pointed to by snapshot, retaining other config and passthrough fields", async () => {
    const workspace = makeRoot();
    const configPath = join(workspace, ".cf", "config.json");
    const original = {
      model: "model-test",
      customTopLevel: { keep: true },
      hooks: {
        enabled: true,
        timeoutMs: 1234,
        events: {
          SessionStart: [
            {
              hooks: [
                {
                  type: "command",
                  command: "echo first",
                  enabled: true,
                  customHookField: { keep: "yes" },
                },
                {
                  type: "process",
                  command: "node",
                  args: ["second.mjs"],
                  enabled: true,
                },
              ],
            },
          ],
        },
      },
    };
    writeJson(configPath, original);
    const source = createWorkspaceHookSourceInput({
      path: configPath,
      workingDirectory: workspace,
      hooks: original.hooks,
      discoveryOrder: 0,
      explicitProjectConfig: false,
    });
    const snapshot = buildWorkspaceHookBundleSnapshot({
      workspaceIdentity: "workspace:test",
      workspacePath: workspace,
      sources: [source],
      runtimeRoot: { enabled: true, timeoutMs: 60_000, maxOutputBytes: 32_768 },
    });

    await writeWorkspaceHookConfiguredToggle({
      configPath,
      snapshot,
      reviewItemId: snapshot.hooks[1]!.reviewItemId,
      enabled: false,
    });

    const saved = JSON.parse(readFileSync(configPath, "utf8"));
    expect(saved).toEqual({
      ...original,
      hooks: {
        ...original.hooks,
        events: {
          SessionStart: [
            {
              hooks: [
                original.hooks.events.SessionStart[0]!.hooks[0],
                {
                  ...original.hooks.events.SessionStart[0]!.hooks[1],
                  enabled: false,
                },
              ],
            },
          ],
        },
      },
    });
  });

  it("拒绝 snapshot 中非当前 .cf/config.json 或非 editable declaration，且不写文件", async () => {
    const workspace = makeRoot();
    const configPath = join(workspace, ".cf", "config.json");
    const ancestorPath = join(workspace, "cf.json");
    const config = {
      hooks: {
        enabled: true,
        events: {
          Stop: [{ hooks: [{ type: "command" as const, command: "echo readonly" }] }],
        },
      },
    };
    writeJson(ancestorPath, config);
    writeJson(configPath, { hooks: { enabled: true, events: {} } });
    const source = createWorkspaceHookSourceInput({
      path: ancestorPath,
      workingDirectory: workspace,
      hooks: config.hooks,
      discoveryOrder: 0,
      explicitProjectConfig: false,
    });
    const snapshot = buildWorkspaceHookBundleSnapshot({
      workspaceIdentity: "workspace:test",
      workspacePath: workspace,
      sources: [source],
      runtimeRoot: { enabled: true, timeoutMs: 60_000, maxOutputBytes: 32_768 },
    });
    const before = readFileSync(configPath, "utf8");

    await expect(
      writeWorkspaceHookConfiguredToggle({
        configPath,
        snapshot,
        reviewItemId: snapshot.hooks[0]!.reviewItemId,
        enabled: false,
      }),
    ).rejects.toMatchObject({ code: "workspace_hooks_snapshot_mismatch" });
    expect(readFileSync(configPath, "utf8")).toBe(before);
  });

  it("Reject approving A/modifying B when disk declaration has changed", async () => {
    const workspace = makeRoot();
    const configPath = join(workspace, ".cf", "config.json");
    const hooks = {
      enabled: true,
      events: {
        Stop: [{ hooks: [{ type: "command" as const, command: "echo before" }] }],
      },
    };
    writeJson(configPath, { hooks });
    const source = createWorkspaceHookSourceInput({
      path: configPath,
      workingDirectory: workspace,
      hooks,
      discoveryOrder: 0,
      explicitProjectConfig: false,
    });
    const snapshot = buildWorkspaceHookBundleSnapshot({
      workspaceIdentity: "workspace:test",
      workspacePath: workspace,
      sources: [source],
      runtimeRoot: { enabled: true, timeoutMs: 60_000, maxOutputBytes: 32_768 },
    });
    writeJson(configPath, {
      hooks: {
        ...hooks,
        events: {
          Stop: [{ hooks: [{ type: "command", command: "echo changed" }] }],
        },
      },
    });

    await expect(
      writeWorkspaceHookConfiguredToggle({
        configPath,
        snapshot,
        reviewItemId: snapshot.hooks[0]!.reviewItemId,
        enabled: false,
      }),
    ).rejects.toMatchObject({ code: "workspace_hooks_snapshot_mismatch" });
    expect(readFileSync(configPath, "utf8")).toContain("echo changed");
  });

  it("Known boundary: root default changes do not trigger declaration mismatch (admission side still evaluates against current snapshot)", async () => {
    const workspace = makeRoot();
    const configPath = join(workspace, ".cf", "config.json");
    const hooks = {
      enabled: true,
      timeoutMs: 5000,
      events: {
        Stop: [{ hooks: [{ type: "command" as const, command: "echo boundary" }] }],
      },
    };
    writeJson(configPath, { hooks });
    const source = createWorkspaceHookSourceInput({
      path: configPath,
      workingDirectory: workspace,
      hooks,
      discoveryOrder: 0,
      explicitProjectConfig: false,
    });
    const snapshot = buildWorkspaceHookBundleSnapshot({
      workspaceIdentity: "workspace:test",
      workspacePath: workspace,
      sources: [source],
      runtimeRoot: { enabled: true, timeoutMs: 5000, maxOutputBytes: 32_768 },
    });

    writeJson(configPath, {
      hooks: { ...hooks, timeoutMs: 99_999 },
    });

    await expect(
      writeWorkspaceHookConfiguredToggle({
        configPath,
        snapshot,
        reviewItemId: snapshot.hooks[0]!.reviewItemId,
        enabled: false,
      }),
    ).resolves.toBeUndefined();

    const saved = JSON.parse(readFileSync(configPath, "utf8"));
    expect(saved.hooks.timeoutMs).toBe(99_999);
    expect(saved.hooks.events.Stop[0]!.hooks[0]!.enabled).toBe(false);
  });

  it("Retain original file and clean up temp file on failure before rename", async () => {
    const workspace = makeRoot();
    const configPath = join(workspace, ".cf", "config.json");
    writeJson(configPath, { hooks: { enabled: false, events: {} } });

    await expect(
      atomicWriteWorkspaceHookConfig(
        configPath,
        { hooks: { enabled: true, events: {} } },
        {
          beforeRename() {
            throw new Error("injected failure");
          },
        },
      ),
    ).rejects.toThrow("injected failure");

    expect(JSON.parse(readFileSync(configPath, "utf8"))).toEqual({
      hooks: { enabled: false, events: {} },
    });
    await expect(readdir(join(workspace, ".cf"))).resolves.toEqual(["config.json"]);
  });
});
