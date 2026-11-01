import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  discoverWorkspaceHookConfigPaths,
  readWorkspaceHookProjectSources,
} from "../src/workspace-hook-discovery.js";

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "cf-hook-dedup-"));
  roots.push(root);
  return root;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("workspace hook config discovery deduplication (#10)", () => {
  it("Keep only one entry when explicit path overlaps with auto-discovery", () => {
    const workspace = makeRoot();
    mkdirSync(join(workspace, ".git"));
    const configPath = join(workspace, ".cf", "config.json");
    writeJson(configPath, {
      hooks: {
        enabled: true,
        events: {
          SessionStart: [{ hooks: [{ type: "command", command: "echo hello" }] }],
        },
      },
    });

    const withoutExplicit = discoverWorkspaceHookConfigPaths({
      workingDirectory: workspace,
    });
    expect(withoutExplicit).toHaveLength(1);
    expect(withoutExplicit[0]?.explicitProjectConfig).toBe(false);

    const withExplicit = discoverWorkspaceHookConfigPaths({
      workingDirectory: workspace,
      explicitProjectConfigPath: configPath,
    });
    expect(withExplicit).toHaveLength(1);
    expect(withExplicit[0]?.explicitProjectConfig).toBe(false);
    expect(withExplicit[0]?.path).toBe(configPath);
  });

  it("Append normally when explicit path points to a file not discovered by auto-discovery", () => {
    const workspace = makeRoot();
    mkdirSync(join(workspace, ".git"));
    writeJson(join(workspace, ".cf", "config.json"), {
      hooks: {
        enabled: true,
        events: {
          SessionStart: [{ hooks: [{ type: "command", command: "echo hello" }] }],
        },
      },
    });

    const extraPath = join(workspace, "custom-config.json");
    writeJson(extraPath, {
      hooks: {
        enabled: true,
        events: {
          Stop: [{ hooks: [{ type: "command", command: "echo stop" }] }],
        },
      },
    });

    const refs = discoverWorkspaceHookConfigPaths({
      workingDirectory: workspace,
      explicitProjectConfigPath: extraPath,
    });
    expect(refs).toHaveLength(2);
    expect(refs[0]?.explicitProjectConfig).toBe(false);
    expect(refs[1]?.explicitProjectConfig).toBe(true);
    expect(refs[1]?.path).toBe(extraPath);
  });

  it("Zero-index async discovery and retain source when no explicit path is present", async () => {
    const workspace = makeRoot();
    mkdirSync(join(workspace, ".git"));
    writeJson(join(workspace, ".cf", "config.json"), {
      hooks: {
        enabled: true,
        events: {
          SessionStart: [{ hooks: [{ type: "command", command: "echo hello" }] }],
        },
      },
    });

    const { sources } = await readWorkspaceHookProjectSources({
      workingDirectory: workspace,
    });

    expect(sources).toHaveLength(1);
    expect(sources[0]?.discoveryOrder).toBe(0);
    expect(sources[0]?.explicitProjectConfig).toBe(false);
  });

  it("async discovery also produces only one source when explicit overlaps", async () => {
    const workspace = makeRoot();
    mkdirSync(join(workspace, ".git"));
    const configPath = join(workspace, ".cf", "config.json");
    writeJson(configPath, {
      hooks: {
        enabled: true,
        events: {
          SessionStart: [{ hooks: [{ type: "command", command: "echo hello" }] }],
        },
      },
    });

    const { sources } = await readWorkspaceHookProjectSources({
      workingDirectory: workspace,
      explicitProjectConfigPath: configPath,
    });

    expect(sources).toHaveLength(1);
    expect(sources[0]?.explicitProjectConfig).toBe(false);
    expect(sources[0]?.discoveryOrder).toBe(0);
  });
});
