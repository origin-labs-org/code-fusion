

import type { RunLaunchConfig } from "./engine-launch.js";
import type { AskSpec, Caps, ImportedRunCache, ValidateFn, WorkflowDriver } from "./types.js";

export interface EngineConfig {
  runId: string;
  driver: WorkflowDriver;
  caps: Caps;
  
  askSpecs: ReadonlyMap<string, AskSpec>;
  
  validate: ValidateFn;
  
  sitePhases?: ReadonlyMap<string, string>;
  
  scriptText?: string;
  
  name?: string;
  
  scriptHash?: string;
  
  args?: Record<string, unknown>;
  parentSessionId?: string;
  cwd?: string;
  
  toolCallId?: string;
  
  resumedFrom?: string;
  
  launch?: RunLaunchConfig;
  
  inheritedTokens?: number;
  
  importedCache?: ImportedRunCache;
  
  now?: () => number;
}
