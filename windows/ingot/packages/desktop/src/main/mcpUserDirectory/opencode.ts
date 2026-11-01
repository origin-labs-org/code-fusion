

import type { McpServerConfig } from "@origin-ai/cf-shared";
import type { OpenCodeMcpServerConfig } from "./types.js";

export function convertOpenCodeToStandard(config: OpenCodeMcpServerConfig): McpServerConfig {
  const result: McpServerConfig = {};

  if (config.type === "local" && config.command && config.command.length > 0) {
    result.command = config.command[0];
    if (config.command.length > 1) {
      result.args = config.command.slice(1);
    }
  } else if (config.type === "remote" && config.url) {
    result.type = "http";
    result.url = config.url;
  }

  if (config.env) {
    result.env = config.env;
  }
  if (config.headers) {
    result.headers = config.headers;
  }

  return result;
}

export function convertStandardToOpenCode(config: McpServerConfig): OpenCodeMcpServerConfig {
  const result: OpenCodeMcpServerConfig = {
    type: config.url ? "remote" : "local",
  };

  if (result.type === "local") {
    const commandParts: string[] = [];
    if (config.command) {
      commandParts.push(config.command);
    }
    if (config.args && config.args.length > 0) {
      commandParts.push(...config.args);
    }
    if (commandParts.length > 0) {
      result.command = commandParts;
    }
  } else {
    if (config.url) {
      result.url = config.url;
    }
  }

  if (config.env) {
    result.env = config.env;
  }
  if (config.headers) {
    result.headers = config.headers;
  }

  return result;
}

export function isOpenCodeFormat(config: McpServerConfig): boolean {
  return "type" in config || Array.isArray((config as unknown as OpenCodeMcpServerConfig).command);
}
