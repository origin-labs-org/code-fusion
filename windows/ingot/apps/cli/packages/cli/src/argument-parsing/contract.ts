
export type CliArgumentsContract = Pick<
  typeof import("../arguments.js"),
  "parseGlobalArgs" | "extractDisallowedToolsArgs" | "isProtocolServerInvocation"
>;
