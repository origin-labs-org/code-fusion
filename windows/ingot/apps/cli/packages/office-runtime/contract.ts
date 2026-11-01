
import type { DocKind } from "#office/contract.ts";

export type { DocKind };

export interface OfficePluginConfig {
  title: { en: string; "zh-CN": string };
  kinds: readonly DocKind[];
}

export const OFFICE_RUNTIME_OUTPUTS = [
  "dist/server.mjs",
  "dist/ui/assets.json",
  "dist/ui/panel.html",
] as const;

export interface OfficeRuntimeContract {
  
  config: OfficePluginConfig;
  
  outputs: typeof OFFICE_RUNTIME_OUTPUTS;
}
