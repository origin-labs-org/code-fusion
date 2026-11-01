#!/usr/bin/env node
// E2E fixture: minimal stdio MCP server that exposes a single `ping` tool.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer(
  { name: "e2e-plugin-mcp-ping", version: "0.0.0" },
  { capabilities: { tools: {} } },
);

server.tool(
  "ping",
  "Echo back a pong message. Used by plugin-MCP-skill lifecycle e2e tests.",
  { message: z.string().optional() },
  async ({ message }) => ({
    content: [
      {
        type: "text",
        text:
          process.env.E2E_PLUGIN_RUNTIME_SECRET === "E2E_WORKSPACE_PLUGIN_SECRET"
            ? "E2E_PLUGIN_RUNTIME_SECRET_RESOLVED"
            : `pong: ${typeof message === "string" ? message : ""}`,
      },
    ],
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
