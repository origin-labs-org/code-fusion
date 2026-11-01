

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  InMemoryJournalStore,
  buildAskSpecs,
  collectSites,
  createWorkflowProgram,
  synthesizeAskSchemas,
  validate,
  type AskSpec,
  type Caps,
  type JsonSchema,
  type RunSettlement,
  type ValidateFn,
} from "@origin-ai/cf-dynamic-workflow";
import { runWorkflowScript } from "../src/index.js";
import { AutoDriver, type AutoDriverConfig } from "./auto-driver.js";

const validateFn: ValidateFn = (schema, value) => validate(schema as JsonSchema, value);

export function askSpecsFor(scriptText: string): Map<string, AskSpec> {
  const workflow = createWorkflowProgram(scriptText);
  const table = collectSites(workflow);
  const { schemas } = synthesizeAskSchemas(workflow, table);
  return buildAskSpecs(table, schemas);
}

interface RunScriptResult {
  settlement: RunSettlement;
  journal: InMemoryJournalStore;
  driver: AutoDriver;
}

interface RunScriptOptions extends AutoDriverConfig {
  caps?: Caps;
  timeoutMs?: number;
  journal?: InMemoryJournalStore;
  runId?: string;
  
  signal?: AbortSignal;
}

const DEFAULT_CAPS: Caps = { maxConcurrency: 16 };

export const TEST_CWD: string = mkdtempSync(join(tmpdir(), "dwf-test-cwd-"));

export async function runScript(scriptText: string, opts: RunScriptOptions = {}): Promise<RunScriptResult> {
  const journal = opts.journal ?? new InMemoryJournalStore();
  const driver = new AutoDriver(journal, {
    asks: opts.asks,
    worldReads: opts.worldReads,
    artifacts: opts.artifacts,
    onStartAsk: opts.onStartAsk,
  });
  const settlement = await runWorkflowScript({
    scriptText,
    cwd: TEST_CWD,
    runId: opts.runId ?? "run",
    caps: opts.caps ?? DEFAULT_CAPS,
    askSpecs: askSpecsFor(scriptText),
    validate: validateFn,
    makeDriver: (sink) => {
      driver.attach(sink);
      return driver;
    },
    timeoutMs: opts.timeoutMs ?? 20000,
    ...(opts.signal === undefined ? {} : { signal: opts.signal }),
  });
  return { settlement, journal, driver };
}
