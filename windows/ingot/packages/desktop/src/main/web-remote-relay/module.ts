export const desktopWebRemoteRelayModule = {
  id: "desktop-web-remote-relay",
  requires: ["client", "desktop", "shared", "web-remote-relay"],
  provides: ["desktop-web-remote-relay"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
