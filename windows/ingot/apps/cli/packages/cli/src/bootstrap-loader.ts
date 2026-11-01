import type { BootstrapModule } from "./cli-types.js";

let bootstrapModulePromise: Promise<BootstrapModule> | undefined;

export const loadBootstrapModule = (): Promise<BootstrapModule> => {
  bootstrapModulePromise ??= import("@origin-ai/cf-bootstrap");
  return bootstrapModulePromise;
};
