
export const channelReplyToolModule = {
  id: "channel-reply-tool",
  requires: ["shared", "cf-cli"],
  provides: ["channel-reply-tool"],
  publicEntrypoints: ["../handlers/reply-to-channel.ts", "contract.ts"],
} as const;
