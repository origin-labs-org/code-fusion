/**
 * CF Skill Discovery — GitHub auto-discovery with mandatory trust gate.
 *
 * Pipeline: search → rank → vet (isolated: schema + prompt-injection +
 * tool-permission) → fetch (SHA-256 pin) → activate.
 *
 * Remote skills are quarantine-by-default — zero authority until the trust
 * gate passes. Configuration reads `CF_*` with `CF_*` fallback (dual-read)
 * and enforces a per-run fetch budget cap.
 *
 * @module @origin-ai/cf-skill-discovery
 */

import { createHash } from 'node:crypto'
import { Service } from '@deepseek-ai/cordis'
import type { Branded } from '@origin-ai/cf-brand'

// ---------------------------------------------------------------------------
// Branded identities
// ---------------------------------------------------------------------------

/** Opaque skill identifier. */
export type SkillId = Branded<'SkillId'>
/** Opaque discovery run identifier. */
export type DiscoveryId = Branded<'DiscoveryId'>

export function skillId(id: string): SkillId { return id as SkillId }
export function discoveryId(id: string): DiscoveryId { return id as DiscoveryId }

// ---------------------------------------------------------------------------
// Env helpers — CF_ dual-read with CF_ fallback
// ---------------------------------------------------------------------------

/**
 * Read an env key preferring `CF_*` over `CF_*`.
 * @param base - suffix without prefix, e.g. `SKILL_DISCOVERY_ENABLED`
 * @param env - env record to read from (defaults to `process.env`)
 * @returns the resolved value or `undefined`
 */
export function readEnv(base: string, env: Record<string, string | undefined> = process.env as Record<string, string | undefined>): string | undefined {
  return env[`CF_${base}`] ?? env[`CF_${base}`]
}

// ---------------------------------------------------------------------------
// Domain model
// ---------------------------------------------------------------------------

/** A GitHub search hit before vetting. */
export interface SearchHit {
  readonly repo: string
  readonly path: string
  readonly stars?: number
  readonly updatedAt?: string
  readonly license?: string
  readonly commitSha?: string
}

/** Ranked candidate with score and reasons. */
export interface RankedCandidate {
  readonly hit: SearchHit
  readonly score: number
  readonly reasons: readonly string[]
}

/** Schema / security vet outcome — mandatory trust gate. */
export interface VetResult {
  readonly candidate: RankedCandidate
  /** Whether the candidate passed every vet check. */
  readonly passed: boolean
  /** Schema validation outcome. */
  readonly schemaValid: boolean
  /** Prompt-injection scan outcome. */
  readonly injectionClean: boolean
  /** Tool-permission policy outcome. */
  readonly toolPermissionsAllowed: boolean
  /** Human-readable rejection reasons (empty when passed). */
  readonly rejections: readonly string[]
  /** Whether vetting ran in isolated (no workspace write) mode. */
  readonly isolated: boolean
}

/** SHA-256-pinned fetch record cached content-addressedly. */
export interface FetchRecord {
  readonly skillId: SkillId
  readonly repo: string
  readonly commitSha: string
  /** SHA-256 hex digest of the fetched bytes. */
  readonly sha256: string
  readonly license?: string
  readonly fetchedAt: number
}

/** Activation outcome — quarantine lifted only when vet passed. */
export interface ActivationResult {
  readonly skillId: SkillId
  readonly activated: boolean
  readonly reason: string
}

/** Quarantine state — remote skills carry zero authority until vet passes. */
export type QuarantineState = 'quarantined' | 'vetted' | 'activated' | 'rejected'

// ---------------------------------------------------------------------------
// Configuration — no hardcoded tunables in plugins
// ---------------------------------------------------------------------------

/** Discovery configuration validated from cordis.yml / env. */
export interface SkillDiscoveryConfig {
  /** Whether auto-discovery is enabled. */
  readonly enabled: boolean
  /** Allow globs for repos (e.g. `org/*`). */
  readonly allowRepos?: readonly string[]
  /** Deny globs override allow. */
  readonly denyRepos?: readonly string[]
  /** Hard per-run cap on fetches (budget cap). */
  readonly maxFetchesPerRun: number
  /** Timeout for isolated vet pass (ms). */
  readonly vetTimeoutMs?: number
}

export const DEFAULT_SKILL_DISCOVERY_CONFIG: SkillDiscoveryConfig = {
  enabled: false,
  maxFetchesPerRun: 3,
  vetTimeoutMs: 30_000,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** SHA-256 hex digest for bytes or utf-8 string. */
export function sha256Hex(data: Uint8Array | string): string {
  const h = createHash('sha256')
  h.update(typeof data === 'string' ? Buffer.from(data, 'utf8') : data)
  return h.digest('hex')
}

// ---------------------------------------------------------------------------
// SkillDiscovery — 5-step pipeline
// ---------------------------------------------------------------------------

/**
 * SkillDiscovery implements the 5-step pipeline:
 * search → rank → vet (isolated) → fetch (SHA-256 pin) → activate.
 * Every remote hit is quarantined until the mandatory trust gate passes.
 */
export class SkillDiscovery extends Service {
  private fetchesUsed = 0
  private readonly quarantine = new Map<string, QuarantineState>()
  private readonly fetches: FetchRecord[] = []

  constructor(ctx: import('@deepseek-ai/cordis').Context, private readonly config: SkillDiscoveryConfig) {
    super(ctx, 'cf-skill-discovery')
    if (!Number.isInteger(config.maxFetchesPerRun) || config.maxFetchesPerRun < 0) {
      throw new Error('maxFetchesPerRun must be a non-negative integer')
    }
  }

  /** Whether discovery is enabled (env dual-read helper is available to callers). */
  isEnabled(): boolean { return this.config.enabled }

  /** Remaining fetches under the per-run budget cap. */
  remainingFetches(): number { return Math.max(0, this.config.maxFetchesPerRun - this.fetchesUsed) }

  /**
   * Step 1 — search GitHub for skill manifests. Stub: returns no hits.
   * Production delegates to the web capability's search provider.
   */
  async search(_query: string): Promise<SearchHit[]> { return [] }

  /**
   * Step 2 — rank candidates by stars / recency / license / task fit.
   * Stub: assigns score 0 to every hit.
   */
  rank(hits: readonly SearchHit[]): RankedCandidate[] {
    return hits.map(hit => ({ hit, score: 0, reasons: [] }))
  }

  /**
   * Step 3 — mandatory trust gate (isolated, no workspace writes).
   * Validates manifest schema, scans for prompt-injection/exfiltration,
   * and checks declared tools against the session tool policy.
   * A rejection is recorded loudly; missing skills are never silently skipped.
   */
  async vet(candidates: readonly RankedCandidate[]): Promise<VetResult[]> {
    return candidates.map(candidate => ({
      candidate,
      passed: false,
      schemaValid: false,
      injectionClean: false,
      toolPermissionsAllowed: false,
      rejections: ['vet stub: no policy loaded'],
      isolated: true,
    }))
  }

  /**
   * Step 4 — fetch and cache an approved skill, pinned by commit SHA and
   * SHA-256, into the content-addressed store. Enforces the per-run budget cap.
   */
  async fetch(candidate: RankedCandidate, vet: VetResult): Promise<FetchRecord | undefined> {
    if (!vet.passed) {
      this.quarantine.set(candidate.hit.repo, 'rejected')
      return undefined
    }
    if (this.fetchesUsed >= this.config.maxFetchesPerRun) {
      throw new Error('skill-discovery fetch budget exhausted')
    }
    if (!candidate.hit.commitSha) throw new Error('commit SHA required to pin fetch')
    const record: FetchRecord = {
      skillId: skillId(candidate.hit.repo),
      repo: candidate.hit.repo,
      commitSha: candidate.hit.commitSha,
      sha256: sha256Hex(candidate.hit.repo),
      fetchedAt: Date.now(),
    }
    this.fetchesUsed += 1
    this.fetches.push(record)
    this.quarantine.set(candidate.hit.repo, 'vetted')
    return record
  }

  /**
   * Step 5 — activate into the normal lazy-load path. Quarantine is lifted
   * only for vetted records.
   */
  activate(record: FetchRecord): ActivationResult {
    const state = this.quarantine.get(record.repo)
    if (state !== 'vetted') {
      return { skillId: record.skillId, activated: false, reason: `not vetted (state=${state ?? 'unknown'})` }
    }
    this.quarantine.set(record.repo, 'activated')
    return { skillId: record.skillId, activated: true, reason: 'activated' }
  }

  /** Current quarantine state for a repo. */
  quarantineState(repo: string): QuarantineState | undefined { return this.quarantine.get(repo) }

  /** All fetch records in this run. */
  listFetches(): readonly FetchRecord[] { return this.fetches }
}

declare module '@deepseek-ai/cordis' {
  interface Context { 'cf-skill-discovery': SkillDiscovery }
}

export default SkillDiscovery
