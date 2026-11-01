import { readFile, stat, writeFile } from "node:fs/promises";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createOpenWorkspaceStartupBootstrap,
  resolveStartupWindowBootstrap,
} from "../src/main/startupWorkspace.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("startup workspace", () => {
  it("New main version only warms up active cwd without reading old session list or recent projects", async () => {
    const root = makeTempDir("cf-startup-active-");
    const selected = join(root, "selected");
    mkdirSync(selected);
    const settingsFile = join(root, "setting.json");
    writeFileSync(
      settingsFile,
      JSON.stringify({
        lastActiveWorkspace: {
          kind: "local",
          workspacePath: selected,
          workspacePurpose: "conversation",
        },
        lastWorkspaceSession: [{ kind: "local", workspacePath: "/deleted" }],
        recentProjects: ["/legacy-recent"],
      }),
    );
    expect(
      await resolveStartupWindowBootstrap({
        settingsFile,
        conversationWorkspaceDir: join(root, "default"),
      }),
    ).toEqual({
      agentWarmupTargets: [{ workspacePath: selected }],
    });
  });
  it("open-workspace cold start directory serves as both first window initial workspace and agent warmup target", () => {
    expect(createOpenWorkspaceStartupBootstrap("C:\\Users\\demo\\Project A")).toEqual({
      initialWorkspacePath: "C:\\Users\\demo\\Project A",
      initialWorkspacePurpose: "project",
      agentWarmupTargets: [{ workspacePath: "C:\\Users\\demo\\Project A" }],
    });
  });

  it("Do not overwrite to default project when there is a recoverable session", async () => {
    const rootDir = makeTempDir("cf-startup-workspace-");
    const settingsFile = join(rootDir, "setting.json");
    const conversationWorkspaceDir = join(rootDir, ".cf", "workspace", "default");
    const workspaceDir = join(rootDir, "workspace-a");
    mkdirSync(workspaceDir);

    writeFileSync(
      settingsFile,
      JSON.stringify({
        recentProjects: [workspaceDir],
        locale: "zh-CN",
        lastWorkspaceSession: [
          {
            kind: "local",
            workspacePath: workspaceDir,
          },
        ],
        lastActiveTabIndex: 0,
      }),
      "utf-8",
    );

    await expect(
      resolveStartupWindowBootstrap({
        settingsFile,
        conversationWorkspaceDir,
      }).then((bootstrap) => bootstrap.initialWorkspacePath),
    ).resolves.toBeUndefined();
    expect(existsSync(conversationWorkspaceDir)).toBe(false);
  });

  it("Return active workspace as agent warmup target when there is a local recoverable session", async () => {
    const rootDir = makeTempDir("cf-startup-workspace-");
    const settingsFile = join(rootDir, "setting.json");
    const conversationWorkspaceDir = join(rootDir, ".cf", "workspace", "default");
    const workspaceA = join(rootDir, "workspace-a");
    const workspaceB = join(rootDir, "workspace-b");
    mkdirSync(workspaceA);
    mkdirSync(workspaceB);

    writeFileSync(
      settingsFile,
      JSON.stringify({
        recentProjects: [workspaceA, workspaceB],
        locale: "zh-CN",
        lastWorkspaceSession: [
          {
            kind: "local",
            workspacePath: workspaceA,
          },
          {
            kind: "local",
            workspacePath: workspaceB,
          },
        ],
        lastActiveTabIndex: 1,
      }),
      "utf-8",
    );

    await expect(
      resolveStartupWindowBootstrap({
        settingsFile,
        conversationWorkspaceDir,
      }),
    ).resolves.toEqual({
      agentWarmupTargets: [{ workspacePath: workspaceB }],
    });
    expect(existsSync(conversationWorkspaceDir)).toBe(false);
  });

  it("active 会话是远端但前面有本地 workspace 时预热本地 workspace", async () => {
    const rootDir = makeTempDir("cf-startup-workspace-");
    const settingsFile = join(rootDir, "setting.json");
    const conversationWorkspaceDir = join(rootDir, ".cf", "workspace", "default");

    writeFileSync(
      settingsFile,
      JSON.stringify({
        recentProjects: ["/tmp/workspace-a"],
        locale: "zh-CN",
        lastWorkspaceSession: [
          {
            kind: "local",
            workspacePath: "/tmp/workspace-a",
          },
          {
            kind: "remote",
            workspacePath: "/repo/app",
            workspaceIdentity: "remote:ssh:dev:/repo/app",
            target: {
              kind: "ssh",
              host: "dev",
              username: "dev",
            },
            lastOpenedAt: 1,
            lastConnectionStatus: "connected",
          },
        ],
        lastActiveTabIndex: 1,
      }),
      "utf-8",
    );

    await expect(
      resolveStartupWindowBootstrap({
        settingsFile,
        conversationWorkspaceDir,
      }),
    ).resolves.toEqual({
      agentWarmupTargets: [{ workspacePath: "/tmp/workspace-a" }],
    });
  });

  it("active 会话是远端但后面有本地 workspace 时预热本地 workspace", async () => {
    const rootDir = makeTempDir("cf-startup-workspace-");
    const settingsFile = join(rootDir, "setting.json");
    const conversationWorkspaceDir = join(rootDir, ".cf", "workspace", "default");

    writeFileSync(
      settingsFile,
      JSON.stringify({
        recentProjects: ["/tmp/workspace-a"],
        locale: "zh-CN",
        lastWorkspaceSession: [
          {
            kind: "remote",
            workspacePath: "/repo/app",
            workspaceIdentity: "remote:ssh:dev:/repo/app",
            target: {
              kind: "ssh",
              host: "dev",
              username: "dev",
            },
            lastOpenedAt: 1,
            lastConnectionStatus: "connected",
          },
          {
            kind: "local",
            workspacePath: "/tmp/workspace-a",
          },
        ],
        lastActiveTabIndex: 0,
      }),
      "utf-8",
    );

    await expect(
      resolveStartupWindowBootstrap({
        settingsFile,
        conversationWorkspaceDir,
      }),
    ).resolves.toEqual({
      agentWarmupTargets: [{ workspacePath: "/tmp/workspace-a" }],
    });
  });

  it("Keep original path and create agent cwd fallback directory when active local workspace does not exist", async () => {
    const rootDir = makeTempDir("cf-startup-workspace-");
    const settingsFile = join(rootDir, "setting.json");
    const conversationWorkspaceDir = join(rootDir, ".cf", "workspace", "default");
    const missingWorkspace = join(rootDir, "moved-workspace");

    writeFileSync(
      settingsFile,
      JSON.stringify({
        lastWorkspaceSession: [{ kind: "local", workspacePath: missingWorkspace }],
        lastActiveTabIndex: 0,
      }),
      "utf-8",
    );

    await expect(
      resolveStartupWindowBootstrap({ settingsFile, conversationWorkspaceDir }),
    ).resolves.toEqual({
      unavailableWorkspacePath: missingWorkspace,
      agentWarmupTargets: [{ workspacePath: missingWorkspace }],
    });
    expect(existsSync(conversationWorkspaceDir)).toBe(true);
    expect(existsSync(missingWorkspace)).toBe(false);
  });

  it("active 本地 workspace 变成文件时按不可用目录处理", async () => {
    const rootDir = makeTempDir("cf-startup-workspace-");
    const settingsFile = join(rootDir, "setting.json");
    const conversationWorkspaceDir = join(rootDir, ".cf", "workspace", "default");
    const workspaceFile = join(rootDir, "workspace-file");
    writeFileSync(workspaceFile, "not-a-directory", "utf-8");
    writeFileSync(
      settingsFile,
      JSON.stringify({
        lastWorkspaceSession: [{ kind: "local", workspacePath: workspaceFile }],
        lastActiveTabIndex: 0,
      }),
      "utf-8",
    );

    await expect(
      resolveStartupWindowBootstrap({ settingsFile, conversationWorkspaceDir }),
    ).resolves.toEqual({
      unavailableWorkspacePath: workspaceFile,
      agentWarmupTargets: [{ workspacePath: workspaceFile }],
    });
    expect(existsSync(conversationWorkspaceDir)).toBe(true);
  });

  it.runIf(process.platform !== "win32" && process.getuid?.() !== 0)(
    "active 本地 workspace 无法访问时按不可用目录处理",
    async () => {
      const rootDir = makeTempDir("cf-startup-workspace-");
      const settingsFile = join(rootDir, "setting.json");
      const conversationWorkspaceDir = join(rootDir, ".cf", "workspace", "default");
      const inaccessibleWorkspace = join(rootDir, "inaccessible-workspace");
      mkdirSync(inaccessibleWorkspace);
      chmodSync(inaccessibleWorkspace, 0o000);
      writeFileSync(
        settingsFile,
        JSON.stringify({
          lastWorkspaceSession: [{ kind: "local", workspacePath: inaccessibleWorkspace }],
          lastActiveTabIndex: 0,
        }),
        "utf-8",
      );

      try {
        await expect(
          resolveStartupWindowBootstrap({ settingsFile, conversationWorkspaceDir }),
        ).resolves.toEqual({
          unavailableWorkspacePath: inaccessibleWorkspace,
          agentWarmupTargets: [{ workspacePath: inaccessibleWorkspace }],
        });
        expect(existsSync(conversationWorkspaceDir)).toBe(true);
      } finally {
        chmodSync(inaccessibleWorkspace, 0o700);
      }
    },
  );

  it.each(["active", "legacy"])(
    "Remote active item (%s) prepares local storage cwd first, keeping remote navigation without creating remote project path",
    async (format) => {
      const rootDir = makeTempDir("cf-startup-remote-");
      const settingsFile = join(rootDir, "setting.json");
      const conversationWorkspaceDir = join(rootDir, "new-data", ".cf", "workspace", "default");
      const remotePath = join(rootDir, "remote-only-project");
      const entry = {
        kind: "remote",
        workspacePath: remotePath,
        workspaceIdentity: `remote:server:source-1:${remotePath}`,
        target: { kind: "ssh", host: "dev.example.com", username: "dev" },
        lastOpenedAt: 1,
        lastConnectionStatus: "connected",
      };
      await writeFile(
        settingsFile,
        JSON.stringify(
          format === "active"
            ? { lastActiveWorkspace: entry }
            : { lastWorkspaceSession: [entry], lastActiveTabIndex: 0 },
        ),
      );
      await expect(
        resolveStartupWindowBootstrap({ settingsFile, conversationWorkspaceDir }),
      ).resolves.toEqual({});
      expect((await stat(conversationWorkspaceDir)).isDirectory()).toBe(true);
      await expect(stat(remotePath)).rejects.toMatchObject({ code: "ENOENT" });
      const canary = join(conversationWorkspaceDir, "keep.txt");
      await writeFile(canary, "existing data");
      await expect(
        resolveStartupWindowBootstrap({ settingsFile, conversationWorkspaceDir }),
      ).resolves.toEqual({});
      expect(await readFile(canary, "utf8")).toBe("existing data");
    },
  );

  it("Fail explicitly when remote active item storage cwd cannot be created; do not return false startup readiness", async () => {
    const rootDir = makeTempDir("cf-startup-remote-blocked-");
    const settingsFile = join(rootDir, "setting.json");
    const conversationWorkspaceDir = join(rootDir, "default");
    await writeFile(conversationWorkspaceDir, "existing file");
    await writeFile(
      settingsFile,
      JSON.stringify({
        lastActiveWorkspace: {
          kind: "remote",
          workspacePath: "/srv/project",
          workspaceIdentity: "remote:server:source-1:/srv/project",
          target: { kind: "ssh", host: "dev.example.com", username: "dev" },
          lastOpenedAt: 1,
          lastConnectionStatus: "connected",
        },
      }),
    );
    await expect(
      resolveStartupWindowBootstrap({ settingsFile, conversationWorkspaceDir }),
    ).rejects.toThrow();
    expect(await readFile(conversationWorkspaceDir, "utf8")).toBe("existing file");
  });

  it("Only active local workspace participates in availability validation", async () => {
    const rootDir = makeTempDir("cf-startup-workspace-");
    const settingsFile = join(rootDir, "setting.json");
    const conversationWorkspaceDir = join(rootDir, ".cf", "workspace", "default");
    const activeWorkspace = join(rootDir, "active-workspace");
    const inactiveMissingWorkspace = join(rootDir, "inactive-missing");
    mkdirSync(activeWorkspace);
    writeFileSync(
      settingsFile,
      JSON.stringify({
        lastWorkspaceSession: [
          { kind: "local", workspacePath: inactiveMissingWorkspace },
          { kind: "local", workspacePath: activeWorkspace },
        ],
        lastActiveTabIndex: 1,
      }),
      "utf-8",
    );

    await expect(
      resolveStartupWindowBootstrap({ settingsFile, conversationWorkspaceDir }),
    ).resolves.toEqual({ agentWarmupTargets: [{ workspacePath: activeWorkspace }] });
    expect(existsSync(conversationWorkspaceDir)).toBe(false);
  });

  it("Fallback directly to conversation backing workspace when there is no recoverable session", async () => {
    const rootDir = makeTempDir("cf-startup-workspace-");
    const settingsFile = join(rootDir, "setting.json");
    const conversationWorkspaceDir = join(rootDir, ".cf", "workspace", "default");

    writeFileSync(
      settingsFile,
      JSON.stringify({
        recentProjects: ["/tmp/workspace-a"],
        locale: "zh-CN",
        lastWorkspaceSession: [],
        lastActiveTabIndex: 0,
      }),
      "utf-8",
    );

    await expect(
      resolveStartupWindowBootstrap({
        settingsFile,
        conversationWorkspaceDir,
      }).then((bootstrap) => bootstrap.initialWorkspacePath),
    ).resolves.toBe(conversationWorkspaceDir);
    expect(existsSync(conversationWorkspaceDir)).toBe(true);
  });

  it("conversation workspace is also agent warmup target when there is no recoverable session", async () => {
    const rootDir = makeTempDir("cf-startup-workspace-");
    const settingsFile = join(rootDir, "setting.json");
    const conversationWorkspaceDir = join(rootDir, ".cf", "workspace", "default");

    writeFileSync(
      settingsFile,
      JSON.stringify({
        recentProjects: [],
        locale: "zh-CN",
        lastWorkspaceSession: [],
        lastActiveTabIndex: 0,
      }),
      "utf-8",
    );

    await expect(
      resolveStartupWindowBootstrap({
        settingsFile,
        conversationWorkspaceDir,
      }),
    ).resolves.toEqual({
      initialWorkspacePath: conversationWorkspaceDir,
      initialWorkspacePurpose: "conversation",
      agentWarmupTargets: [{ workspacePath: conversationWorkspaceDir }],
    });
    expect(existsSync(conversationWorkspaceDir)).toBe(true);
  });
});
