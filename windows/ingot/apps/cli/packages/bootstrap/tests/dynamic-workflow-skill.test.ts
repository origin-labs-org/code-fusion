// ============================================================
// bundled-skills: builtin /workflow command + dynamic-workflows skill tripwire
// ============================================================
//
//
//

import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createNodeSkillAdapter } from "@origin-ai/cf-adapters/skills";
import type { SkillRoot } from "@origin-ai/cf-contracts";
import { analyzeWorkflowScript, compileWorkflowScript, FACADE_DTS } from "@origin-ai/cf-dynamic-workflow";
import { describe, expect, it } from "vitest";
import {
  BUNDLED_SKILL_PACK_REQUIRED_PATHS,
  DYNAMIC_WORKFLOW_SKILL_NAME,
  resolveBundledSkillRoots,
} from "../src/app/bundled-skills.js";
import { collectDynamicWorkflowDisabledSkillPaths } from "../src/app/dynamic-workflow-gate.js";
import {
  resolveCfBuiltinPromptCommand,
  resolveCfBuiltinPromptCommandInvocation,
} from "../src/builtin-prompt-command.js";
import {
  BUILTIN_WORKFLOW_COMMAND,
  BUILTIN_WORKFLOW_COMMAND_NAME,
  expandBuiltinWorkflowCommandPrompt,
} from "../src/builtin-workflow-command.js";

const PACKAGES_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PACK_ROOT = join(PACKAGES_ROOT, "bundled-skills");
const SKILL_NAME = DYNAMIC_WORKFLOW_SKILL_NAME;
const SKILL_DIR = join(PACK_ROOT, "skills", SKILL_NAME);

const GUIDE_PLUGIN_SKILLS_ROOT = join(PACKAGES_ROOT, "cf-guide-plugin", "skills");

const SKILL_FILES = ["SKILL.md", "patterns.md", "examples.md"] as const;

const MAX_DESCRIPTION_LENGTH = 1024;

const LISTING_DESCRIPTION_CHARS = 250;

const SKILL_TOOL_MAX_BYTES = 200_000;

const FACADE_BLOCK_START = "<!-- facade-dts:start -->";
const FACADE_BLOCK_END = "<!-- facade-dts:end -->";
const FACADE_BLOCK_PATTERN = /<!-- facade-dts:start -->[\s\S]*?<!-- facade-dts:end -->/g;

function stripFacadeBlock(text: string): string {
  return text.replace(FACADE_BLOCK_PATTERN, "");
}

async function readSkillFile(name: string): Promise<string> {
  return readFile(join(SKILL_DIR, name), "utf8");
}

async function readAllContent(): Promise<{ name: string; text: string }[]> {
  const skills = await Promise.all(
    SKILL_FILES.map(async (name) => ({ name, text: stripFacadeBlock(await readSkillFile(name)) })),
  );
  return [...skills, { name: "builtin /workflow", text: BUILTIN_WORKFLOW_COMMAND.content }];
}

function parseFlatFrontmatter(text: string): Record<string, string> {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") return {};
  const end = lines.indexOf("---", 1);
  if (end === -1) return {};
  const entries: Record<string, string> = {};
  for (const line of lines.slice(1, end)) {
    if (/^\s/.test(line)) continue;
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const raw = line.slice(separator + 1).trim();
    entries[key] = raw.replace(/^"(.*)"$/s, "$1").replace(/^'(.*)'$/s, "$1");
  }
  return entries;
}

describe("builtin /workflow command", () => {
  it("declares the skill it depends on and passes the user's request through", () => {
    expect(BUILTIN_WORKFLOW_COMMAND.metadata.name).toBe(BUILTIN_WORKFLOW_COMMAND_NAME);
    expect(BUILTIN_WORKFLOW_COMMAND.metadata.skills).toEqual([SKILL_NAME]);
    expect(BUILTIN_WORKFLOW_COMMAND.metadata.description).toBeTruthy();
    expect(BUILTIN_WORKFLOW_COMMAND.metadata.argumentHint).toBeTruthy();

    expect(BUILTIN_WORKFLOW_COMMAND.content).toContain("$ARGUMENTS");

    const prompt = expandBuiltinWorkflowCommandPrompt("ship the release");
    expect(prompt).toContain(`Required skills: \`${SKILL_NAME}\`.`);
    expect(prompt).toContain(`call the Skill tool for \`${SKILL_NAME}\``);
    expect(prompt).toContain("ship the release");
    expect(prompt).toContain("`CreateWorkflow`");
    expect(prompt).not.toContain("$ARGUMENTS");
  });

  it("expands through the builtin prompt resolver, and not while the gray gate is off", () => {
    expect(resolveCfBuiltinPromptCommand("/workflow ship it")).toContain("ship it");
    expect(
      resolveCfBuiltinPromptCommand("/workflow ship it", { dynamicWorkflowEnabled: true }),
    ).toContain("ship it");
    expect(
      resolveCfBuiltinPromptCommand("/workflow ship it", { dynamicWorkflowEnabled: false }),
    ).toBe(undefined);
    expect(resolveCfBuiltinPromptCommand("/workflow")).toContain("Required skills");
    expect(resolveCfBuiltinPromptCommand("please /workflow now")).toBe(undefined);
  });

  it("invocation 形态带命令名", () => {
    expect(resolveCfBuiltinPromptCommandInvocation("/workflow ship it")).toMatchObject({
      name: BUILTIN_WORKFLOW_COMMAND_NAME,
    });
    expect(resolveCfBuiltinPromptCommandInvocation("/WORKFLOW ship it")?.name).toBe(
      BUILTIN_WORKFLOW_COMMAND_NAME,
    );
    expect(resolveCfBuiltinPromptCommandInvocation("/init")?.name).toBe("init");
    expect(
      resolveCfBuiltinPromptCommandInvocation("/workflow x", { dynamicWorkflowEnabled: false }),
    ).toBeUndefined();
    expect(resolveCfBuiltinPromptCommandInvocation("/unknown")).toBeUndefined();
  });
});

describe("bundled dynamic-workflows skill", () => {
  it("loads: name matches the directory, description fits the loader's cap", async () => {
    const frontmatter = parseFlatFrontmatter(await readSkillFile("SKILL.md"));

    expect(frontmatter.name).toBe(SKILL_NAME);
    expect(frontmatter.description).toBeTruthy();
    expect(frontmatter.description.length).toBeLessThan(MAX_DESCRIPTION_LENGTH);

    expect(frontmatter.description.slice(0, LISTING_DESCRIPTION_CHARS)).toContain("CreateWorkflow");
  });

  it("ships every file the pack contract pins, and the pack pins every file shipped", async () => {
    const contents = await Promise.all(SKILL_FILES.map((name) => readSkillFile(name)));
    for (const text of contents) expect(text.length).toBeGreaterThan(0);

    const pinned = new Set(BUNDLED_SKILL_PACK_REQUIRED_PATHS);
    for (const name of SKILL_FILES) expect(pinned).toContain(`skills/${SKILL_NAME}/${name}`);
    expect(pinned.size).toBe(SKILL_FILES.length);
  });

  it("embeds the facade verbatim, once, and stays under the Skill tool's byte cap", async () => {
    const skill = await readSkillFile("SKILL.md");
    const block = `${FACADE_BLOCK_START}\n\`\`\`ts\n${FACADE_DTS.trim()}\n\`\`\`\n${FACADE_BLOCK_END}`;
    expect(skill.split(block)).toHaveLength(2);
    expect(skill.match(FACADE_BLOCK_PATTERN)).toHaveLength(1);
    expect(Buffer.byteLength(skill, "utf8")).toBeLessThan(SKILL_TOOL_MAX_BYTES);
  });

  it("carries the contract the tool descriptions used to carry", async () => {
    const skill = await readSkillFile("SKILL.md");
    expect(skill).toContain("## 16. Tool reference");
    expect(skill).toContain("refuses\nto run until this skill has been loaded");
    expect(skill).toContain("**Three sources; pass exactly one.**");
    expect(skill).toContain(
      "Running a saved workflow\n  is the one call that does not need this skill loaded",
    );
    expect(skill).toContain("`max_concurrency`");
    expect(skill).toContain("`subagent_model`");
    expect(skill).toContain("do not imitate it");
    expect(skill).toContain("Never use the `declare` modifier");
    expect(skill).toContain("`noUncheckedIndexedAccess` off");
    expect(skill).toContain("needs no guard");
    expect(skill).toContain("No `export` statements");
    expect(skill).toContain("No `import` statements");
    expect(skill).toContain("compile-time string\n  literal");
    expect(skill).toContain("standalone\n  statement");
    expect(skill).toContain("Two markers\n  with the same name are one phase");
    expect(skill).toContain("unique within the\n  run");
    expect(skill).toContain("Model-side errors never reach the script");
    expect(skill).toContain("`ContextLimit`");
    expect(skill).toContain("Never put the same content in both");
    expect(skill).toContain("never\n  paste the script a second time");
    expect(skill).toContain("### 16.4 `AmendWorkflow`");
    expect(skill).toContain("`script_unchanged`");
    const amend = skill.slice(skill.indexOf("### 16.4 `AmendWorkflow`"), skill.indexOf("### 16.5"));
    const keptScript = amend.indexOf("Omit both to keep the predecessor's script");
    const limit = amend.indexOf("- `max_concurrency`: omit to keep the predecessor's limit");
    const inPlace = amend.indexOf("retunes that run in place");
    const model = amend.indexOf("- `subagent_model`: omit to keep the predecessor's choice");
    expect(keptScript).toBeGreaterThan(-1);
    expect(keptScript).toBeLessThan(limit);
    expect(limit).toBeLessThan(inPlace);
    expect(inPlace).toBeLessThan(model);
    expect(amend).toContain("`path` or `script`, never both. `path` is the usual form");
    expect(skill).toContain("picks that\nask up where it left off");
    expect(skill).toContain("**How the cache works.**");
    expect(skill).toContain("Asks that only\nanswered keep settling from the cache");
    expect(skill).not.toContain(
      "every ask to any subagent runs live even if its text is unchanged",
    );
    expect(skill).toContain("### 16.5 `SaveWorkflow`");
    expect(skill).toContain("Never unsolicited");
    expect(skill).toContain("`script_path`");
    expect(skill).toContain("### 16.6 `EvalWorkflowSnippet`");
    expect(skill).toContain("do not exist here and\n  fail typechecking");
  });

  it("never restates the facade outside its marked block", async () => {
    for (const { name, text } of await readAllContent()) {
      expect(text, name).not.toMatch(/\bdeclare\s/);
      expect(text, name).not.toMatch(/^\s*import\s/m);
      expect(text, name).not.toMatch(/^\s*export\s/m);
    }
  });

  it("mentions only facade members that actually exist", async () => {
    for (const { name, text } of await readAllContent()) {
      for (const [, container, member] of text.matchAll(
        /\b(artifact|files|git|world)\.([A-Za-z_$][\w$]*)/g,
      )) {
        expect(FACADE_DTS, `${name}: ${container}.${member}`).toContain(`${member}(`);
      }
    }
  });

  it("teaches world.run and the EvalWorkflowSnippet pre-flight (amendment 1)", async () => {
    const skill = await readSkillFile("SKILL.md");
    expect(skill).toContain("world.run");
    expect(skill).toContain("EvalWorkflowSnippet");
    const patterns = await readSkillFile("patterns.md");
    expect(patterns).toContain("world.run");
  });

  it("teaches artifact delivery: file, markdown and the report-fed dashboard (amendment 6)", async () => {
    const skill = await readSkillFile("SKILL.md");
    expect(skill).toContain("**Deliver artifacts.**");
    expect(skill).toContain('report(item, "perf")');
    expect(skill).toContain("compile-time string literals");
    expect(skill).toContain("reject catchably");
  });

  it("teaches no persona knob: neither a tool profile nor a model tier (amendments 7–8)", async () => {
    for (const { name, text } of await readAllContent()) {
      expect(text, `${name}: persona tools`).not.toMatch(/\btools:\s*"/);
      expect(text, `${name}: persona model tier`).not.toMatch(
        /\bmodel:\s*"(lite|main|fast|strong)"/,
      );
      expect(text, `${name}: tool profile vocabulary`).not.toMatch(
        /ToolProfile|"readonly"|read-only subagent/,
      );
    }
  });

  it("teaches pipelining as the default and a join as the exception", async () => {
    const skill = await readSkillFile("SKILL.md");
    expect(skill).toContain(
      "## 7. Pipeline by default; join only where the next step needs every item",
    );
    expect(skill).toContain("each item moves on the moment it is ready");
    expect(skill).toContain("**Decide, at every hand-off, how an item leaves its stage:**");
    expect(skill).toContain("a join, with a comment saying what needs every item");
    expect(skill).toContain("**Where each item goes next.**");
    expect(skill).toContain("at every `Promise.all`\nask whether the next step needs every item");
    const patterns = await readSkillFile("patterns.md");
    expect(patterns).toContain("**Start with the pipeline shapes.**");
    expect(patterns).toContain("## 6. Staged handoff with typed results");
    expect(patterns).not.toContain('phase("Decide which model each question needs")');
    expect(patterns).toContain(
      'phase("Route each question to the model it needs and answer it there")',
    );
  });

  it("teaches the per-subagent model: a literal, a model() table, and routing by a typed key", async () => {
    const skill = await readSkillFile("SKILL.md");
    expect(skill).toContain("**Per-subagent model**");
    expect(skill).toContain('agent("judge", { model: "GLM-5.3-Flash" })');
    expect(skill).toContain("`ListModels`");
    expect(skill).toContain("(`patterns.md` #13)");
    const patterns = await readSkillFile("patterns.md");
    expect(patterns).toContain("## 13. Model routing");
    expect(patterns).toContain("model: MODELS[route.tier]");
  });

  it("does not leak the other Workflow API's vocabulary", async () => {
    const foreign = [
      /\bpipeline\(/,
      /\bparallel\(/,
      /\bbudget\b/i,
      /\bagentType\b/,
      /\bisolation:/,
      /\beffort:/,
      /\bschema:/,
    ];
    for (const { name, text } of await readAllContent()) {
      for (const pattern of foreign) {
        expect(text, `${name}: ${String(pattern)}`).not.toMatch(pattern);
      }
    }
  });

  it("uses phase() in the dwf marker form, never the other Workflow API's", async () => {
    for (const { name, text } of await readAllContent()) {
      for (const [call] of text.matchAll(/\bphase\([^)]*\)/g)) {
        expect(call, `${name}: ${call}`).toMatch(/^phase\("[^"]+"\)$/);
      }
    }
  });

  it("teaches gate adequacy: survey the repository's checks, strongest tier decides the exit", async () => {
    const skill = await readSkillFile("SKILL.md");
    expect(skill).toContain("**Choose the gate before you write it.**");
    expect(skill).toContain("**Gate at the task's scale.**");
    expect(skill).toContain("Run the end-to-end suite once before handing over");
    expect(skill).toContain('phase("Measure whether it is actually faster")');
    expect(skill).not.toContain('phase("Verify it actually works")');

    const patterns = await readSkillFile("patterns.md");
    expect(patterns).toContain('!check.stderr.includes("sorry")');
    expect(patterns).toContain("Build the whole project once before handing over");

    const examples = await readSkillFile("examples.md");
    expect(examples).toContain("Run the whole test suite once over the migrated tree");
    expect(examples).toContain("Build the whole project with the new proof");
    expect(examples).toContain("Run the property tests for real");
  });

  it("teaches verify-before-report, the unconfirmed label, and the report shape", async () => {
    const skill = await readSkillFile("SKILL.md");
    expect(skill).toContain("## The bar: first-class, expert-level work");
    expect(skill).toContain("## 3. Fresh eyes");
    expect(skill).toContain("Ask for failures, not approval.");
    expect(skill).toContain("An explicit workflow request is a request for depth");
    expect(skill).toContain(
      "**Verify before you report, in proportion to what a wrong claim costs.**",
    );
    expect(skill).toContain("`unconfirmed`");
    expect(skill).toContain("interface WorkflowReport");
    expect(skill).toContain("notCovered");
    expect(skill).not.toContain("not to your ambition");

    const patterns = await readSkillFile("patterns.md");
    expect(patterns).toContain("confirmer-");
    const examples = await readSkillFile("examples.md");
    expect(examples).toContain("conclusion:");
    expect(examples).toContain("notCovered:");
  });

  it("teaches proportional verification, per-item streaming, and mid-run repair (amendment 10)", async () => {
    const skill = await readSkillFile("SKILL.md");
    expect(skill).toContain("**Chaining.** When two stages map one to one");
    expect(skill).toContain("**Not inside a concurrent fan-out callback.**");
    expect(skill).toContain("Three things that look like verification and are waste.");
    expect(skill).toContain("**Repair a run while it is still going.**");
    expect(skill).toContain("`Promise.allSettled`");
    expect(skill).toContain("## 11. A complete example");
    expect(skill).toContain("`${CF_SKILL_DIR}/examples.md` §5");
    const movedExample = await readSkillFile("examples.md");
    expect(movedExample).toContain("## 5. Changed-file review with confirmation as reviews land");
    expect(movedExample).toContain("confirmer-${p}-${index}");
    expect(movedExample).not.toContain(
      'phase("Confirm each kept finding independently and report it")',
    );
    for (const { name, text } of await readAllContent()) {
      expect(text, name).not.toMatch(/first subagent with tools/i);
    }

    const patterns = await readSkillFile("patterns.md");
    expect(patterns).toContain("## 10. Per-item pipeline");
    expect(patterns).toContain("A queue is not a barrier");
    const examples = await readSkillFile("examples.md");
    expect(examples).toContain(
      'phase("Judge each candidate and confirm the real ones as they are judged")',
    );
    expect(examples).not.toContain('phase("Confirm each survivor by reproducing it")');
  });

  it("teaches the script-file loop: edit the file, resubmit by path", async () => {
    const skill = await readSkillFile("SKILL.md");
    expect(skill).toContain(".cf/workflow-drafts/");
    expect(skill).toContain("{path}:L{line}:C{column} {message}");
    expect(skill).toContain(
      "**Edit that file and resubmit with `path`. Do not paste the script inline again**",
    );
    expect(skill).toContain("edit the run's script file, which the notification names,");
    expect(skill).toContain("**Every run remembers its script file, so a revision is an `Edit`.**");
    expect(skill).toContain("`scriptPath`");
    expect(skill).toContain("**Editing a draft asks nothing.**");
    expect(skill).toContain("or as `path` to a file holding it");
    for (const { name, text } of await readAllContent()) {
      expect(text, name).not.toMatch(/call\s+`CreateWorkflow` again/);
      expect(text, name).not.toMatch(/resubmit with `AmendWorkflow`\./);
    }
  });

  it("teaches writing for the user, and does not claim an analyzer warning", async () => {
    const skill = await readSkillFile("SKILL.md");
    expect(skill).toMatch(/^## \d+\. Write for the user$/m);
    expect(skill).toContain("文件评审阶段");
    expect(skill).toContain("The language travels through your asks");
    expect(skill).toContain("独立评审员");
    expect(skill).toContain("冷读方案");

    for (const { name, text } of await readAllContent()) {
      expect(text, name).not.toMatch(/compiler warns/i);
      expect(text.replace(/^\| .*$/gm, ""), name).not.toMatch(/cold[- ]read|cold-reviewer/i);
    }
  });

  it("names CreateWorkflow explicitly wherever it routes", async () => {
    for (const { name, text } of await readAllContent()) {
      expect(text, name).toContain("CreateWorkflow");
      expect(text, name).not.toMatch(/\bthe workflow tool\b/i);
    }
  });

  it("compiles every script block marked as complete", async () => {
    const marked: { file: string; index: number; source: string }[] = [];
    for (const { name, text } of await readAllContent()) {
      const blocks = [...text.matchAll(/<!-- compile -->\n```ts\n([\s\S]*?)```/g)];
      blocks.forEach((match, index) => {
        marked.push({ file: name, index, source: match[1] });
      });
    }

    expect(marked.length).toBeGreaterThanOrEqual(6);

    for (const { file, index, source } of marked) {
      const result = compileWorkflowScript(source);
      expect(result.diagnostics, `${file} block #${index}`).toEqual([]);
      expect(result.ok, `${file} block #${index}`).toBe(true);
      const analyzed = analyzeWorkflowScript(source);
      expect(analyzed.diagnostics, `${file} block #${index} (analyze)`).toEqual([]);
      expect(analyzed.ok, `${file} block #${index} (analyze)`).toBe(true);
    }
  });
});

describe("gray release gate names stay pinned to the real bundled assets", () => {
  function bundledRoots(): SkillRoot[] {
    return resolveBundledSkillRoots({ cliStorageRoot: join(tmpdir(), "cf-unused-cli-storage") });
  }

  it("内置技能包解析到真实的 skills 目录，且剔除路径正好落在 dynamic-workflows SKILL.md 上", () => {
    const roots = bundledRoots();
    expect(roots).toEqual([
      {
        path: join(PACK_ROOT, "skills"),
        priority: expect.any(Number),
        scope: "system",
        source: "bundled",
      },
    ]);
    expect(collectDynamicWorkflowDisabledSkillPaths(roots)).toEqual([join(SKILL_DIR, "SKILL.md")]);
  });

  
  describe("real NodeSkillAdapter discovery", () => {
    const guidePluginRoot: SkillRoot = {
      path: GUIDE_PLUGIN_SKILLS_ROOT,
      priority: 0,
      scope: "system",
      source: "plugin",
    };

    async function discoveredSkills(
      disabledPaths: string[],
    ): Promise<Array<{ name: string; source: string }>> {
      const adapter = createNodeSkillAdapter({ disabledPaths });
      const outcome = await adapter.discoverSkills({
        workingDirectory: PACK_ROOT,
        roots: [guidePluginRoot, ...bundledRoots()],
      });
      return outcome.skills.map((skill) => ({ name: skill.name, source: skill.source }));
    }

    it("灰度开启（无门禁路径）时目录里有 dynamic-workflows，且来源是 bundled", async () => {
      await expect(discoveredSkills([])).resolves.toContainEqual({
        name: SKILL_NAME,
        source: "bundled",
      });
    });

    it("灰度关闭时 dynamic-workflows 消失，插件技能仍在", async () => {
      const skills = await discoveredSkills(
        collectDynamicWorkflowDisabledSkillPaths(bundledRoots()),
      );
      const names = skills.map((skill) => skill.name);
      expect(names).not.toContain(SKILL_NAME);
      expect(names).toContain("cf-configuration-guide");
      expect(names.length).toBeGreaterThan(1);
    });
  });
});
