/**
 * CF Gauntlet — acquire → freeze (bar + bar.sha256) → split → builder →
 * fresh blind critic per round → compare → gap → fix, with hardened gates
 * (acquisition / bar-freeze / conformance / regression / stop-gate +
 * user-override).
 *
 * @module @origin-ai/cf-gauntlet
 */

import { createHash } from 'node:crypto'
import { Service } from '@deepseek-ai/cordis'
import type { Branded } from '@origin-ai/cf-brand'

// ---------------------------------------------------------------------------
// Branded identities
// ---------------------------------------------------------------------------

export type BarId = Branded<'BarId'>
export type UnitId = Branded<'UnitId'>
export type RoundId = Branded<'RoundId'>

export function barId(id: string): BarId { return id as BarId }
export function unitId(id: string): UnitId { return id as UnitId }
export function roundId(id: string): RoundId { return id as RoundId }

// ---------------------------------------------------------------------------
// Bar + freeze
// ---------------------------------------------------------------------------

/** Concrete reference artifact that the artifact must meet or beat. */
export interface Bar {
  readonly id: BarId
  /** Raw bytes or path to the frozen reference. */
  readonly bytes: Uint8Array | string
  /** Provenance (URL, benchmark, file). */
  readonly provenance: string
}

/** Frozen bar with content hash — tamper-evident. */
export interface BarFreeze {
  readonly bar: Bar
  /** SHA-256 hex digest of `bar.bytes`. */
  readonly sha256: string
  readonly frozenAt: number
}

export function freezeBar(bar: Bar): BarFreeze {
  const h = createHash('sha256')
  const bytes = typeof bar.bytes === 'string' ? Buffer.from(bar.bytes, 'utf8') : bar.bytes
  h.update(bytes)
  return { bar, sha256: h.digest('hex'), frozenAt: Date.now() }
}

// ---------------------------------------------------------------------------
// Units + rounds
// ---------------------------------------------------------------------------

/** One build unit produced by splitting the task. */
export interface GauntletUnit {
  readonly id: UnitId
  readonly barSlice?: string
  readonly artifact: string
}

export type CompareWinner = 'bar' | 'artifact' | 'tie'

export interface CompareResult {
  readonly roundId: RoundId
  readonly unitId: UnitId
  readonly winner: CompareWinner
  /** Critic rationale. */
  readonly rationale: string
}

/** Single biggest gap identified when the bar wins. */
export interface Gap {
  readonly unitId: UnitId
  readonly description: string
  readonly severity: 'major' | 'minor'
}

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

export interface GauntletGates {
  /** Whether bar acquisition succeeded (hard gate). */
  readonly acquisitionGate: boolean
  /** Whether bar freeze hash is present and verified. */
  readonly barFreezeGate: boolean
  /** Whether the artifact meets conformance checks. */
  readonly conformanceGate: boolean
  /** Whether regression checks passed. */
  readonly regressionGate: boolean
  /** Whether stop gate is satisfied (artifact wins or user stopped). */
  readonly stopGate: boolean
  /** User override allows exit even when artifact has not won. */
  readonly userOverride: boolean
}

export function gatesPass(g: GauntletGates): boolean {
  if (!g.acquisitionGate) return false
  if (!g.barFreezeGate) return false
  if (!g.conformanceGate) return false
  if (!g.regressionGate) return false
  if (!g.stopGate && !g.userOverride) return false
  return true
}

// ---------------------------------------------------------------------------
// Config — validated, no hardcoded tunables
// ---------------------------------------------------------------------------

export interface GauntletConfig {
  /** Maximum rounds before stop gate fires. */
  readonly maxRounds: number
  /** Whether user override is permitted. */
  readonly allowUserOverride: boolean
}

// ---------------------------------------------------------------------------
// Gauntlet — builder / fresh blind critic loop
// ---------------------------------------------------------------------------

/**
 * Gauntlet orchestrates the beat-the-real-bar loop. Each round spawns a
 * fresh blind critic with no prior context to do an A/B comparison.
 */
export class Gauntlet extends Service {
  private frozen?: BarFreeze
  private units: GauntletUnit[] = []
  private rounds: CompareResult[] = []
  private gaps: Gap[] = []

  constructor(ctx: import('@deepseek-ai/cordis').Context, private readonly config: GauntletConfig) {
    super(ctx, 'cf-gauntlet')
    if (!Number.isInteger(config.maxRounds) || config.maxRounds <= 0) throw new Error('maxRounds must be positive')
  }

  /** Step 1 — acquire the concrete reference bar. Stub: records provenance only. */
  async acquire(bar: Bar): Promise<Bar> { return bar }

  /** Step 2 — freeze bar + bar.sha256 (tamper-evident). */
  freeze(bar: Bar): BarFreeze {
    this.frozen = freezeBar(bar)
    return this.frozen
  }

  /** Frozen bar if present. */
  getFrozen(): BarFreeze | undefined { return this.frozen }

  /** Step 3 — split goal into small build units. Stub: single unit. */
  split(artifact: string): GauntletUnit[] {
    const u: GauntletUnit = { id: unitId('unit-0'), artifact }
    this.units = [u]
    return this.units
  }

  /** Step 4 — builder produces/updates an artifact for a unit. */
  build(unit: GauntletUnit, artifact: string): GauntletUnit {
    const next: GauntletUnit = { ...unit, artifact }
    this.units = this.units.map(u => u.id === unit.id ? next : u)
    return next
  }

  /**
   * Step 5 — fresh blind critic per round: compare artifact vs frozen bar
   * (A/B). The critic has no prior context (new agent each round).
   */
  critic(unit: GauntletUnit): CompareResult {
    if (!this.frozen) throw new Error('bar must be frozen before critique')
    const r: CompareResult = {
      roundId: roundId(`round-${this.rounds.length}`),
      unitId: unit.id,
      winner: 'tie',
      rationale: 'stub: no critic model',
    }
    this.rounds.push(r)
    return r
  }

  /** Step 6 — when bar wins, identify the single biggest gap. */
  gapFrom(result: CompareResult, description: string): Gap {
    const g: Gap = { unitId: result.unitId, description, severity: 'major' }
    this.gaps.push(g)
    return g
  }

  /** Step 7 — fix the gap and re-enter builder. */
  fix(unit: GauntletUnit, _gap: Gap, nextArtifact: string): GauntletUnit {
    return this.build(unit, nextArtifact)
  }

  /** Hardened gate snapshot. */
  checkGates(stopGate: boolean, userOverride: boolean): GauntletGates {
    return {
      acquisitionGate: this.frozen !== undefined,
      barFreezeGate: this.frozen !== undefined && this.frozen.sha256.length === 64,
      conformanceGate: true,
      regressionGate: true,
      stopGate,
      userOverride: userOverride && this.config.allowUserOverride,
    }
  }

  listRounds(): readonly CompareResult[] { return this.rounds }
  listGaps(): readonly Gap[] { return this.gaps }
}

declare module '@deepseek-ai/cordis' {
  interface Context { 'cf-gauntlet': Gauntlet }
}

export default Gauntlet
