
export const windowProjectDirectoryModule = {
  id: "window-project-directory",
  requires: ["project", "remote-projects", "rpc", "services", "shared"],
  provides: ["window-project-directory"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
