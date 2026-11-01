import { describe, expect, it } from "vitest";
import {
  convertToCfAgentMcpServer,
  isCfCuaMcpCommand,
  isCfCuaMcpPackageArg,
} from "../src/mcp.js";

describe("cf-cua MCP matcher (single source of truth for services + CLI bootstrap)", () => {
  it("matches the cf-cua command by leaf name", () => {
    expect(isCfCuaMcpCommand("cf-cua")).toBe(true);
    expect(isCfCuaMcpCommand("/opt/homebrew/bin/cf-cua")).toBe(true);
    expect(isCfCuaMcpCommand("uvx")).toBe(false);
    expect(isCfCuaMcpCommand("cf-cua-server")).toBe(false);
  });

  it("matches uvx/pip package spec forms", () => {
    for (const arg of ["cf-cua", "cf-cua[macos]", "cf-cua@v0.1.3", "cf-cua[macos]@v0.1.3"]) {
      expect(isCfCuaMcpPackageArg(arg)).toBe(true);
    }
  });

  it("matches git and local-path forms (the drift that broke desktop/services parity)", () => {
    expect(isCfCuaMcpPackageArg("cf-cua.git")).toBe(true);
    expect(isCfCuaMcpPackageArg("git+https://github.com/x/cf-cua.git@v0.1.3")).toBe(true);
    expect(isCfCuaMcpPackageArg("/Users/me/src/cf-cua")).toBe(true);
    expect(isCfCuaMcpPackageArg("C:\\src\\cf-cua")).toBe(true);
  });

  it("does not match unrelated args", () => {
    for (const arg of ["--from", "run", "cf-cua-server", "not-cf-cua", "server.js"]) {
      expect(isCfCuaMcpPackageArg(arg)).toBe(false);
    }
  });

  it("recognizes a package spec placed in COMMAND position (command/arg matchers stay consistent)", () => {
    for (const command of ["cf-cua@1.2.3", "cf-cua[macos]", "cf-cua.git", "/opt/tools/cf-cua@1.2.3"]) {
      expect(isCfCuaMcpCommand(command), command).toBe(true);
    }
  });

  it("recognizes pip == pins and the cf_cua underscore distribution name (PyPI treats _ == -)", () => {
    for (const arg of ["cf-cua==1.2.3", "cf_cua", "cf_cua==1.2.3", "cf_cua@v0.1.3"]) {
      expect(isCfCuaMcpPackageArg(arg), arg).toBe(true);
    }
    expect(isCfCuaMcpCommand("cf_cua")).toBe(true);
  });

  it("does not false-positive on sibling packages like cf-cua-proxy", () => {
    for (const value of ["cf-cua-proxy", "cf-cua-proxy@1.0.0", "cf-cua-helper"]) {
      expect(isCfCuaMcpCommand(value), value).toBe(false);
      expect(isCfCuaMcpPackageArg(value), value).toBe(false);
    }
  });

  it("recognizes `python -m cf_cua.server` submodule form (M1 fail-open fix)", () => {
    for (const arg of ["cf_cua.server", "cf-cua.server", "cf_cua.main", "cf-cua.__main__"]) {
      expect(isCfCuaMcpPackageArg(arg), arg).toBe(true);
    }
  });

  it("recognizes local paths with a trailing separator (M1 fail-open fix)", () => {
    expect(isCfCuaMcpPackageArg("/Users/me/src/cf-cua/")).toBe(true);
    expect(isCfCuaMcpPackageArg("C:\\src\\cf-cua\\")).toBe(true);
    expect(isCfCuaMcpCommand("/opt/homebrew/bin/cf-cua/")).toBe(true);
    expect(isCfCuaMcpPackageArg("/Users/me/src/cf-cua-proxy/")).toBe(false);
  });
});

describe("MCP config helpers", () => {
  it("passes legacy http_headers through to CodeFusion Agent MCP servers", () => {
    expect(
      convertToCfAgentMcpServer("web-search-prime", {
        type: "http",
        url: "https://bigmodel.example.test/mcp",
        timeoutMs: 5000,
        http_headers: {
          Authorization: "Bearer token",
        },
      }),
    ).toEqual({
      name: "web-search-prime",
      type: "http",
      url: "https://bigmodel.example.test/mcp",
      headers: [{ name: "Authorization", value: "Bearer token" }],
      timeoutMs: 5000,
    });
  });

  it("preserves timeoutMs when converting stdio MCP servers for CodeFusion Agent", () => {
    expect(
      convertToCfAgentMcpServer("context7", {
        type: "stdio",
        command: "npx",
        args: ["-y", "@upstash/context7-mcp"],
        timeoutMs: 3,
      }),
    ).toEqual({
      name: "context7",
      command: "npx",
      args: ["-y", "@upstash/context7-mcp"],
      env: [],
      timeoutMs: 3,
    });
  });

  it("preserves timeoutMs when converting sse MCP servers for CodeFusion Agent", () => {
    expect(
      convertToCfAgentMcpServer("stream", {
        type: "sse",
        url: "https://bigmodel.example.test/sse",
        timeoutMs: 8000,
      }),
    ).toEqual({
      name: "stream",
      type: "sse",
      url: "https://bigmodel.example.test/sse",
      headers: [],
      timeoutMs: 8000,
    });
  });

  it("preserves HTTP OAuth client credentials when converting MCP servers for CodeFusion Agent", () => {
    expect(
      convertToCfAgentMcpServer("protected", {
        type: "http",
        url: "https://mcp.example.test/mcp",
        oauth: {
          type: "client_credentials",
          clientId: "cf-client",
          clientSecret: "secret",
          scope: "mcp:tools",
        },
      }),
    ).toMatchObject({
      name: "protected",
      type: "http",
      oauth: {
        type: "client_credentials",
        clientId: "cf-client",
        clientSecret: "secret",
        scope: "mcp:tools",
      },
    });
  });

  it("preserves HTTP OAuth authorization code config when converting MCP servers for CodeFusion Agent", () => {
    expect(
      convertToCfAgentMcpServer("figma", {
        type: "http",
        url: "https://mcp.figma.com/mcp",
        oauth: {
          type: "authorization_code",
          clientName: "CodeFusion",
          redirectPath: "/oauth/callback/mcp/figma",
          scope: "mcp:connect",
        },
      }),
    ).toMatchObject({
      name: "figma",
      type: "http",
      oauth: {
        type: "authorization_code",
        clientName: "CodeFusion",
        redirectPath: "/oauth/callback/mcp/figma",
        scope: "mcp:connect",
      },
    });
  });

  it("does not persist implicit OAuth defaults when converting bare HTTP MCP servers", () => {
    expect(
      convertToCfAgentMcpServer("notion", {
        type: "http",
        url: "https://mcp.notion.com/mcp",
        timeoutMs: 30000,
      }),
    ).toEqual({
      name: "notion",
      type: "http",
      url: "https://mcp.notion.com/mcp",
      headers: [],
      timeoutMs: 30000,
    });
  });

  it("drops invalid timeoutMs when converting MCP servers for CodeFusion Agent", () => {
    expect(
      convertToCfAgentMcpServer("zero", {
        type: "stdio",
        command: "npx",
        timeoutMs: 0,
      }),
    ).not.toHaveProperty("timeoutMs");

    expect(
      convertToCfAgentMcpServer("fractional", {
        type: "http",
        url: "https://bigmodel.example.test/mcp",
        timeoutMs: 1.5,
      }),
    ).not.toHaveProperty("timeoutMs");
  });

  it("keeps headers ahead of legacy http_headers when both are present", () => {
    expect(
      convertToCfAgentMcpServer("web-reader", {
        type: "sse",
        url: "https://bigmodel.example.test/sse",
        headers: {
          Authorization: "Bearer fresh",
        },
        http_headers: {
          Authorization: "Bearer stale",
        },
      }),
    ).toMatchObject({
      headers: [{ name: "Authorization", value: "Bearer fresh" }],
    });
  });
});
