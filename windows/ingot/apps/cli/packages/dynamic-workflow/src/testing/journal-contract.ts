

import { describe } from "vitest";
import type { JournalStorePort } from "../engine/index.js";
import { registerRunCases } from "./journal-contract-runs.js";
import { registerScriptCases } from "./journal-contract-script.js";
import { registerNodeCases } from "./journal-contract-nodes.js";
import { registerArtifactCases } from "./journal-contract-artifacts.js";
import { registerEventCases } from "./journal-contract-events.js";
import { registerIsolationCases } from "./journal-contract-isolation.js";
import { registerReadCases } from "./journal-contract-reads.js";

export function runJournalStoreContract(factory: () => JournalStorePort): void {
  describe("JournalStorePort contract", () => {
    registerRunCases(factory);
    registerScriptCases(factory);
    registerNodeCases(factory);
    registerArtifactCases(factory);
    registerEventCases(factory);
    registerIsolationCases(factory);
    registerReadCases(factory);
  });
}
