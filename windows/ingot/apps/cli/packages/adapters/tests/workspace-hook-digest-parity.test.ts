import { mkdtempSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createConfig } from "../src/config/index.js";
import {
  buildWorkspaceHookBundleSnapshot,
  readWorkspaceHookProjectSources,
  resolveWorkspaceHookRuntimeRoot,
  workspaceHooksConfigSchema,
  type WorkspaceHooksConfig,
} from "@origin-ai/cf-shared/workspace-hook-discovery";

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "cf-hook-runtime-parity-"));
  roots.push(root);
  return root;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJsonIfDefined(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("workspace hook Settings/Runtime dual builder digest parity (D17 runtime entry)", () => {
  it("Runtime createConfig snapshot 与 Settings 装配公式产出一致 digest", async () => {
    const home = makeRoot();
    const workspace = makeRoot();
    await mkdir(join(workspace, ".git"));
    const userConfigPath = join(home, ".cf", "cli", "config.json");
    await writeJson(userConfigPath, { hooks: { enabled: true, timeoutMs: 30_000 } });
    await writeJson(join(workspace, "cf.json"), {
      hooks: {
        enabled: true,
        events: {
          Stop: [
            {
              matcher: ".*",
              hooks: [{ type: "command", command: "echo parity-root", async: true }],
            },
          ],
        },
      },
    });
    await writeJson(join(workspace, ".cf", "config.json"), {
      hooks: {
        enabled: true,
        events: {
          SessionStart: [
            { hooks: [{ type: "process", command: "node", args: ["hook.mjs"], timeoutMs: 5_000 }] },
          ],
        },
      },
    });

    const result = createConfig({
      env: {},
      projectConfigPath: undefined,
      skipUserConfig: false,
      userConfigPath,
      workingDirectory: workspace,
      workspaceIdentity: workspace,
    });
    const runtimeSnapshot = result.sources.project.workspaceHookSnapshot;
    expect(runtimeSnapshot).toBeDefined();

    const { sources: projectSources } = await readWorkspaceHookProjectSources({
      workingDirectory: workspace,
    });
    expect(projectSources.length).toBeGreaterThan(0);
    const userFile = (await readJsonIfDefined(userConfigPath)) as { hooks?: unknown } | undefined;
    const parsedUser = workspaceHooksConfigSchema.safeParse(userFile?.hooks);
    const userHooks: WorkspaceHooksConfig | undefined = parsedUser.success
      ? parsedUser.data
      : undefined;
    const settingsRoot = resolveWorkspaceHookRuntimeRoot([
      ...(userHooks ? [userHooks] : []),
      ...projectSources.map((source) => source.hooks),
    ]);
    const settingsSnapshot = buildWorkspaceHookBundleSnapshot({
      workspaceIdentity: workspace,
      workspacePath: workspace,
      sources: projectSources,
      runtimeRoot: settingsRoot,
    });
    expect(settingsSnapshot).toBeDefined();

    expect(runtimeSnapshot?.bundleDigest).toBe(settingsSnapshot?.bundleDigest);
    expect(runtimeSnapshot?.hooks.map((hook) => hook.hookDeclarationDigest)).toEqual(
      settingsSnapshot?.hooks.map((hook) => hook.hookDeclarationDigest),
    );
    expect(runtimeSnapshot?.hooks.map((hook) => hook.resolvedTimeoutMs)).toEqual(
      settingsSnapshot?.hooks.map((hook) => hook.resolvedTimeoutMs),
    );
    expect(runtimeSnapshot?.hooks.map((hook) => hook.configuredEnabled)).toEqual(
      settingsSnapshot?.hooks.map((hook) => hook.configuredEnabled),
    );
    expect(runtimeSnapshot?.hooks.every((hook) => hook.runtimeHooksEnabled)).toBe(true);
  });

  it("导出快照实际使用的 runtimeRoot，供 toggle 重建复用同一取值", async () => {
    const workspace = makeRoot();
    await writeJson(join(workspace, ".cf", "config.json"), {
      hooks: {
        enabled: true,
        timeoutMs: 10_000,
        maxOutputBytes: 65_536,
        events: {
          SessionStart: [
            { matcher: "startup", hooks: [{ type: "command", command: "echo parity" }] },
          ],
        },
      } satisfies WorkspaceHooksConfig,
    });

    const config = await createConfig({ workingDirectory: workspace });
    const exported = config.sources.project.workspaceHookRuntimeRoot;
    expect(exported).toEqual({ enabled: true, timeoutMs: 10_000, maxOutputBytes: 65_536 });

    const { sources } = await readWorkspaceHookProjectSources({ workingDirectory: workspace });
    const rebuilt = buildWorkspaceHookBundleSnapshot({
      workspaceIdentity: workspace,
      workspacePath: workspace,
      sources,
      runtimeRoot: exported!,
    });
    expect(rebuilt?.bundleDigest).toBe(config.sources.project.workspaceHookSnapshot?.bundleDigest);
  });

  it("explicit path 与 auto-discovery 指向同一文件时只生成一个 source", async () => {
    const workspace = makeRoot();
    await mkdir(join(workspace, ".git"));
    const configPath = join(workspace, "cf.json");
    await writeJson(configPath, {
      hooks: {
        enabled: true,
        events: {
          SessionStart: [{ hooks: [{ type: "command", command: "echo deduplicated" }] }],
        },
      },
    });

    const runtime = createConfig({
      env: {},
      projectConfigPath: configPath,
      skipUserConfig: true,
      workingDirectory: workspace,
      workspaceIdentity: workspace,
    }).sources.project.workspaceHookSnapshot;
    const { sources } = await readWorkspaceHookProjectSources({
      workingDirectory: workspace,
      explicitProjectConfigPath: configPath,
    });
    const settings = buildWorkspaceHookBundleSnapshot({
      workspaceIdentity: workspace,
      workspacePath: workspace,
      sources,
      runtimeRoot: resolveWorkspaceHookRuntimeRoot(sources.map((source) => source.hooks)),
    });

    expect(runtime?.sourceFiles).toHaveLength(1);
    expect(runtime?.sourceFiles[0]).toMatchObject({
      canonicalPath: configPath,
      discoveryOrder: 0,
      explicitProjectConfig: false,
    });
    expect(runtime?.bundleDigest).toBe(settings?.bundleDigest);
  });

  it("损坏候选仍占 discoveryOrder，后续 source 的 Runtime/Settings digest 不错位", async () => {
    const workspace = makeRoot();
    await mkdir(join(workspace, ".git"));
    await writeFile(join(workspace, "cf.json"), "{broken", "utf8");
    await writeJson(join(workspace, ".cf", "config.json"), {
      hooks: {
        enabled: true,
        events: {
          Stop: [{ hooks: [{ type: "command", command: "echo valid-after-broken" }] }],
        },
      },
    });
    const explicitPath = join(workspace, "explicit-hooks.json");
    await writeJson(explicitPath, {
      hooks: {
        enabled: true,
        events: {
          UserPromptSubmit: [{ hooks: [{ type: "command", command: "echo explicit" }] }],
        },
      },
    });

    const runtime = createConfig({
      env: {},
      projectConfigPath: explicitPath,
      skipUserConfig: true,
      workingDirectory: workspace,
      workspaceIdentity: workspace,
    }).sources.project.workspaceHookSnapshot;
    const { sources } = await readWorkspaceHookProjectSources({
      workingDirectory: workspace,
      explicitProjectConfigPath: explicitPath,
    });
    const settings = buildWorkspaceHookBundleSnapshot({
      workspaceIdentity: workspace,
      workspacePath: workspace,
      sources,
      runtimeRoot: resolveWorkspaceHookRuntimeRoot(sources.map((source) => source.hooks)),
    });

    expect(runtime?.sourceFiles.map((source) => source.discoveryOrder)).toEqual([1, 2]);
    expect(settings?.sourceFiles.map((source) => source.discoveryOrder)).toEqual([1, 2]);
    expect(runtime?.bundleDigest).toBe(settings?.bundleDigest);
  });
});
