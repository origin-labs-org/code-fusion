import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ExecutionPort, ExecutionResult, SessionId } from "@origin-ai/cf-contracts";
import { resolveCfBuiltinPromptCommand } from "../src/builtin-prompt-command.js";
import { resolveCfCustomCommandPrompt } from "../src/custom-command-prompt.js";
import { listProtocolSlashCommands } from "../src/cf-protocol/slash-commands.js";

describe("protocol slash command surface", () => {
  it("returns app-supported builtins plus agent-discovered custom commands", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "cf-protocol-slash-"));
    const workspace = join(tempRoot, "workspace");
    const home = join(tempRoot, "home");
    const projectCommands = join(workspace, ".cf", "commands");
    const userCommands = join(home, ".cf", "commands");

    try {
      await mkdir(projectCommands, { recursive: true });
      await mkdir(userCommands, { recursive: true });
      await writeCommand(projectCommands, "review", "Project review", "Project body.");
      await writeCommand(userCommands, "review", "User review", "User body.");
      await writeCommand(userCommands, "ship", "Ship changes", "Ship $ARGUMENTS.", [
        "argument-hint: [target]",
      ]);
      await writeCommand(userCommands, "model", "Reserved custom model", "Should be hidden.");
      await writeCommand(userCommands, "plan", "Reserved custom plan", "Should be hidden.");
      await writeCommand(userCommands, "offline", "Noninteractive disabled", "Hidden.", [
        "disable-noninteractive: true",
      ]);
      await writeCommand(userCommands, "workflow", "Shadowing workflow", "Should be hidden.");

      const commands = await listProtocolSlashCommands({
        env: { CF_ENV: "test" },
        homeDirectory: home,
        skipUserConfig: true,
        workingDirectory: workspace,
      });

      expect(commands.map((command) => ({ name: command.name, source: command.source }))).toEqual([
        { name: "goal", source: "builtin" },
        { name: "workflow", source: "builtin" },
        { name: "compact", source: "builtin" },
        { name: "init", source: "builtin" },
        { name: "review", source: "custom" },
        { name: "ship", source: "custom" },
      ]);
      expect(commands.find((command) => command.name === "review")?.description).toBe(
        "User review",
      );
      expect(commands.find((command) => command.name === "ship")?.inputHint).toBe("/ship [target]");
      expect(commands.find((command) => command.name === "workflow")?.inputHint).toBe(
        "/workflow [what the workflow should accomplish]",
      );
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
    }
  });

  it("expands prompt custom commands without taking over reserved builtins", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "cf-custom-command-prompt-"));
    const workspace = join(tempRoot, "workspace");
    const home = join(tempRoot, "home");
    const userCommands = join(home, ".cf", "commands");

    try {
      await mkdir(workspace, { recursive: true });
      await mkdir(userCommands, { recursive: true });
      await writeCommand(userCommands, "review", "Review changes", "Review $ARGUMENTS.");
      await writeCommand(userCommands, "init", "Custom init", "Should not expand.");
      await writeCommand(userCommands, "model", "Reserved model", "Should not expand.");
      await writeCommand(userCommands, "plan", "Reserved Plan action", "Should not expand.");

      const options = {
        env: { CF_ENV: "test" },
        homeDirectory: home,
        skipUserConfig: true,
        workingDirectory: workspace,
      };
      const prompt = await resolveCfCustomCommandPrompt("/review src packages", options);

      expect(prompt).toContain("Run custom command /review.");
      expect(prompt).toContain("Command source: user/cf.");
      expect(prompt).toContain("Review src packages.");
      await expect(resolveCfCustomCommandPrompt("/model glm-5", options)).resolves.toBe(
        undefined,
      );
      await expect(resolveCfCustomCommandPrompt("/plan task", options)).resolves.toBe(undefined);
      expect(resolveCfBuiltinPromptCommand("/plan task", { workingDirectory: workspace })).toBe(
        undefined,
      );
      await expect(resolveCfCustomCommandPrompt("/init", options)).resolves.toBe(undefined);
      await expect(resolveCfCustomCommandPrompt("please /review", options)).resolves.toBe(
        undefined,
      );
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
    }
  });

  it("expands builtin /workflow through the builtin resolver only, gated by the feature flag", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "cf-builtin-workflow-"));
    const workspace = join(tempRoot, "workspace");
    const home = join(tempRoot, "home");
    const userCommands = join(home, ".cf", "commands");
    try {
      await mkdir(workspace, { recursive: true });
      await mkdir(userCommands, { recursive: true });
      await writeCommand(userCommands, "workflow", "Shadowing workflow", "Should not expand.");
      const options = {
        env: { CF_ENV: "test" },
        homeDirectory: home,
        skipUserConfig: true,
        workingDirectory: workspace,
      };

      const expanded = resolveCfBuiltinPromptCommand("/workflow ship it", {
        dynamicWorkflowEnabled: true,
        workingDirectory: workspace,
      });
      expect(expanded).toContain("Required skills: `dynamic-workflows`.");
      expect(expanded).toContain("ship it");
      expect(expanded).not.toContain("Should not expand.");
      expect(
        resolveCfBuiltinPromptCommand("/workflow ship it", { workingDirectory: workspace }),
      ).toContain("ship it");
      expect(
        resolveCfBuiltinPromptCommand("/workflow ship it", {
          dynamicWorkflowEnabled: false,
          workingDirectory: workspace,
        }),
      ).toBe(undefined);
      await expect(resolveCfCustomCommandPrompt("/workflow ship it", options)).resolves.toBe(
        undefined,
      );
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
    }
  });

  it("expands builtin /init into the workspace AGENTS.md prompt", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "cf-builtin-init-"));
    const workspace = join(tempRoot, "workspace");

    try {
      await mkdir(workspace, { recursive: true });
      const prompt = resolveCfBuiltinPromptCommand("/init include pnpm scripts", {
        workingDirectory: workspace,
      });

      expect(prompt).toContain("built-in /init command");
      expect(prompt).toContain("AGENTS.md");
      expect(prompt).toContain(join(workspace, "AGENTS.md"));
      expect(prompt).toContain(join(workspace, ".cf", "AGENTS.md"));
      expect(prompt).toContain(join(workspace, ".agents", "AGENTS.md"));
      expect(prompt).toContain("they already have an instructions file");
      expect(prompt).not.toContain("Do not create CLAUDE.md or AGNENTS.md");
      expect(prompt).toContain("include pnpm scripts");
      expect(resolveCfBuiltinPromptCommand("/review", { workingDirectory: workspace })).toBe(
        undefined,
      );
      expect(
        resolveCfBuiltinPromptCommand("please /init", { workingDirectory: workspace }),
      ).toBe(undefined);
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
    }
  });

  it("runs shell expansion for plugin commands with plugin and session variables", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "cf-plugin-command-shell-"));
    const workspace = join(tempRoot, "workspace");
    const pluginRoot = join(tempRoot, "ralph-loop");
    const commandsRoot = join(pluginRoot, "commands");
    const pluginDataRoot = join(tempRoot, "plugins");
    const configPath = join(tempRoot, "config.json");
    const sessionId = "sess_shell_expansion" as SessionId;
    let capturedRequest: Parameters<ExecutionPort["run"]>[0] | undefined;
    const executionPort: ExecutionPort = {
      async run(request) {
        capturedRequest = request;
        return createExecutionResult("ralph setup output");
      },
    };

    try {
      await mkdir(commandsRoot, { recursive: true });
      await mkdir(join(pluginRoot, ".claude-plugin"), { recursive: true });
      await writeFile(
        join(pluginRoot, ".claude-plugin", "plugin.json"),
        JSON.stringify({ name: "ralph-loop", version: "1.0.0" }),
      );
      await writeCommand(
        commandsRoot,
        "ralph-loop",
        "Start Ralph",
        [
          "Before",
          "```!",
          'echo "${CLAUDE_PLUGIN_ROOT}/scripts/setup-ralph-loop.sh" "$ARGUMENTS"',
          "```",
          "After",
        ].join("\n"),
      );
      await writeFile(
        configPath,
        JSON.stringify({
          plugins: {
            dirs: [pluginRoot],
            enabled: true,
          },
          storage: {
            dir: pluginDataRoot,
          },
        }),
      );

      const prompt = await resolveCfCustomCommandPrompt("/ralph-loop build demo", {
        env: { CF_ENV: "test" },
        executionPort,
        projectConfigPath: configPath,
        sessionId,
        skipUserConfig: true,
        workingDirectory: workspace,
      });

      expect(prompt).toContain("ralph setup output");
      expect(prompt).not.toContain("```!");
      expect(capturedRequest?.command).toMatchObject({
        command: 'echo "${CLAUDE_PLUGIN_ROOT}/scripts/setup-ralph-loop.sh" "build demo"',
        mode: "shell",
      });
      expect(capturedRequest?.cwd).toBe(workspace);
      expect(capturedRequest?.env?.set).toMatchObject({
        CLAUDE_CODE_SESSION_ID: sessionId,
        CLAUDE_PLUGIN_ROOT: pluginRoot,
        CLAUDE_PROJECT_DIR: workspace,
        CLAUDE_SESSION_ID: sessionId,
        CF_PLUGIN_ROOT: pluginRoot,
        CF_PROJECT_DIR: workspace,
        CF_SESSION_ID: sessionId,
      });
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
    }
  });

  it("fails shell-expanded custom commands that request unavailable contexts", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "cf-command-shell-missing-context-"));
    const workspace = join(tempRoot, "workspace");
    const home = join(tempRoot, "home");
    const userCommands = join(home, ".cf", "commands");
    let executionCalled = false;
    const executionPort: ExecutionPort = {
      async run() {
        executionCalled = true;
        return createExecutionResult("should not run");
      },
    };

    try {
      await mkdir(userCommands, { recursive: true });
      await writeCommand(
        userCommands,
        "skill-context",
        "Needs skill context",
        ["```!", 'echo "${CLAUDE_SKILL_DIR}"', "```"].join("\n"),
      );
      await writeCommand(
        userCommands,
        "session-context",
        "Needs session context",
        ["```!", 'echo "${CLAUDE_SESSION_ID}"', "```"].join("\n"),
      );

      const options = {
        env: { CF_ENV: "test" },
        executionPort,
        homeDirectory: home,
        skipUserConfig: true,
        workingDirectory: workspace,
      };

      await expect(resolveCfCustomCommandPrompt("/skill-context", options)).rejects.toThrow(
        "Custom command /skill-context variable requires a skill context: CLAUDE_SKILL_DIR",
      );
      await expect(resolveCfCustomCommandPrompt("/session-context", options)).rejects.toThrow(
        "Custom command /session-context variable requires a runtime session context: CLAUDE_SESSION_ID",
      );
      expect(executionCalled).toBe(false);
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
    }
  });
});

async function writeCommand(
  directory: string,
  name: string,
  description: string,
  body: string,
  extraFrontmatter: string[] = [],
): Promise<void> {
  await writeFile(
    join(directory, `${name}.md`),
    ["---", `description: ${description}`, ...extraFrontmatter, "---", "", body].join("\n"),
  );
}

function createExecutionResult(stdout: string): ExecutionResult {
  const now = new Date();
  return {
    status: "completed",
    exitCode: 0,
    stdout: { text: stdout, bytes: stdout.length, truncated: false },
    stderr: { text: "", bytes: 0, truncated: false },
    durationMs: 1,
    timedOut: false,
    cancelled: false,
    startedAt: now,
    completedAt: now,
  };
}
