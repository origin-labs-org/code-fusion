import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createNodeCustomCommandAdapter } from "../src/commands/index.js";

describe("NodeCustomCommandAdapter", () => {
  it("discovers project custom commands with frontmatter", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cf-commands-"));
    const commandDir = join(dir, ".cf", "commands", "frontend");

    try {
      await mkdir(commandDir, { recursive: true });
      await writeFile(
        join(commandDir, "review.md"),
        [
          "---",
          "description: Review frontend changes",
          "argument-hint: [scope]",
          "allowed-tools: Read, Grep",
          "skills: frontend-review",
          "---",
          "",
          "Review $ARGUMENTS.",
        ].join("\n"),
      );

      const adapter = createNodeCustomCommandAdapter({ homeDirectory: join(dir, "home") });
      const outcome = await adapter.discoverCommands({ workingDirectory: dir });

      expect(outcome.commands.map((command) => command.name)).toEqual(["frontend:review"]);
      expect(outcome.commands[0]?.description).toBe("Review frontend changes");
      expect(outcome.commands[0]?.argumentHint).toBe("[scope]");
      expect(outcome.commands[0]?.allowedTools).toEqual(["Read", "Grep"]);
      expect(outcome.commands[0]?.skills).toEqual(["frontend-review"]);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("filters out commands disabled via config (enable:false path)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cf-commands-"));
    const commandDir = join(dir, ".cf", "commands");
    const disabledPath = join(commandDir, "disabled.md");

    try {
      await mkdir(commandDir, { recursive: true });
      await writeFile(
        join(commandDir, "kept.md"),
        ["---", "description: Stays available", "---", "", "Body."].join("\n"),
      );
      await writeFile(
        disabledPath,
        ["---", "description: Should be filtered", "---", "", "Body."].join("\n"),
      );

      const adapter = createNodeCustomCommandAdapter({
        homeDirectory: join(dir, "home"),
        disabledPaths: [disabledPath],
      });
      const outcome = await adapter.discoverCommands({ workingDirectory: dir });

      expect(outcome.commands.map((command) => command.name)).toEqual(["kept"]);
      await expect(
        adapter.loadCommand({ name: "disabled", workingDirectory: dir }),
      ).rejects.toThrow(/not found/);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("loads custom command body without frontmatter", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cf-commands-"));
    const commandDir = join(dir, ".cf", "commands");

    try {
      await mkdir(commandDir, { recursive: true });
      await writeFile(
        join(commandDir, "test.md"),
        ["---", "description: Run tests", "---", "", "Run tests for $1."].join("\n"),
      );

      const adapter = createNodeCustomCommandAdapter({ homeDirectory: join(dir, "home") });
      const loaded = await adapter.loadCommand({ name: "test", workingDirectory: dir });

      expect(loaded.content).toBe("Run tests for $1.");
      expect(loaded.metadata.source).toBe("cf");
      expect(loaded.truncated).toBe(false);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("discovers command names with underscores", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cf-commands-"));
    const commandDir = join(dir, ".cf", "commands");

    try {
      await mkdir(commandDir, { recursive: true });
      await writeCommand(commandDir, "clean_gone", "Clean gone git branches");

      const adapter = createNodeCustomCommandAdapter({ homeDirectory: join(dir, "home") });
      const outcome = await adapter.discoverCommands({ workingDirectory: dir });

      expect(outcome.commands.map((command) => command.name)).toEqual(["clean_gone"]);
      expect(outcome.diagnostics).toEqual([]);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("keeps the higher-priority duplicate command", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cf-commands-"));
    const projectDir = join(dir, ".cf", "commands");
    const userDir = join(dir, "home", ".cf", "commands");

    try {
      await mkdir(projectDir, { recursive: true });
      await mkdir(userDir, { recursive: true });
      await writeCommand(projectDir, "review", "Project review");
      await writeCommand(userDir, "review", "User review");

      const adapter = createNodeCustomCommandAdapter({ homeDirectory: join(dir, "home") });
      const outcome = await adapter.discoverCommands({ workingDirectory: dir });

      expect(outcome.commands).toHaveLength(1);
      expect(outcome.commands[0]?.description).toBe("User review");
      expect(outcome.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        "custom_command_duplicate_name",
      );
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("discovers commands under .agents/commands", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cf-commands-"));
    const commandDir = join(dir, ".agents", "commands");

    try {
      await mkdir(commandDir, { recursive: true });
      await writeCommand(commandDir, "agents-cmd", "Lives under .agents/commands");

      const adapter = createNodeCustomCommandAdapter({ homeDirectory: join(dir, "home") });
      const outcome = await adapter.discoverCommands({ workingDirectory: dir });

      expect(outcome.commands.map((command) => command.name)).toEqual(["agents-cmd"]);
      expect(outcome.commands[0]?.source).toBe("agents");
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("merges .cf/commands and .agents/commands with .cf winning duplicates", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cf-commands-"));
    const cfDir = join(dir, ".cf", "commands");
    const agentsDir = join(dir, ".agents", "commands");

    try {
      await mkdir(cfDir, { recursive: true });
      await mkdir(agentsDir, { recursive: true });
      await writeCommand(cfDir, "dup", "From .cf");
      await writeCommand(agentsDir, "dup", "From .agents");
      await writeCommand(agentsDir, "agents-only", "Agents only");

      const adapter = createNodeCustomCommandAdapter({ homeDirectory: join(dir, "home") });
      const outcome = await adapter.discoverCommands({ workingDirectory: dir });

      expect(outcome.commands.map((command) => command.name)).toEqual(["agents-only", "dup"]);
      expect(outcome.commands.map((command) => command.description)).toEqual([
        "Agents only",
        "From .cf",
      ]);
      expect(outcome.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        "custom_command_duplicate_name",
      );
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });
  it("discovers commands imported as file symlinks", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cf-commands-"));
    const sourceDir = join(dir, "source");
    const commandDir = join(dir, ".cf", "commands");

    try {
      await mkdir(sourceDir, { recursive: true });
      await mkdir(commandDir, { recursive: true });
      const sourceFile = join(sourceDir, "commit.md");
      await writeFile(
        sourceFile,
        ["---", "description: Commit staged changes", "---", "", "Commit $ARGUMENTS."].join("\n"),
      );
      await symlink(sourceFile, join(commandDir, "commit.md"));

      const adapter = createNodeCustomCommandAdapter({ homeDirectory: join(dir, "home") });
      const outcome = await adapter.discoverCommands({ workingDirectory: dir });

      expect(outcome.commands.map((command) => command.name)).toEqual(["commit"]);
      expect(outcome.commands[0]?.description).toBe("Commit staged changes");

      const loaded = await adapter.loadCommand({ name: "commit", workingDirectory: dir });
      expect(loaded.content).toBe("Commit $ARGUMENTS.");
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("discovers commands inside a symlinked directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cf-commands-"));
    const sourceDir = join(dir, "source-commands");
    const commandRoot = join(dir, ".cf", "commands");

    try {
      await mkdir(sourceDir, { recursive: true });
      await mkdir(commandRoot, { recursive: true });
      await writeCommand(sourceDir, "deploy", "Deploy the app");
      await symlink(sourceDir, join(commandRoot, "ops"), "dir");

      const adapter = createNodeCustomCommandAdapter({ homeDirectory: join(dir, "home") });
      const outcome = await adapter.discoverCommands({ workingDirectory: dir });

      expect(outcome.commands.map((command) => command.name)).toEqual(["ops:deploy"]);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("skips dangling command symlinks without failing the scan", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cf-commands-"));
    const commandDir = join(dir, ".cf", "commands");

    try {
      await mkdir(commandDir, { recursive: true });
      await writeCommand(commandDir, "kept", "Real command");
      await symlink(join(dir, "does-not-exist.md"), join(commandDir, "broken.md"));

      const adapter = createNodeCustomCommandAdapter({ homeDirectory: join(dir, "home") });
      const outcome = await adapter.discoverCommands({ workingDirectory: dir });

      expect(outcome.commands.map((command) => command.name)).toEqual(["kept"]);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });
});

async function writeCommand(dir: string, name: string, description: string): Promise<void> {
  await writeFile(
    join(dir, `${name}.md`),
    ["---", `description: ${description}`, "---", "", "# Body"].join("\n"),
  );
}

it("附加目录命令使用目录限定名并保留原 cwd 命令", async () => {
  const root = await mkdtemp(join(tmpdir(), "cf-additional-commands-"));
  try {
    const main = join(root, "frontend"),
      extra = join(root, "backend");
    for (const dir of [main, extra]) {
      await mkdir(join(dir, ".cf", "commands"), { recursive: true });
      await writeFile(
        join(dir, ".cf", "commands", "review.md"),
        `---\ndescription: review\n---\n${dir}`,
      );
    }
    const adapter = createNodeCustomCommandAdapter({
      homeDirectory: join(root, "home"),
      additionalDirectories: [extra],
    });
    expect(
      (await adapter.discoverCommands({ workingDirectory: main })).commands
        .map((c) => c.name)
        .sort(),
    ).toEqual(["backend/review", "review"]);
    expect(
      (await adapter.loadCommand({ workingDirectory: main, name: "backend/review" })).content,
    ).toContain(extra);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
