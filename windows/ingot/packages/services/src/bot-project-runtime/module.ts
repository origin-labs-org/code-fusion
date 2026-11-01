
export const botProjectRuntimeModule = {
  id: "bot-project-runtime",
  requires: ["services", "shared", "remote-projects"],
  provides: ["bot-project-runtime"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
