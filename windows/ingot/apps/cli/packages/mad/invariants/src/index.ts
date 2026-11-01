import type { Context } from "@deepseek-ai/cordis";

/** Package-owned invariant check installed into the shared service. */
export type InvariantInstaller = () => void;

export interface InvariantsService {
  /** Reserve package ownership and run the installer; returns the disposer. */
  register(packageName: string, install: InvariantInstaller): () => void;
  /** Registered package names, in registration order. */
  list(): readonly string[];
}

export function createInvariantsService(): InvariantsService {
  const installed = new Map<string, () => void>();
  return {
    register(packageName, install) {
      if (installed.has(packageName)) {
        return installed.get(packageName)!;
      }
      install();
      const dispose = () => {
        installed.delete(packageName);
      };
      installed.set(packageName, dispose);
      return dispose;
    },
    list() {
      return [...installed.keys()];
    },
  };
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    invariants: InvariantsService;
  }
}

/** Install the invariants service on a cordis context. */
export function apply(ctx: Context): void {
  ctx.reflect.provide("invariants", createInvariantsService());
}

export const name = "cf-invariants";
export const inject = [];
