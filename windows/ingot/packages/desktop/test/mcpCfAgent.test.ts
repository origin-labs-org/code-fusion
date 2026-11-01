import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CliMcpSource } from "../src/mcp.js";
import { MCP_SOURCE_DESCRIPTORS, getSourceDescriptor } from "../src/main/mcpUserDirectory/types.js";
import {
  loadCliMcpFromUserDirectory,
  saveCliMcpToUserDirectory,
} from "../src/main/mcpUserDirectory/index.js";

const originalHome = process.env.HOME;
const tempRoots: string[] = [];

function makeTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "cf-mcp-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  process.env.HOME = originalHome;
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe("MCP Source Descriptors", () => {
  it("Provide descriptor only for CodeFusion Agent", () => {
    expect(MCP_SOURCE_DESCRIPTORS.map((descriptor) => descriptor.source)).toEqual([
      "cfagentmcp",
    ]);
  });

  it("应能通过 getSourceDescriptor 获取 cfagentmcp 描述符", () => {
    const descriptor = getSourceDescriptor("cfagentmcp");

    expect(descriptor).toBeDefined();
    expect(descriptor.source).toBe("cfagentmcp");
    expect(descriptor.configDirSegments).toEqual([".cf", "cli"]);
    expect(descriptor.fileName).toBe("config.json");
    expect(descriptor.format).toBe("json");
    expect(descriptor.configKeyName).toBe("mcp.servers");
  });

  it("Should throw an error for other legacy provider sources", () => {
    expect(() => getSourceDescriptor("claudeclimcp" as CliMcpSource)).toThrow(
      "Unsupported MCP source",
    );
    expect(() => getSourceDescriptor("geminiclimcp" as CliMcpSource)).toThrow(
      "Unsupported MCP source",
    );
    expect(() => getSourceDescriptor("codexclimcp" as CliMcpSource)).toThrow(
      "Unsupported MCP source",
    );
    expect(() => getSourceDescriptor("opencodemcp" as CliMcpSource)).toThrow(
      "Unsupported MCP source",
    );
  });

  it("Should throw an error for invalid sources", () => {
    expect(() => getSourceDescriptor("invalid_source" as CliMcpSource)).toThrow(
      "Unsupported MCP source",
    );
  });
});

describe("MCP enabled state", () => {
  it("Should throw when config file is unparseable instead of continuing replace with an empty list", async () => {
    const home = makeTempRoot();
    process.env.HOME = home;
    mkdirSync(join(home, ".cf", "cli"), { recursive: true });
    writeFileSync(join(home, ".cf", "cli", "config.json"), "{ invalid json", "utf-8");

    await expect(loadCliMcpFromUserDirectory()).rejects.toBeInstanceOf(SyntaxError);
  });

  it("prefers cf MCP config and skips agents/claude configs when cf has servers", async () => {
    const home = makeTempRoot();
    const workspacePath = join(makeTempRoot(), "workspace");
    process.env.HOME = home;
    mkdirSync(join(workspacePath, ".cf"), { recursive: true });
    mkdirSync(join(workspacePath, ".agents"), { recursive: true });
    mkdirSync(join(workspacePath, ".claude"), { recursive: true });
    mkdirSync(join(home, ".cf", "cli"), { recursive: true });
    mkdirSync(join(home, ".agents"), { recursive: true });
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(
      join(workspacePath, ".cf", "config.json"),
      JSON.stringify({
        mcp: {
          servers: {
            cfWorkspace: { command: "cf-workspace" },
          },
        },
      }),
      "utf-8",
    );
    writeFileSync(
      join(workspacePath, ".agents", "mcp.json"),
      JSON.stringify({ mcpServers: { agentsWorkspace: { command: "agents-workspace" } } }),
      "utf-8",
    );
    writeFileSync(
      join(workspacePath, ".claude", "settings.json"),
      JSON.stringify({ mcpServers: { claudeWorkspace: { command: "claude-workspace" } } }),
      "utf-8",
    );
    writeFileSync(
      join(home, ".cf", "cli", "config.json"),
      JSON.stringify({
        mcp: {
          servers: {
            cfUser: { command: "cf-user" },
          },
        },
      }),
      "utf-8",
    );
    writeFileSync(
      join(home, ".agents", "mcp.json"),
      JSON.stringify({ mcpServers: { agentsUser: { command: "agents-user" } } }),
      "utf-8",
    );
    writeFileSync(
      join(home, ".claude", "settings.json"),
      JSON.stringify({ mcpServers: { claudeUser: { command: "claude-user" } } }),
      "utf-8",
    );

    const result = await loadCliMcpFromUserDirectory({ workspacePath });

    expect(result.servers.map((server) => server.name)).toEqual(["cfWorkspace", "cfUser"]);
    expect(result.servers.map((server) => server.location?.source)).toEqual(["cf", "cf"]);
  });

  it("does not read claude MCP configs even when cf and agents configs are missing", async () => {
    const home = makeTempRoot();
    const workspacePath = join(makeTempRoot(), "workspace");
    process.env.HOME = home;
    mkdirSync(join(workspacePath, ".claude"), { recursive: true });
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(
      join(workspacePath, ".claude", "settings.json"),
      JSON.stringify({ mcpServers: { claudeWorkspace: { command: "claude-workspace" } } }),
      "utf-8",
    );
    writeFileSync(
      join(home, ".claude", "settings.json"),
      JSON.stringify({ mcpServers: { claudeUser: { command: "claude-user" } } }),
      "utf-8",
    );

    const result = await loadCliMcpFromUserDirectory({ workspacePath });

    expect(result.servers).toEqual([]);
  });

  it("stores disabled servers on the original MCP server config", async () => {
    const home = makeTempRoot();
    const workspacePath = join(makeTempRoot(), "workspace");
    process.env.HOME = home;
    mkdirSync(join(workspacePath, ".agents"), { recursive: true });
    writeFileSync(
      join(workspacePath, ".agents", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          browser: { command: "npx", args: ["-y", "browser-mcp"] },
        },
      }),
      "utf-8",
    );

    const initial = await loadCliMcpFromUserDirectory({ workspacePath });
    const server = initial.servers.find((item) => item.name === "browser");
    expect(server).toEqual(expect.objectContaining({ enabled: true }));

    await saveCliMcpToUserDirectory({
      action: "set-enabled",
      source: "cfagentmcp",
      name: "browser",
      enabled: false,
      projectPath: workspacePath,
      location: server?.location,
    });

    const saved = JSON.parse(readFileSync(join(workspacePath, ".agents", "mcp.json"), "utf-8"));
    expect(saved.mcpServers.browser).toEqual({
      command: "npx",
      args: ["-y", "browser-mcp"],
      enabled: false,
    });

    const disabled = await loadCliMcpFromUserDirectory({ workspacePath });
    expect(disabled.servers.find((item) => item.name === "browser")).toEqual(
      expect.objectContaining({ enabled: false }),
    );

    await saveCliMcpToUserDirectory({
      action: "set-enabled",
      source: "cfagentmcp",
      name: "browser",
      enabled: true,
      projectPath: workspacePath,
      location: server?.location,
    });

    const reenabled = JSON.parse(readFileSync(join(workspacePath, ".agents", "mcp.json"), "utf-8"));
    expect(reenabled.mcpServers.browser).toEqual({
      command: "npx",
      args: ["-y", "browser-mcp"],
    });
  });

  it("cleans old directory override when writing cf MCP server enabled state", async () => {
    const home = makeTempRoot();
    process.env.HOME = home;
    mkdirSync(join(home, ".cf", "cli"), { recursive: true });
    writeFileSync(
      join(home, ".cf", "cli", "config.json"),
      JSON.stringify({
        mcp: {
          servers: {
            browser: { command: "npx", args: ["-y", "browser-mcp"] },
          },
          [join(home, ".cf", "cli")]: {
            browser: { enable: false },
          },
        },
      }),
      "utf-8",
    );

    const initial = await loadCliMcpFromUserDirectory();
    const server = initial.servers.find((item) => item.name === "browser");

    await saveCliMcpToUserDirectory({
      action: "set-enabled",
      source: "cfagentmcp",
      name: "browser",
      enabled: false,
      location: server?.location,
    });

    const saved = JSON.parse(readFileSync(join(home, ".cf", "cli", "config.json"), "utf-8"));
    expect(saved.mcp.servers.browser).toEqual({
      command: "npx",
      args: ["-y", "browser-mcp"],
      enabled: false,
    });
    expect(saved.mcp[join(home, ".cf", "cli")]).toBeUndefined();
  });

  it("reports a server disabled through enabled:false as disabled", async () => {
    const home = makeTempRoot();
    process.env.HOME = home;
    mkdirSync(join(home, ".cf", "cli"), { recursive: true });
    writeFileSync(
      join(home, ".cf", "cli", "config.json"),
      JSON.stringify({
        mcp: {
          servers: {
            browser: { command: "npx", args: ["-y", "browser-mcp"], enabled: false },
          },
        },
      }),
      "utf-8",
    );

    const loaded = await loadCliMcpFromUserDirectory();

    expect(loaded.servers.find((item) => item.name === "browser")).toEqual(
      expect.objectContaining({ enabled: false }),
    );
  });

  it("overwrites a stale enabled:true flag when disabling a server", async () => {
    const home = makeTempRoot();
    process.env.HOME = home;
    mkdirSync(join(home, ".cf", "cli"), { recursive: true });
    writeFileSync(
      join(home, ".cf", "cli", "config.json"),
      JSON.stringify({
        mcp: {
          servers: {
            browser: { command: "npx", args: ["-y", "browser-mcp"], enabled: true },
          },
        },
      }),
      "utf-8",
    );

    const initial = await loadCliMcpFromUserDirectory();
    const server = initial.servers.find((item) => item.name === "browser");

    await saveCliMcpToUserDirectory({
      action: "set-enabled",
      source: "cfagentmcp",
      name: "browser",
      enabled: false,
      location: server?.location,
    });

    const saved = JSON.parse(readFileSync(join(home, ".cf", "cli", "config.json"), "utf-8"));
    expect(saved.mcp.servers.browser).toEqual({
      command: "npx",
      args: ["-y", "browser-mcp"],
      enabled: false,
    });
  });

  it("migrates a legacy enable flag to enabled on load", async () => {
    const home = makeTempRoot();
    process.env.HOME = home;
    mkdirSync(join(home, ".cf", "cli"), { recursive: true });
    writeFileSync(
      join(home, ".cf", "cli", "config.json"),
      JSON.stringify({
        mcp: {
          servers: {
            browser: { command: "npx", args: ["-y", "browser-mcp"], enable: false },
          },
        },
      }),
      "utf-8",
    );

    const loaded = await loadCliMcpFromUserDirectory();

    expect(loaded.servers.find((item) => item.name === "browser")).toEqual(
      expect.objectContaining({ enabled: false }),
    );
    const saved = JSON.parse(readFileSync(join(home, ".cf", "cli", "config.json"), "utf-8"));
    expect(saved.mcp.servers.browser).toEqual({
      command: "npx",
      args: ["-y", "browser-mcp"],
      enabled: false,
    });
  });

  it("keeps a server disabled when legacy enable:false collides with enabled:true", async () => {
    const home = makeTempRoot();
    process.env.HOME = home;
    mkdirSync(join(home, ".cf", "cli"), { recursive: true });
    writeFileSync(
      join(home, ".cf", "cli", "config.json"),
      JSON.stringify({
        mcp: {
          servers: {
            browser: {
              command: "npx",
              args: ["-y", "browser-mcp"],
              enable: false,
              enabled: true,
            },
          },
        },
      }),
      "utf-8",
    );

    const loaded = await loadCliMcpFromUserDirectory();

    expect(loaded.servers.find((item) => item.name === "browser")).toEqual(
      expect.objectContaining({ enabled: false }),
    );
    const saved = JSON.parse(readFileSync(join(home, ".cf", "cli", "config.json"), "utf-8"));
    expect(saved.mcp.servers.browser).toEqual({
      command: "npx",
      args: ["-y", "browser-mcp"],
      enabled: false,
    });
  });

  it("leaves the config file byte-identical when no legacy enable flag exists", async () => {
    const home = makeTempRoot();
    process.env.HOME = home;
    mkdirSync(join(home, ".cf", "cli"), { recursive: true });
    const raw = JSON.stringify({
      mcp: {
        servers: {
          browser: { command: "npx", args: ["-y", "browser-mcp"], enabled: false },
        },
      },
    });
    writeFileSync(join(home, ".cf", "cli", "config.json"), raw, "utf-8");

    await loadCliMcpFromUserDirectory();

    expect(readFileSync(join(home, ".cf", "cli", "config.json"), "utf-8")).toBe(raw);
  });

  it("clears a stale enabled:false flag when re-enabling a server", async () => {
    const home = makeTempRoot();
    process.env.HOME = home;
    mkdirSync(join(home, ".cf", "cli"), { recursive: true });
    writeFileSync(
      join(home, ".cf", "cli", "config.json"),
      JSON.stringify({
        mcp: {
          servers: {
            browser: { command: "npx", args: ["-y", "browser-mcp"], enabled: false },
          },
        },
      }),
      "utf-8",
    );

    const initial = await loadCliMcpFromUserDirectory();
    const server = initial.servers.find((item) => item.name === "browser");

    await saveCliMcpToUserDirectory({
      action: "set-enabled",
      source: "cfagentmcp",
      name: "browser",
      enabled: true,
      location: server?.location,
    });

    const saved = JSON.parse(readFileSync(join(home, ".cf", "cli", "config.json"), "utf-8"));
    expect(saved.mcp.servers.browser).toEqual({
      command: "npx",
      args: ["-y", "browser-mcp"],
    });
  });
});
