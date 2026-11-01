export const webRemoteRelayModule = {
  id: "web-remote-relay",
  requires: [],
  provides: ["web-remote-relay"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
