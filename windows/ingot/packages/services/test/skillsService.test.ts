import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_SKILL_SCAN_DEPTH } from "@origin-ai/cf-shared";
import type { ISkillsService } from "../src/skills/skills.js";

const originalHome = process.env.HOME;
const originalProcessLabel = process.env.CF_PROCESS_LABEL;
const tempHomes: string[] = [];

function makeTempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "cf-skills-home-"));
  tempHomes.push(home);
  return home;
}

async function createSkillsServiceInEnv(
  home: string,
  options?: { isDesktopRuntime?: boolean },
): Promise<ISkillsService> {
  process.env.HOME = home;
  vi.resetModules();
  const mod = await import("../src/skills/skillsService.js");
  return mod.createSkillsService(options);
}

function writeSkill(basePath: string, folder: string, content: string): void {
  const skillDir = join(basePath, folder);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), content, "utf-8");
}

function writeSkillMeta(basePath: string, folder: string, metadata: unknown): void {
  const skillDir = join(basePath, folder);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "_meta.json"), JSON.stringify(metadata, null, 2), "utf-8");
}

function workspaceSkillRoot(workspacePath: string): string {
  return join(workspacePath, ".cf", "skills");
}

function userSkillRoot(home: string): string {
  return join(home, ".cf", "skills");
}

function userAgentsSkillRoot(home: string): string {
  return join(home, ".agents", "skills");
}

function officialPluginRoot(home: string, pluginName: string, version = "0.1.0"): string {
  return join(
    home,
    ".cf",
    "cli",
    "plugins",
    "cache",
    "cf-plugins-official",
    pluginName,
    version,
  );
}

function marketplacePluginRoot(
  home: string,
  marketplace: string,
  pluginName: string,
  version = "0.0.0",
): string {
  return join(home, ".cf", "cli", "plugins", "cache", marketplace, pluginName, version);
}

function writePluginManifest(pluginRoot: string, manifest: Record<string, unknown>): void {
  mkdirSync(join(pluginRoot, ".cf-plugin"), { recursive: true });
  writeFileSync(
    join(pluginRoot, ".cf-plugin", "plugin.json"),
    JSON.stringify(manifest, null, 2),
    "utf-8",
  );
}

function writeClaudePluginManifest(pluginRoot: string, manifest: Record<string, unknown>): void {
  mkdirSync(join(pluginRoot, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(pluginRoot, ".claude-plugin", "plugin.json"),
    JSON.stringify(manifest, null, 2),
    "utf-8",
  );
}

function writeInstalledPluginRecord(
  home: string,
  record: {
    marketplace: string;
    name: string;
    installPath: string;
    version?: string;
  },
): void {
  const pluginsRoot = join(home, ".cf", "cli", "plugins");
  mkdirSync(pluginsRoot, { recursive: true });
  writeFileSync(
    join(pluginsRoot, "installed_plugins.json"),
    JSON.stringify(
      {
        version: 1,
        plugins: [
          {
            id: `${record.name}@${record.marketplace}`,
            name: record.name,
            marketplace: record.marketplace,
            version: record.version ?? "0.0.0",
            installPath: record.installPath,
            installedAt: "2026-06-25T00:00:00.000Z",
            updatedAt: "2026-06-25T00:00:00.000Z",
            scope: "user",
            source: "./plugins/demo",
          },
        ],
      },
      null,
      2,
    ),
    "utf-8",
  );
}

function writeCliConfig(home: string, config: Record<string, unknown>): void {
  const configPath = join(home, ".cf", "cli", "config.json");
  mkdirSync(join(home, ".cf", "cli"), { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}

afterEach(() => {
  process.env.HOME = originalHome;
  process.env.CF_PROCESS_LABEL = originalProcessLabel;
  vi.doUnmock("node:fs/promises");
  vi.resetModules();
  while (tempHomes.length > 0) {
    const home = tempHomes.pop();
    if (home) {
      rmSync(home, { recursive: true, force: true });
    }
  }
});

describe("skillsService", () => {
  it("Reads and merges .cf and .agents at workspace root, ignoring deprecated and Claude skill directories", async () => {
    const home = makeTempHome();
    const workspacePath = join(home, "workspace");
    writeSkill(
      workspaceSkillRoot(workspacePath),
      "repo-review",
      `---
name: repo-review
description: from cf
---
cf-body`,
    );
    writeSkill(
      join(workspacePath, ".cf", "cli", "skills"),
      "old-glm",
      `---
name: old-glm
description: deprecated
---
old-body`,
    );
    writeSkill(
      join(workspacePath, ".agents", "skills"),
      "agents-review",
      `---
name: agents-review
description: from agents
---
agents-body`,
    );
    writeSkill(
      join(workspacePath, ".claude", "skills"),
      "claude-review",
      `---
name: claude-review
description: retired claude
---
claude-body`,
    );

    const service = await createSkillsServiceInEnv(home, { isDesktopRuntime: true });
    const result = await service.list({ workspacePath, provider: "claude" });

    expect(result.skills.map((skill) => skill.name)).toEqual(["agents-review", "repo-review"]);
    expect(result.skills.find((skill) => skill.name === "agents-review")).toMatchObject({
      description: "from agents",
      scope: "workspace",
      enabled: true,
    });
    expect(result.skills.find((skill) => skill.name === "repo-review")).toMatchObject({
      description: "from cf",
      scope: "workspace",
      enabled: true,
    });
  });

  it.skipIf(process.platform === "win32")(
    "Skills symlinked into workspace .cf/skills are discoverable by / and $ panels",
    async () => {
      const home = makeTempHome();
      const workspacePath = join(home, "workspace");
      const sourceSkillParent = join(home, "external-agent", "skills");
      const sourceSkillDir = join(sourceSkillParent, "imported-skill");
      const linkedSkillDir = join(workspaceSkillRoot(workspacePath), "imported-skill");
      writeSkill(
        sourceSkillParent,
        "imported-skill",
        `---
name: imported-skill
description: imported via symlink
---
imported-body`,
      );
      mkdirSync(workspaceSkillRoot(workspacePath), { recursive: true });
      symlinkSync(sourceSkillDir, linkedSkillDir, "dir");

      const service = await createSkillsServiceInEnv(home, { isDesktopRuntime: true });
      const result = await service.list({ workspacePath, provider: "glm" });

      expect(result.skills.map((skill) => skill.name)).toEqual(["imported-skill"]);
      expect(result.skills[0]).toMatchObject({
        description: "imported via symlink",
        scope: "workspace",
      });
      expect(result.skills[0]?.path).toContain("imported-skill/SKILL.md");
    },
  );

  it("Discovers skills even when workspace only has .agents/skills", async () => {
    const home = makeTempHome();
    const workspacePath = join(home, "workspace");
    writeSkill(
      join(workspacePath, ".agents", "skills"),
      "agents-review",
      `---
name: agents-review
description: from agents
---
agents-body`,
    );

    const service = await createSkillsServiceInEnv(home, { isDesktopRuntime: true });
    const result = await service.list({ workspacePath, provider: "claude" });

    expect(result.skills.map((skill) => skill.name)).toEqual(["agents-review"]);
    expect(result.skills[0]).toMatchObject({
      description: "from agents",
      scope: "workspace",
    });
  });

  it("Source user scope does not misclassify the home anchor as a workspace", async () => {
    const home = makeTempHome();
    writeSkill(
      userSkillRoot(home),
      "source-user-skill",
      "---\nname: source-user-skill\ndescription: source user\n---\n",
    );

    const service = await createSkillsServiceInEnv(home, { isDesktopRuntime: true });
    const result = await service.list({
      workspacePath: home,
      provider: "glm",
    });

    expect(result.skills.find((skill) => skill.name === "source-user-skill")?.scope).toBe("user");
    expect(result.skills.some((skill) => skill.scope === "workspace")).toBe(false);
  });

  it("Recursively discovers grouped directories, skipping hidden directories but allowing .system official directory", async () => {
    const home = makeTempHome();
    const workspacePath = join(home, "workspace");
    const root = workspaceSkillRoot(workspacePath);
    writeSkill(
      join(root, "group-a"),
      "public-skill",
      `---
name: public-skill
description: visible
---
public-body`,
    );
    writeSkill(
      join(root, "bundle", ".agents", "skills"),
      "vendored-skill",
      `---
name: vendored-skill
description: hidden
---
vendored-body`,
    );
    writeSkill(
      join(root, ".system"),
      "bundled-system-skill",
      `---
name: bundled-system-skill
description: official
---
system-body`,
    );

    const service = await createSkillsServiceInEnv(home, { isDesktopRuntime: true });
    const result = await service.list({ workspacePath, provider: "glm" });

    expect(result.skills.map((skill) => skill.name).sort()).toEqual([
      "bundled-system-skill",
      "public-skill",
    ]);
  });

  it.skipIf(process.platform === "win32")("Skips symlinks pointing to files during recursive scan", async () => {
    const home = makeTempHome();
    const workspacePath = join(home, "workspace");
    const root = workspaceSkillRoot(workspacePath);
    writeSkill(
      root,
      "zai-grafana-cli",
      `---
name: zai-grafana-cli
description: grafana cli
---
body`,
    );
    const skillDir = join(root, "zai-grafana-cli");
    const binDir = join(skillDir, "bin");
    const executablePath = join(home, "gfctl");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(executablePath, "#!/bin/sh\n", "utf-8");
    symlinkSync(executablePath, join(binDir, "gfctl"));

    const service = await createSkillsServiceInEnv(home, { isDesktopRuntime: true });
    const result = await service.list({ workspacePath, provider: "glm" });

    expect(result.skills.map((skill) => skill.name)).toEqual(["zai-grafana-cli"]);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "skill_scan_failed")).toBe(
      false,
    );
  });

  it("Supports CRLF, multiline description, and Chinese colons when reading SKILL.md", async () => {
    const home = makeTempHome();
    const workspacePath = join(home, "workspace");
    writeSkill(
      workspaceSkillRoot(workspacePath),
      "windows-skill",
      "---\r\nname: windows-skill\r\ndescription: |\r\n  first line\r\n  second line\r\n---\r\nbody line",
    );
    writeSkill(
      workspaceSkillRoot(workspacePath),
      "cn-colon-skill",
      `---
name: cn-colon-skill
description: Academic data query. Trigger: Use when papers, scholars, or institutions are mentioned.
---
body`,
    );

    const service = await createSkillsServiceInEnv(home, { isDesktopRuntime: true });
    const result = await service.list({ workspacePath, provider: "glm" });

    expect(result.skills.find((skill) => skill.name === "windows-skill")).toMatchObject({
      description: "first line\nsecond line",
      body: "body line",
    });
    expect(result.skills.find((skill) => skill.name === "cn-colon-skill")).toMatchObject({
      description: "Academic data query. Trigger: Use when papers, scholars, or institutions are mentioned.",
      body: "body",
    });
  });

  it("Merges version info from _meta.json in the same directory when reading skills", async () => {
    const home = makeTempHome();
    const workspacePath = join(home, "workspace");
    const publishedAt = Date.now();
    writeSkill(
      workspaceSkillRoot(workspacePath),
      "feishu-drive",
      `---
name: feishu-drive
description: drive
---
body`,
    );
    writeSkillMeta(workspaceSkillRoot(workspacePath), "feishu-drive", {
      ownerId: "owner-1",
      slug: "feishu-drive",
      version: "1.0.0",
      publishedAt,
    });

    const service = await createSkillsServiceInEnv(home, { isDesktopRuntime: true });
    const result = await service.list({ workspacePath, provider: "glm" });

    expect(result.skills[0]?.metadata).toEqual({
      ownerId: "owner-1",
      slug: "feishu-drive",
      version: "1.0.0",
      publishedAt,
    });
  });

  it("Desktop runtime reads both user-level ~/.cf/skills and ~/.agents/skills", async () => {
    const home = makeTempHome();
    const workspacePath = join(home, "workspace");
    writeSkill(
      userSkillRoot(home),
      "cf-global",
      `---
name: cf-global
description: user cf
---
body`,
    );
    writeSkill(
      userAgentsSkillRoot(home),
      "agents-global",
      `---
name: agents-global
description: user agents
---
body`,
    );
    writeSkill(
      userSkillRoot(home),
      "copied-global",
      `---
name: copied-global
description: copied into cf
---
cf-body`,
    );
    writeSkill(
      userAgentsSkillRoot(home),
      "copied-global",
      `---
name: copied-global
description: original agents copy
---
agents-body`,
    );
    writeSkill(
      userSkillRoot(home),
      "current-review",
      `---
name: shared-review
description: cf version
---
cf-review-body`,
    );
    writeSkill(
      userAgentsSkillRoot(home),
      "external-review",
      `---
name: shared-review
description: agents version
---
agents-review-body`,
    );
    writeSkill(
      join(home, ".cf", "cli", "skills"),
      "old-global",
      `---
name: old-global
description: deprecated
---
body`,
    );

    const service = await createSkillsServiceInEnv(home, { isDesktopRuntime: true });
    const result = await service.list({ workspacePath, provider: "glm" });

    expect(result.capability).toEqual({ userScopeAvailable: true });
    expect(result.skills.map((skill) => skill.name)).toEqual([
      "agents-global",
      "copied-global",
      "shared-review",
      "cf-global",
    ]);
    expect(result.skills.find((skill) => skill.name === "copied-global")?.path).toContain(
      join(home, ".cf", "skills", "copied-global"),
    );
    expect(result.skills.find((skill) => skill.name === "shared-review")?.path).toContain(
      join(home, ".cf", "skills", "current-review"),
    );
    expect(result.skills.every((skill) => skill.scope === "user")).toBe(true);
  });

  it("Desktop runtime falls back to ~/.agents/skills when user-level ~/.cf/skills has no skills", async () => {
    const home = makeTempHome();
    const workspacePath = join(home, "workspace");
    writeSkill(
      userAgentsSkillRoot(home),
      "agents-global",
      `---
name: agents-global
description: user agents
---
body`,
    );

    const service = await createSkillsServiceInEnv(home, { isDesktopRuntime: true });
    const result = await service.list({ workspacePath, provider: "glm" });

    expect(result.skills.map((skill) => skill.name)).toEqual(["agents-global"]);
    expect(result.skills[0]?.scope).toBe("user");
  });

  it("Reads skill directories declared by enabled official plugins", async () => {
    const home = makeTempHome();
    const workspacePath = join(home, "workspace");
    const browserUsePluginRoot = officialPluginRoot(home, "browser-use");
    const documentPluginRoot = officialPluginRoot(home, "documents");
    const cfGuidePluginRoot = officialPluginRoot(home, "cf-guide");
    const iosPluginRoot = officialPluginRoot(home, "ios-simulator");
    const androidPluginRoot = officialPluginRoot(home, "android-emulator");
    writePluginManifest(browserUsePluginRoot, {
      name: "browser-use",
      skills: "skills",
      version: "0.1.0",
    });
    writePluginManifest(documentPluginRoot, {
      name: "documents",
      skills: "skills",
      version: "0.1.0",
    });
    writePluginManifest(cfGuidePluginRoot, {
      name: "cf-guide",
      skills: "skills",
      version: "0.1.0",
    });
    writePluginManifest(iosPluginRoot, {
      name: "ios-simulator",
      skills: "skills",
      version: "0.1.0",
    });
    writePluginManifest(androidPluginRoot, {
      name: "android-emulator",
      skills: "skills",
      version: "0.1.0",
    });
    writeSkill(
      join(browserUsePluginRoot, "skills"),
      "control-browser",
      `---
name: control-browser
description: browser skill
---
browser-body`,
    );
    writeSkill(
      join(documentPluginRoot, "skills"),
      "docx",
      `---
name: docx
description: docx skill
---
docx-body`,
    );
    writeSkill(
      join(documentPluginRoot, "skills"),
      "pdf",
      `---
name: pdf
description: pdf skill
---
pdf-body`,
    );
    writeSkill(
      join(cfGuidePluginRoot, "skills"),
      "diagnosing-plugins",
      `---
name: diagnosing-plugins
description: Diagnose plugin discovery and enablement problems
---
diagnosing-body`,
    );
    writeSkill(
      join(iosPluginRoot, "skills"),
      "ios-simulator",
      `---
name: ios-simulator
description: ios skill
---
ios-body`,
    );
    writeSkill(
      join(androidPluginRoot, "skills"),
      "android-emulator",
      `---
name: android-emulator
description: android skill
---
android-body`,
    );
    writeCliConfig(home, {
      plugins: {
        enabledPlugins: {
          "ios-simulator@cf-plugins-official": true,
        },
      },
    });

    const service = await createSkillsServiceInEnv(home, { isDesktopRuntime: true });
    const result = await service.list({ workspacePath, provider: "glm" });

    expect(result.skills.map((skill) => skill.name)).toEqual([
      "control-browser",
      "diagnosing-plugins",
      "docx",
      "ios-simulator",
      "pdf",
    ]);
    expect(result.skills.map((skill) => skill.scope)).toEqual([
      "plugin",
      "plugin",
      "plugin",
      "plugin",
      "plugin",
    ]);
    expect(result.skills.map((skill) => skill.pluginName).sort()).toEqual([
      "browser-use",
      "documents",
      "documents",
      "ios-simulator",
      "cf-guide",
    ]);
  });

  it("Suppressed builtin plugins contribute no skills", async () => {
    const home = makeTempHome();
    const workspacePath = join(home, "workspace");
    const browserUsePluginRoot = officialPluginRoot(home, "browser-use");
    const documentPluginRoot = officialPluginRoot(home, "documents");
    const skillCreatorPluginRoot = officialPluginRoot(home, "skill-creator");
    const cfGuidePluginRoot = officialPluginRoot(home, "cf-guide");
    writePluginManifest(browserUsePluginRoot, {
      name: "browser-use",
      skills: "skills",
      version: "0.1.0",
    });
    writePluginManifest(documentPluginRoot, {
      name: "documents",
      skills: "skills",
      version: "0.1.0",
    });
    writePluginManifest(skillCreatorPluginRoot, {
      name: "skill-creator",
      skills: "skills",
      version: "0.1.0",
    });
    writePluginManifest(cfGuidePluginRoot, {
      name: "cf-guide",
      skills: "skills",
      version: "0.1.0",
    });
    writeSkill(
      join(browserUsePluginRoot, "skills"),
      "control-browser",
      `---
name: control-browser
description: browser skill
---
browser-body`,
    );
    writeSkill(
      join(documentPluginRoot, "skills"),
      "docx",
      `---
name: docx
description: docx skill
---
docx-body`,
    );
    writeSkill(
      join(skillCreatorPluginRoot, "skills"),
      "skill-creator",
      `---
name: skill-creator
description: skill creator skill
---
creator-body`,
    );
    writeSkill(
      join(cfGuidePluginRoot, "skills"),
      "diagnosing-plugins",
      `---
name: diagnosing-plugins
description: Diagnose plugin discovery and enablement problems
---
diagnosing-body`,
    );
    writeCliConfig(home, {
      plugins: {
        suppressedBuiltins: [
          "browser-use@cf-plugins-official",
          "documents@cf-plugins-official",
          "cf-guide@cf-plugins-official",
        ],
      },
    });

    const service = await createSkillsServiceInEnv(home, { isDesktopRuntime: true });
    const result = await service.list({ workspacePath, provider: "glm" });

    expect(result.skills.map((skill) => skill.name)).toEqual(["skill-creator"]);
    expect(result.skills.find((skill) => skill.pluginName === "browser")).toBeUndefined();
    expect(result.skills.find((skill) => skill.pluginName === "documents")).toBeUndefined();
    expect(result.skills.find((skill) => skill.pluginName === "cf-guide")).toBeUndefined();
  });

  it("Reads skill directories declared by installed marketplace plugins", async () => {
    const home = makeTempHome();
    const workspacePath = join(home, "workspace");
    const pluginRoot = marketplacePluginRoot(
      home,
      "claude-plugins-official",
      "amazon-location-service",
    );
    writeClaudePluginManifest(pluginRoot, {
      name: "amazon-location-service",
      skills: "skills",
      version: "1.0.0",
    });
    writeSkill(
      join(pluginRoot, "skills"),
      "amazon-location-service",
      `---
name: amazon-location-service
description: amazon location skill
---
amazon-body`,
    );
    writeInstalledPluginRecord(home, {
      installPath: pluginRoot,
      marketplace: "claude-plugins-official",
      name: "amazon-location-service",
    });
    writeCliConfig(home, {
      plugins: {
        enabledPlugins: {
          "amazon-location-service@claude-plugins-official": true,
        },
      },
    });

    const service = await createSkillsServiceInEnv(home, { isDesktopRuntime: true });
    const result = await service.list({ workspacePath, provider: "glm" });

    expect(result.skills).toEqual([
      expect.objectContaining({
        name: "amazon-location-service",
        pluginName: "amazon-location-service",
        pluginId: "amazon-location-service@claude-plugins-official",
        scope: "plugin",
      }),
    ]);
  });

  it("Reads plugin skills declared in manifest skills array (array items are skill directories)", async () => {
    const home = makeTempHome();
    const workspacePath = join(home, "workspace");
    const pluginRoot = marketplacePluginRoot(home, "claude-plugins-official", "mattpocock-skills");
    writeClaudePluginManifest(pluginRoot, {
      name: "mattpocock-skills",
      skills: ["./skills/engineering/tdd", "./skills/productivity/tdd", "./skills/bundle-root"],
      version: "1.0.0",
    });
    writeSkill(
      join(pluginRoot, "skills", "engineering", "tdd"),
      "tdd",
      `---
name: tdd
description: engineering tdd skill
---
tdd-body`,
    );
    writeSkill(
      join(pluginRoot, "skills", "productivity", "tdd"),
      "productivity-tdd",
      `---
name: productivity-tdd
description: productivity tdd skill
---
productivity-tdd-body`,
    );
    writeSkill(
      join(pluginRoot, "skills", "bundle-root"),
      "bundle-root",
      `---
name: bundle-root
description: skill whose SKILL.md sits directly in the declared root
---
bundle-root-body`,
    );
    writeInstalledPluginRecord(home, {
      installPath: pluginRoot,
      marketplace: "claude-plugins-official",
      name: "mattpocock-skills",
    });
    writeCliConfig(home, {
      plugins: {
        enabledPlugins: {
          "mattpocock-skills@claude-plugins-official": true,
        },
      },
    });

    const service = await createSkillsServiceInEnv(home, { isDesktopRuntime: true });
    const result = await service.list({ workspacePath, provider: "glm" });

    expect(result.skills.map((skill) => skill.name).sort()).toEqual([
      "bundle-root",
      "productivity-tdd",
      "tdd",
    ]);
    for (const skill of result.skills) {
      expect(skill.pluginName).toBe("mattpocock-skills");
      expect(skill.scope).toBe("plugin");
    }
  });

  it("Non-desktop runtimes do not read user-level skills", async () => {
    const home = makeTempHome();
    const workspacePath = join(home, "workspace");
    writeSkill(
      userSkillRoot(home),
      "cf-global",
      `---
name: cf-global
description: user cf
---
body`,
    );

    const service = await createSkillsServiceInEnv(home, { isDesktopRuntime: false });
    const result = await service.list({ workspacePath, provider: "glm" });

    expect(result.capability).toEqual({
      userScopeAvailable: false,
      userScopeReason: "desktop_only",
    });
    expect(result.skills).toEqual([]);
  });

  const isWindows = process.platform === "win32";

  (isWindows ? it.skip : it)(
    "setEnabled writes skill toggles by path to CLI config without workspaceIdentity isolation",
    async () => {
      const home = makeTempHome();
      const workspacePath = join(home, "workspace");
      writeSkill(
        workspaceSkillRoot(workspacePath),
        "repo-review",
        `---
name: repo-review
description: review
---
body`,
      );

      const service = await createSkillsServiceInEnv(home, { isDesktopRuntime: true });
      const before = await service.list({
        workspacePath,
        workspaceIdentity: "remote:ssh:a:/workspace",
        provider: "glm",
      });
      const skill = before.skills[0]!;

      await service.setEnabled({
        workspacePath,
        workspaceIdentity: "remote:ssh:a:/workspace",
        provider: "glm",
        scope: skill.scope,
        skillId: skill.id,
        enabled: false,
      });

      const disabled = await service.list({
        workspacePath,
        workspaceIdentity: "remote:ssh:a:/workspace",
        provider: "glm",
      });
      const enabled = await service.list({
        workspacePath,
        workspaceIdentity: "remote:ssh:b:/workspace",
        provider: "glm",
      });
      const config = JSON.parse(
        readFileSync(join(home, ".cf", "cli", "config.json"), "utf-8"),
      ) as { skills?: Record<string, { enable?: boolean }> };
      expect(disabled.skills[0]?.enabled).toBe(false);
      expect(enabled.skills[0]?.enabled).toBe(false);
      expect(config.skills?.[skill.path]).toEqual({ enable: false });

      await service.setEnabled({
        workspacePath,
        workspaceIdentity: "remote:ssh:a:/workspace",
        provider: "glm",
        scope: skill.scope,
        skillId: skill.id,
        enabled: true,
      });

      const reenabled = await service.list({
        workspacePath,
        workspaceIdentity: "remote:ssh:a:/workspace",
        provider: "glm",
      });
      const reenabledConfig = JSON.parse(
        readFileSync(join(home, ".cf", "cli", "config.json"), "utf-8"),
      ) as { skills?: Record<string, { enable?: boolean }> };
      expect(reenabled.skills[0]?.enabled).toBe(true);
      expect(reenabledConfig.skills?.[skill.path]).toBeUndefined();
    },
  );

  it("Does not migrate or write to legacy state file when reading legacy skills-state.json", async () => {
    const home = makeTempHome();
    const workspacePath = join(home, "workspace");
    const legacySkillId = "workspace:legacy-skill";
    const legacyStatePath = join(home, ".cf", "v2", "skills-state.json");
    mkdirSync(join(home, ".cf", "v2"), { recursive: true });
    writeFileSync(
      legacyStatePath,
      JSON.stringify({ disabledByWorkspace: { [workspacePath]: [legacySkillId] } }),
      "utf-8",
    );

    const service = await createSkillsServiceInEnv(home, { isDesktopRuntime: true });
    await service.list({ workspacePath, provider: "glm" });

    const state = JSON.parse(readFileSync(legacyStatePath, "utf-8")) as {
      disabledByWorkspace?: Record<string, string[]>;
    };
    expect(state.disabledByWorkspace).toEqual({ [workspacePath]: [legacySkillId] });
    expect(existsSync(join(home, ".cf", "cli", "config.json"))).toBe(false);
  });

  it("buildPromptContext only injects content of enabled and mentioned skills", async () => {
    const home = makeTempHome();
    const workspacePath = join(home, "workspace");
    writeSkill(
      workspaceSkillRoot(workspacePath),
      "code-review",
      `---
name: code-review
description: Review code
---
review-body`,
    );
    writeSkill(
      workspaceSkillRoot(workspacePath),
      "plan-maker",
      `---
name: plan-maker
description: Make plans
---
plan-body`,
    );

    const service = await createSkillsServiceInEnv(home, { isDesktopRuntime: true });
    const context = await service.buildPromptContext({
      workspacePath,
      provider: "glm",
      prompt: "Please run $code-review first",
    });

    expect(context.prompt).toContain("<available_skills>");
    expect(context.prompt).toContain('<activated_skill name="code-review"');
    expect(context.prompt).toContain("review-body");
    expect(context.prompt).not.toContain("plan-body");
    expect(context.activatedSkillNames).toEqual(["code-review"]);
    expect(existsSync(join(home, ".cf", "v2", "skills-audit.log"))).toBe(true);
  });

  it("Disabled skills are not injected even if mentioned", async () => {
    const home = makeTempHome();
    const workspacePath = join(home, "workspace");
    writeSkill(
      workspaceSkillRoot(workspacePath),
      "code-review",
      `---
name: code-review
description: Review code
---
review-body`,
    );

    const service = await createSkillsServiceInEnv(home, { isDesktopRuntime: true });
    const list = await service.list({ workspacePath, provider: "glm" });
    await service.setEnabled({
      workspacePath,
      provider: "glm",
      scope: list.skills[0]!.scope,
      skillId: list.skills[0]!.id,
      enabled: false,
    });

    const context = await service.buildPromptContext({
      workspacePath,
      provider: "glm",
      prompt: "Please run $code-review first",
    });

    expect(context.prompt).toBe("Please run $code-review first");
    expect(context.activatedSkillNames).toEqual([]);
  });

  it("Loads using directory name without producing diagnostics when frontmatter is missing", async () => {
    const home = makeTempHome();
    const workspacePath = join(home, "workspace");
    writeSkill(
      workspaceSkillRoot(workspacePath),
      "no-frontmatter",
      "just markdown body without yaml header",
    );
    writeSkill(
      workspaceSkillRoot(workspacePath),
      "good-skill",
      `---
name: good-skill
description: ok
---
body`,
    );

    const service = await createSkillsServiceInEnv(home, { isDesktopRuntime: true });
    const result = await service.list({ workspacePath, provider: "glm" });

    expect(result.skills.map((skill) => skill.name)).toEqual(["good-skill", "no-frontmatter"]);
    expect(result.skills.find((skill) => skill.name === "no-frontmatter")?.description).toBe("");
    expect(result.skills.find((skill) => skill.name === "no-frontmatter")?.body).toBe(
      "just markdown body without yaml header",
    );
    expect(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "skill_missing_frontmatter" && diagnostic.severity === "error",
      ),
    ).toBe(false);
  });

  it("Loads with original name without producing warnings when name does not follow lowercase-hyphen convention", async () => {
    const home = makeTempHome();
    const workspacePath = join(home, "workspace");
    writeSkill(
      workspaceSkillRoot(workspacePath),
      "fallback-name",
      `---
name: BadName_With_Caps
description: bad name
---
body`,
    );

    const service = await createSkillsServiceInEnv(home, { isDesktopRuntime: true });
    const result = await service.list({ workspacePath, provider: "glm" });

    expect(result.skills.map((skill) => skill.name)).toEqual(["BadName_With_Caps"]);
    expect(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "skill_invalid_name" && diagnostic.skillName === "BadName_With_Caps",
      ),
    ).toBe(false);
  });

  it("Produces an error and skips when description exceeds 1024 characters", async () => {
    const home = makeTempHome();
    const workspacePath = join(home, "workspace");
    const longDescription = "a".repeat(1100);
    writeSkill(
      workspaceSkillRoot(workspacePath),
      "too-long",
      `---
name: too-long
description: "${longDescription}"
---
body`,
    );

    const service = await createSkillsServiceInEnv(home, { isDesktopRuntime: true });
    const result = await service.list({ workspacePath, provider: "glm" });

    expect(result.skills).toEqual([]);
    expect(
      result.diagnostics.some((diagnostic) => diagnostic.code === "skill_description_too_long"),
    ).toBe(true);
  });

  it("Unrecognized frontmatter keys produce no warnings and the skill remains usable", async () => {
    const home = makeTempHome();
    const workspacePath = join(home, "workspace");
    writeSkill(
      workspaceSkillRoot(workspacePath),
      "extra-key",
      `---
name: extra-key
description: ok
unknown-field: hello
---
body`,
    );

    const service = await createSkillsServiceInEnv(home, { isDesktopRuntime: true });
    const result = await service.list({ workspacePath, provider: "glm" });

    expect(result.skills.map((skill) => skill.name)).toEqual(["extra-key"]);
    expect(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "skill_unknown_frontmatter" &&
          diagnostic.message.includes("unknown-field"),
      ),
    ).toBe(false);
  });

  it("Retains both skills by path without producing duplicate warnings when two skills share the same name", async () => {
    const home = makeTempHome();
    const workspacePath = join(home, "workspace");
    writeSkill(
      workspaceSkillRoot(workspacePath),
      "dup-first",
      `---
name: shared-name
description: first
---
first-body`,
    );
    writeSkill(
      workspaceSkillRoot(workspacePath),
      "dup-second",
      `---
name: shared-name
description: second
---
second-body`,
    );

    const service = await createSkillsServiceInEnv(home, { isDesktopRuntime: true });
    const result = await service.list({ workspacePath, provider: "glm" });

    expect(result.skills.map((skill) => skill.name)).toEqual(["shared-name", "shared-name"]);
    expect(
      result.skills.map((skill) => skill.path.replaceAll("\\", "/").split("/skills/").at(-1)),
    ).toEqual(["dup-first/SKILL.md", "dup-second/SKILL.md"]);
    expect(
      result.diagnostics.some((diagnostic) => diagnostic.code === "skill_duplicate_name"),
    ).toBe(false);
  });

  it("Subdirectory scanning in worktree collects ancestor .cf/skills upward", async () => {
    const home = makeTempHome();
    const repoRoot = join(home, "repo");
    mkdirSync(join(repoRoot, ".git"), { recursive: true });
    const childWorkspace = join(repoRoot, "packages", "child");
    writeSkill(
      workspaceSkillRoot(childWorkspace),
      "child-skill",
      `---
name: child-skill
description: scoped to child
---
body`,
    );
    writeSkill(
      workspaceSkillRoot(repoRoot),
      "root-skill",
      `---
name: root-skill
description: scoped to repo root
---
body`,
    );

    const service = await createSkillsServiceInEnv(home, { isDesktopRuntime: true });
    const result = await service.list({ workspacePath: childWorkspace, provider: "glm" });

    expect(result.skills.map((skill) => skill.name).sort()).toEqual(["child-skill", "root-skill"]);
  });

  it("deleteSkill deletes .cf/skills workspace skill directory", async () => {
    const home = makeTempHome();
    const workspacePath = join(home, "workspace");
    const skillDir = join(workspaceSkillRoot(workspacePath), "repo-review");
    writeSkill(
      workspaceSkillRoot(workspacePath),
      "repo-review",
      `---
name: repo-review
description: review
---
body`,
    );

    const service = await createSkillsServiceInEnv(home, { isDesktopRuntime: true });
    const before = await service.list({ workspacePath, provider: "glm" });
    const skill = before.skills.find((s) => s.name === "repo-review")!;
    expect(existsSync(skillDir)).toBe(true);

    await service.deleteSkill({ workspacePath, skillId: skill.id });

    expect(existsSync(skillDir)).toBe(false);
    const after = await service.list({ workspacePath, provider: "glm" });
    expect(after.skills.find((s) => s.name === "repo-review")).toBeUndefined();
  });

  it.skipIf(process.platform === "win32")(
    "deleteSkill deletes user-level ~/.cf/skills symlinked skill: deletes link only, preserves external target",
    async () => {
      const home = makeTempHome();
      const workspacePath = join(home, "workspace");
      const sourceParent = join(home, "external-agent", "skills");
      const sourceSkillDir = join(sourceParent, "cua-driver");
      const linkedSkillDir = join(userSkillRoot(home), "cua-driver");
      writeSkill(
        sourceParent,
        "cua-driver",
        `---
name: cua-driver
description: linked
---
body`,
      );
      mkdirSync(userSkillRoot(home), { recursive: true });
      symlinkSync(sourceSkillDir, linkedSkillDir, "dir");

      const service = await createSkillsServiceInEnv(home, { isDesktopRuntime: true });
      const before = await service.list({ workspacePath, provider: "glm" });
      const skill = before.skills.find((s) => s.name === "cua-driver")!;
      expect(skill.scope).toBe("user");

      await service.deleteSkill({ workspacePath, skillId: skill.id });

      expect(existsSync(linkedSkillDir)).toBe(false);
      expect(existsSync(sourceSkillDir)).toBe(true);
      expect(existsSync(join(sourceSkillDir, "SKILL.md"))).toBe(true);
      const after = await service.list({ workspacePath, provider: "glm" });
      expect(after.skills.find((s) => s.name === "cua-driver")).toBeUndefined();
    },
  );

  it.skipIf(process.platform === "win32")(
    "deleteSkill deletes workspace .cf/skills symlinked skill: deletes link only, preserves external target",
    async () => {
      const home = makeTempHome();
      const workspacePath = join(home, "workspace");
      const sourceParent = join(home, "external-agent", "skills");
      const sourceSkillDir = join(sourceParent, "imported-skill");
      const linkedSkillDir = join(workspaceSkillRoot(workspacePath), "imported-skill");
      writeSkill(
        sourceParent,
        "imported-skill",
        `---
name: imported-skill
description: linked
---
body`,
      );
      mkdirSync(workspaceSkillRoot(workspacePath), { recursive: true });
      symlinkSync(sourceSkillDir, linkedSkillDir, "dir");

      const service = await createSkillsServiceInEnv(home, { isDesktopRuntime: true });
      const before = await service.list({ workspacePath, provider: "glm" });
      const skill = before.skills.find((s) => s.name === "imported-skill")!;

      await service.deleteSkill({ workspacePath, skillId: skill.id });

      expect(existsSync(linkedSkillDir)).toBe(false);
      expect(existsSync(join(sourceSkillDir, "SKILL.md"))).toBe(true);
      const after = await service.list({ workspacePath, provider: "glm" });
      expect(after.skills.find((s) => s.name === "imported-skill")).toBeUndefined();
    },
  );

  it.skipIf(process.platform === "win32")(
    "deleteSkill rejects deletion via \"symlinked ancestor directory\" to protect external target data",
    async () => {
      const home = makeTempHome();
      const workspacePath = join(home, "workspace");
      const externalGroup = join(home, "external-agent", "group");
      writeSkill(
        externalGroup,
        "nested-skill",
        `---
name: nested-skill
description: nested under a symlinked group dir
---
body`,
      );
      mkdirSync(userSkillRoot(home), { recursive: true });
      // ~/.cf/skills/mygroup -> /external-agent/group
      symlinkSync(externalGroup, join(userSkillRoot(home), "mygroup"), "dir");

      const service = await createSkillsServiceInEnv(home, { isDesktopRuntime: true });
      const before = await service.list({ workspacePath, provider: "glm" });
      const skill = before.skills.find((s) => s.name === "nested-skill")!;

      await expect(service.deleteSkill({ workspacePath, skillId: skill.id })).rejects.toThrow();

      expect(existsSync(join(externalGroup, "nested-skill", "SKILL.md"))).toBe(true);
    },
  );

  it("deleteSkill deletes user-level ~/.agents/skills skill (scenario where removeFromCommon would reject)", async () => {
    const home = makeTempHome();
    const workspacePath = join(home, "workspace");
    const skillDir = join(userAgentsSkillRoot(home), "feishu-drive");
    writeSkill(
      userAgentsSkillRoot(home),
      "feishu-drive",
      `---
name: feishu-drive
description: drive
---
body`,
    );

    const service = await createSkillsServiceInEnv(home, { isDesktopRuntime: true });
    const before = await service.list({ workspacePath, provider: "glm" });
    const skill = before.skills.find((s) => s.name === "feishu-drive")!;
    expect(skill.scope).toBe("user");
    expect(existsSync(skillDir)).toBe(true);

    await service.deleteSkill({ workspacePath, skillId: skill.id });

    expect(existsSync(skillDir)).toBe(false);
    const after = await service.list({ workspacePath, provider: "glm" });
    expect(after.skills.find((s) => s.name === "feishu-drive")).toBeUndefined();
  });

  it("deleteSkill rejects deleting plugin-scoped skills", async () => {
    const home = makeTempHome();
    const workspacePath = join(home, "workspace");
    const pluginRoot = marketplacePluginRoot(
      home,
      "claude-plugins-official",
      "amazon-location-service",
    );
    writeClaudePluginManifest(pluginRoot, {
      name: "amazon-location-service",
      skills: "skills",
      version: "1.0.0",
    });
    const pluginSkillDir = join(pluginRoot, "skills", "amazon-location-service");
    writeSkill(
      join(pluginRoot, "skills"),
      "amazon-location-service",
      `---
name: amazon-location-service
description: amazon location skill
---
amazon-body`,
    );
    writeInstalledPluginRecord(home, {
      installPath: pluginRoot,
      marketplace: "claude-plugins-official",
      name: "amazon-location-service",
    });
    writeCliConfig(home, {
      plugins: {
        enabledPlugins: {
          "amazon-location-service@claude-plugins-official": true,
        },
      },
    });

    const service = await createSkillsServiceInEnv(home, { isDesktopRuntime: true });
    const before = await service.list({ workspacePath, provider: "glm" });
    const skill = before.skills.find((s) => s.name === "amazon-location-service")!;
    expect(skill.scope).toBe("plugin");

    await expect(service.deleteSkill({ workspacePath, skillId: skill.id })).rejects.toThrow();
    expect(existsSync(pluginSkillDir)).toBe(true);
  });

  it("deleteSkill throws on unknown skillId", async () => {
    const home = makeTempHome();
    const workspacePath = join(home, "workspace");
    writeSkill(
      workspaceSkillRoot(workspacePath),
      "repo-review",
      `---
name: repo-review
description: review
---
body`,
    );

    const service = await createSkillsServiceInEnv(home, { isDesktopRuntime: true });
    await expect(
      service.deleteSkill({ workspacePath, skillId: "does-not-exist" }),
    ).rejects.toThrow();
  });

  it("Skips content directories like node_modules when scanning skill roots", async () => {
    const home = makeTempHome();
    const workspacePath = join(home, "workspace");
    const root = workspaceSkillRoot(workspacePath);
    writeSkill(
      root,
      "real-skill",
      `---
name: real-skill
description: real
---
real-body`,
    );
    writeSkill(
      join(root, "real-skill", "node_modules", "some-dep"),
      "skill",
      `---
name: dep-skill
description: should be ignored
---
dep-body`,
    );
    writeSkill(
      join(root, "dist"),
      "built",
      `---
name: dist-skill
description: should be ignored
---
dist-body`,
    );

    const service = await createSkillsServiceInEnv(home, { isDesktopRuntime: true });
    const result = await service.list({ workspacePath, provider: "glm" });

    expect(result.skills.map((skill) => skill.name)).toEqual(["real-skill"]);
  });

  it("Skills exceeding maximum scan depth will not be discovered", async () => {
    const home = makeTempHome();
    const workspacePath = join(home, "workspace");
    const root = workspaceSkillRoot(workspacePath);
    const segments = Array.from({ length: MAX_SKILL_SCAN_DEPTH + 2 }, (_, index) => `lvl-${index}`);
    writeSkill(
      join(root, ...segments),
      "too-deep",
      `---
name: too-deep
description: beyond depth cap
---
deep-body`,
    );

    const service = await createSkillsServiceInEnv(home, { isDesktopRuntime: true });
    const result = await service.list({ workspacePath, provider: "glm" });

    expect(result.skills.map((skill) => skill.name)).not.toContain("too-deep");
  });

  it.skipIf(process.platform === "win32")("Scan terminates without duplicates when directory symlinks form a loop", async () => {
    const home = makeTempHome();
    const workspacePath = join(home, "workspace");
    const root = workspaceSkillRoot(workspacePath);
    writeSkill(
      root,
      "cyclic-skill",
      `---
name: cyclic-skill
description: cyclic
---
cyclic-body`,
    );
    mkdirSync(root, { recursive: true });
    symlinkSync(root, join(root, "loop-back"), "dir");

    const service = await createSkillsServiceInEnv(home, { isDesktopRuntime: true });
    const result = await service.list({ workspacePath, provider: "glm" });

    expect(result.skills.map((skill) => skill.name)).toEqual(["cyclic-skill"]);
  });
});
