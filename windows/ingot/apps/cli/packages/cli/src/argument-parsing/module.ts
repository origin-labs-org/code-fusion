
export const cliArgumentsModule = {
  id: "cli-arguments",
  requires: [],
  provides: ["cli-arguments"],
  publicEntrypoints: ["../arguments.ts", "contract.ts"],
} as const;
