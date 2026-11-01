

import type { EngineState } from "./engine-state.js";
import type { AskSpec, InstanceRef, WorkflowError } from "./types.js";

export const HOLE_PROMPT_MAX_CHARS = 4000;

const ELLIPSIS = "…";

export interface HoleFill {
  siteId: string;
  
  code: string;
  
  script: { text: string; hash: string };
  
  askSpecs: ReadonlyMap<string, AskSpec>;
  
  sitePhases: ReadonlyMap<string, string>;
  
  phaseNames: string[];
  
  holes?: number[];
  
  filledBy?: string;
  
  scriptPath?: string;
}

export type FillHoleResult = { ok: true } | { ok: false; reason: "not_waiting" | "settled" };

export interface OpenHole {
  siteId: string;
  ordinal: number;
  name: string;
  
  since: number;
}

export interface FilledHole {
  siteId: string;
  filledAt: number;
  filledBy?: string;
}

interface ParkedHole {
  instance: InstanceRef;
  name: string;
  since: number;
  resolve: (value: { code: string }) => void;
  reject: (reason: WorkflowError) => void;
}

interface RememberedFill {
  code: string;
  filledAt: number;
  filledBy?: string;
}

export class HoleRegistry {
  
  private readonly parked = new Map<string, ParkedHole[]>();
  
  private readonly filled = new Map<string, RememberedFill>();

  constructor(private readonly now: () => number) {}

  
  remembered(siteId: string): string | undefined {
    return this.filled.get(siteId)?.code;
  }

  
  park(instance: InstanceRef, name: string): Promise<{ code: string }> {
    return new Promise<{ code: string }>((resolve, reject) => {
      const list = this.parked.get(instance.siteId) ?? [];
      list.push({ instance, name, since: this.now(), resolve, reject });
      this.parked.set(instance.siteId, list);
    });
  }

  
  isWaitingOrFilled(siteId: string): boolean {
    return (this.parked.get(siteId)?.length ?? 0) > 0 || this.filled.has(siteId);
  }

  
  clock(): number {
    return this.now();
  }

  
  release(siteId: string, code: string, filledAt: number, filledBy: string | undefined): void {
    this.filled.set(siteId, { code, filledAt, ...(filledBy === undefined ? {} : { filledBy }) });
    const list = this.parked.get(siteId) ?? [];
    this.parked.delete(siteId);
    for (const entry of list) entry.resolve({ code });
  }

  
  rejectAll(error: WorkflowError): void {
    const lists = [...this.parked.values()];
    this.parked.clear();
    for (const list of lists) for (const entry of list) entry.reject(error);
  }

  open(): OpenHole[] {
    const out: OpenHole[] = [];
    for (const list of this.parked.values()) {
      for (const entry of list) {
        out.push({
          siteId: entry.instance.siteId,
          ordinal: entry.instance.ordinal,
          name: entry.name,
          since: entry.since,
        });
      }
    }
    return out;
  }

  filledList(): FilledHole[] {
    return [...this.filled.entries()].map(([siteId, fill]) => ({
      siteId,
      filledAt: fill.filledAt,
      ...(fill.filledBy === undefined ? {} : { filledBy: fill.filledBy }),
    }));
  }
}

export function boundHolePrompt(prompt: string): string {
  if (prompt.length <= HOLE_PROMPT_MAX_CHARS) return prompt;
  return prompt.slice(0, HOLE_PROMPT_MAX_CHARS - ELLIPSIS.length) + ELLIPSIS;
}

export function reachHole(
  state: EngineState,
  holes: HoleRegistry,
  siteId: string,
  name: string,
  prompt: string | undefined,
): Promise<{ code: string }> {
  if (state.isRunSettled()) return Promise.reject(state.runError());
  const ordinal = state.nextOrdinal(siteId);
  const remembered = holes.remembered(siteId);
  if (remembered !== undefined) return Promise.resolve({ code: remembered });
  const instance: InstanceRef = { siteId, ordinal };
  const promise = holes.park(instance, name);
  state.record({
    type: "hole-reached",
    instance,
    name,
    ...(prompt === undefined ? {} : { prompt: boundHolePrompt(prompt) }),
  });
  return promise;
}

export function fillHole(
  state: EngineState,
  holes: HoleRegistry,
  fill: HoleFill,
  swapTables: (
    askSpecs: ReadonlyMap<string, AskSpec>,
    sitePhases: ReadonlyMap<string, string>,
  ) => void,
): FillHoleResult {
  if (state.isRunSettled()) return { ok: false, reason: "settled" };
  if (!holes.isWaitingOrFilled(fill.siteId)) return { ok: false, reason: "not_waiting" };
  swapTables(fill.askSpecs, fill.sitePhases);
  state.journal.updateRunScript(state.runId, fill.script.text, fill.script.hash);
  const filledAt = holes.clock();
  state.record({
    type: "hole-filled",
    siteId: fill.siteId,
    filledAt,
    ...(fill.filledBy === undefined ? {} : { filledBy: fill.filledBy }),
    phaseNames: fill.phaseNames,
    ...(fill.holes === undefined ? {} : { holes: fill.holes }),
    ...(fill.scriptPath === undefined ? {} : { scriptPath: fill.scriptPath }),
  });
  holes.release(fill.siteId, fill.code, filledAt, fill.filledBy);
  return { ok: true };
}
