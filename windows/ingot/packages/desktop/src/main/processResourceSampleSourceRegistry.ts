import { mcpProcessResourceSampleSource } from "./processResourceMcpTelemetrySource.js";

import { chromiumProcessResourceSampleSource } from "./processResourceChromiumSource.js";
import { cliProcessResourceSampleSource } from "./processResourceCliSource.js";
import { rendererHeapProcessResourceSampleSource } from "./processResourceRendererHeapSource.js";
import type { ProcessResourceSampleSource } from "./processResourceSampleSources.js";
import { selfHeapProcessResourceSampleSource } from "./processResourceSelfHeapSource.js";
import { systemProcessResourceSampleSource } from "./processResourceSystemSource.js";

export const PROCESS_RESOURCE_SAMPLE_SOURCES: readonly ProcessResourceSampleSource[] = [
  chromiumProcessResourceSampleSource,
  systemProcessResourceSampleSource,
  selfHeapProcessResourceSampleSource,
  rendererHeapProcessResourceSampleSource,
  cliProcessResourceSampleSource,
  mcpProcessResourceSampleSource,
];
