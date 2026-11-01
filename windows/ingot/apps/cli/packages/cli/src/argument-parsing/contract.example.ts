import type { CliArgumentsContract } from "./contract.js";

export function exampleCliArguments(contract: CliArgumentsContract) {
  const extracted = contract.extractDisallowedToolsArgs([
    "--disallowedTools",
    "WebFetch",
    "--toolsearch-mode",
    "local",
    "--prompt",
    "hello",
  ]);
  return {
    ...contract.parseGlobalArgs(extracted.args),
    toolDisallowlist: extracted.toolDisallowlist,
  };
}
