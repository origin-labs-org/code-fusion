/**
 * CF Verification — general verifier with proof gate and 6-way adversarial
 * cross-check.
 *
 * Verifier modes: reproduce / tests / static / runtime / bench / security /
 * formal / human. Proof gate + adversarial panel (Verifier A/B/C +
 * Counterexample Hunter + Red-Team + Independent Rebuilder). Proof lifecycle:
 * propose → lemma-attack → formal-check → counterexample → repair → accept.
 *
 * @module @origin-ai/cf-verification
 */

import { Service } from '@deepseek-ai/cordis'
import type { Branded } from '@origin-ai/cf-brand'

// ---------------------------------------------------------------------------
// Branded identities
// ---------------------------------------------------------------------------

export type ClaimId = Branded<'ClaimId'>
export type ProofId = Branded<'ProofId'>
export type VerificationId = Branded<'VerificationId'>

export function claimId(id: string): ClaimId { return id as ClaimId }
export function proofId(id: string): ProofId { return id as ProofId }
export function verificationId(id: string): VerificationId { return id as VerificationId }

// ---------------------------------------------------------------------------
// Verifier modes (general verifier)
// ---------------------------------------------------------------------------

/** The 8 verifier modes that can be composed per claim. */
export type VerifierMode =
  | 'reproduce'
  | 'tests'
  | 'static'
  | 'runtime'
  | 'bench'
  | 'security'
  | 'formal'
  | 'human'

export interface VerificationTask {
  readonly id: VerificationId
  readonly claimId: ClaimId
  readonly mode: VerifierMode
  readonly target: string
}

export type VerificationOutcome = 'pass' | 'fail' | 'inconclusive'

export interface VerificationResult {
  readonly task: VerificationTask
  readonly outcome: VerificationOutcome
  readonly evidenceHash?: string
  readonly details?: string
}

// ---------------------------------------------------------------------------
// Proof gate + lifecycle
// ---------------------------------------------------------------------------

/** Ordered proof lifecycle states. */
export type ProofState =
  | 'propose'
  | 'lemma-attack'
  | 'formal-check'
  | 'counterexample'
  | 'repair'
  | 'accept'
  | 'reject'

export const PROOF_LIFECYCLE_ORDER: readonly ProofState[] = [
  'propose',
  'lemma-attack',
  'formal-check',
  'counterexample',
  'repair',
  'accept',
] as const

export interface Proof {
  readonly id: ProofId
  readonly claimId: ClaimId
  readonly text: string
  readonly state: ProofState
  readonly lemmas?: readonly string[]
}

// ---------------------------------------------------------------------------
// 6-way adversarial cross-check
// ---------------------------------------------------------------------------

/** The 6 adversarial roles that must be represented. */
export type AdversarialRole =
  | 'verifier-a'
  | 'verifier-b'
  | 'verifier-c'
  | 'counterexample-hunter'
  | 'red-team'
  | 'independent-rebuilder'

export interface AdversarialVerdict {
  readonly role: AdversarialRole
  readonly proofId: ProofId
  readonly outcome: VerificationOutcome
  readonly counterexample?: string
  readonly notes?: string
}

export interface CrossCheckResult {
  readonly proofId: ProofId
  readonly verdicts: readonly AdversarialVerdict[]
  /** Whether every verifier required a pass (proof gate). */
  readonly gatePassed: boolean
  /** Whether any hunter/red-team produced a counterexample. */
  readonly hasCounterexample: boolean
}

// ---------------------------------------------------------------------------
// Verification — general verifier + proof gate + adversarial panel
// ---------------------------------------------------------------------------

export interface VerificationConfig {
  /** Modes enabled for this run. At least one. */
  readonly modes: readonly VerifierMode[]
  /** Whether human review may be requested. */
  readonly allowHuman?: boolean
  /** Timeout per verification task (ms). */
  readonly timeoutMs?: number
}

/**
 * Verification orchestrates the general verifier, the proof gate, and the
 * 6-way adversarial cross-check (Verifier A/B/C + Counterexample Hunter +
 * Red-Team + Independent Rebuilder).
 */
export class Verification extends Service {
  private readonly proofs = new Map<ProofId, Proof>()
  private readonly results: VerificationResult[] = []
  private readonly verdicts: AdversarialVerdict[] = []

  constructor(ctx: import('@deepseek-ai/cordis').Context, private readonly config: VerificationConfig) {
    super(ctx, 'cf-verification')
    if (config.modes.length === 0) throw new Error('Verification requires at least one mode')
  }

  // -- general verifier --

  /** Run a single verification task (stub: returns inconclusive). */
  async verify(task: VerificationTask): Promise<VerificationResult> {
    const result: VerificationResult = { task, outcome: 'inconclusive', details: 'stub: no runner' }
    this.results.push(result)
    return result
  }

  /** All results so far. */
  listResults(): readonly VerificationResult[] { return this.results }

  // -- proof lifecycle --

  /** Propose a new proof (state = propose). */
  propose(proof: Omit<Proof, 'state'>): Proof {
    const p: Proof = { ...proof, state: 'propose' }
    this.proofs.set(p.id, p)
    return p
  }

  /** Advance a proof to the next lifecycle state (stub transition). */
  advance(id: ProofId, next: ProofState): Proof | undefined {
    const p = this.proofs.get(id)
    if (!p) return undefined
    const updated: Proof = { ...p, state: next }
    this.proofs.set(id, updated)
    return updated
  }

  /** Retrieve a proof. */
  getProof(id: ProofId): Proof | undefined { return this.proofs.get(id) }

  /** All proofs. */
  listProofs(): readonly Proof[] { return [...this.proofs.values()] }

  // -- 6-way adversarial cross-check + proof gate --

  /** Record an adversarial verdict. */
  recordVerdict(v: AdversarialVerdict): void { this.verdicts.push(v) }

  /**
   * Evaluate the proof gate: every verifier role must pass and no
   * counterexample may remain. Missing roles are treated as not-passed.
   */
  crossCheck(proofId: ProofId): CrossCheckResult {
    const vs = this.verdicts.filter(v => v.proofId === proofId)
    const required: readonly AdversarialRole[] = ['verifier-a', 'verifier-b', 'verifier-c']
    const byRole = new Map(vs.map(v => [v.role, v] as const))
    const gatePassed = required.every(r => byRole.get(r)?.outcome === 'pass')
    const hasCounterexample = vs.some(v => v.counterexample !== undefined && v.counterexample.length > 0)
    return { proofId, verdicts: vs, gatePassed: gatePassed && !hasCounterexample, hasCounterexample }
  }

  /** Whether a proof has reached `accept` (proof lifecycle terminal). */
  isAccepted(id: ProofId): boolean { return this.proofs.get(id)?.state === 'accept' }
}

declare module '@deepseek-ai/cordis' {
  interface Context { 'cf-verification': Verification }
}

export default Verification
