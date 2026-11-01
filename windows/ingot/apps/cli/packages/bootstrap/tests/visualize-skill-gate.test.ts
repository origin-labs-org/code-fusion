import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConfig } from "@origin-ai/cf-adapters/config";
import { createNodeSkillAdapter } from "@origin-ai/cf-adapters/skills";
import type { Logger } from "@origin-ai/cf-contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkflowChildSkillPort } from "../src/app/script-workflow-child-runtime.js";
import { resolveStartupPlugins } from "../src/app/startup-marks.js";
import type { CfApp, CfAppOptions } from "../src/app/types.js";
import { inspectCfSkill, listCfSkills } from "../src/skills.js";
import { StartupTimer } from "../src/startup-logging.js";
import { getSkillReferenceCatalog } from "../src/cf-protocol/skill-reference-catalog.js";
import type { CfProtocolAgentServerContext } from "../src/cf-protocol/server-types.js";
import { createWorkspaceCfApp } from "../src/cf-protocol/workspace-model-runtime.js";

const VISUALIZE_PLUGIN_ID = "visualize@cf-plugins-official";
const VISUALIZE_SKILL = "visualize:visualize";
const logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
} as unknown as Logger;

describe("visualize protocol-only skill discovery", () => {
  let root: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "cf-visualize-gate-"));
    env = { CF_STORAGE_DIR: join(root, "storage") };
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it.each([undefined, false, true])(
    "list and inspect agree with includeVisualize=%s",
    async (includeVisualize) => {
      const options = { env, includeVisualize, skipUserConfig: true, workingDirectory: root };
      const outcome = await listCfSkills(options);
      expect(outcome.skills.some((skill) => skill.pluginId === VISUALIZE_PLUGIN_ID)).toBe(
        includeVisualize === true,
      );
      expect(outcome.skills.some((skill) => skill.name === "pdf")).toBe(true);
      for (const name of ["visualize", VISUALIZE_SKILL]) {
        if (includeVisualize) {
          const result = await inspectCfSkill({ ...options, name });
          expect(result.skill.metadata.pluginId).toBe(VISUALIZE_PLUGIN_ID);
          expect(result.skill.content).toContain("Inline HTML output contract");
        } else {
          await expect(inspectCfSkill({ ...options, name })).rejects.toThrow("Skill not found:");
        }
      }
    },
  );

  it.each([undefined, false, true])(
    "startup and workflow child agree with includeVisualize=%s",
    async (includeVisualize) => {
      const configResult = createConfig({ env, skipUserConfig: true, workingDirectory: root });
      const appOptions = { includeVisualize } as CfAppOptions;
      const plugins = resolveStartupPlugins({
        cliStorageRoot: join(root, "storage", "cli"),
        configResult,
        env,
        options: appOptions,
        startupTimer: new StartupTimer(logger, {}),
        workingDirectory: root,
      });
      const parentPort = createNodeSkillAdapter({ extraResolvedRoots: plugins.skillRoots });
      const childPort = createWorkflowChildSkillPort({
        appOptions,
        configResult,
        pluginSkillRoots: plugins.skillRoots,
      });
      for (const port of [parentPort, childPort!]) {
        const outcome = await port.discoverSkills({ workingDirectory: root });
        expect(outcome.skills.some((skill) => skill.pluginId === VISUALIZE_PLUGIN_ID)).toBe(
          includeVisualize === true,
        );
        expect(outcome.skills.some((skill) => skill.name === "pdf")).toBe(true);
      }
    },
  );

  it("keeps project skills with the same name available in CLI", async () => {
    const skillDir = join(root, ".agents", "skills", "visualize");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: visualize\ndescription: Project visualization.\n---\nProject skill.",
    );
    const result = await inspectCfSkill({
      env,
      skipUserConfig: true,
      workingDirectory: root,
      name: "visualize",
    });
    expect(result.skill.metadata.source).toBe("agents");
    expect(result.skill.content).toBe("Project skill.");
  });

  it("does not override explicit plugin disablement in protocol mode", async () => {
    const configPath = join(root, "config.json");
    await writeFile(
      configPath,
      JSON.stringify({ plugins: { enabledPlugins: { [VISUALIZE_PLUGIN_ID]: false } } }),
    );
    const options = {
      env,
      includeVisualize: true,
      userConfigPath: configPath,
      workingDirectory: root,
    };
    const outcome = await listCfSkills(options);
    expect(outcome.skills.some((skill) => skill.pluginId === VISUALIZE_PLUGIN_ID)).toBe(false);
    await expect(inspectCfSkill({ ...options, name: VISUALIZE_SKILL })).rejects.toThrow(
      "Skill not found:",
    );
  });

  it("opts protocol apps in and keeps their draft catalog consistent", async () => {
    const createCfApp = vi.fn(() => ({}) as CfApp);
    const context = {
      deps: { createCfApp, env },
      sessions: new Map(),
    } as unknown as CfProtocolAgentServerContext;
    const workspace = { workspacePath: root, workspaceKey: root };
    await createWorkspaceCfApp(context, workspace, {
      providerRuntimeHeadersPort: {} as CfAppOptions["providerRuntimeHeadersPort"],
    });
    expect(createCfApp).toHaveBeenCalledWith(
      expect.objectContaining({ includeVisualize: true }),
    );
    const catalog = await getSkillReferenceCatalog(context, { workspace });
    expect(catalog.skills).toContainEqual(
      expect.objectContaining({ name: "visualize", pluginName: "visualize" }),
    );
  });
});
