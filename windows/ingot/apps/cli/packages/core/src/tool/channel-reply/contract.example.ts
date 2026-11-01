import type { ToolRegistry } from "../registry.js";
import type { ChannelReplyTool } from "./contract.js";

export function exampleChannelReplyTool(
  registry: Pick<ToolRegistry, "register">,
  entry: ChannelReplyTool,
): void {
  registry.register(entry);
}
