/**
 * Shared Discussion Bus — ordered channel for claims, hypotheses, evidence,
 * counterarguments, and questions. Every utterance becomes a node in the
 * knowledge graph (Section 8.1). The context-clear stop policy
 * (`UNTIL_CONTEXT_CLEAR`) is defined by convergence signals (Section 8.3).
 *
 * @module @origin-ai/cf-discussion-bus
 */

import { Service } from '@deepseek-ai/cordis'
import type { Branded } from '@origin-ai/cf-brand'

// ---------------------------------------------------------------------------
// Identities
// ---------------------------------------------------------------------------

export type BusMessageId = Branded<'BusMessageId'>
export type AgentId = Branded<'AgentId'>

export function busMessageId(id: string): BusMessageId { return id as BusMessageId }
export function agentId(id: string): AgentId { return id as AgentId }

// ---------------------------------------------------------------------------
// Bus message model
// ---------------------------------------------------------------------------

/** The vocabulary of bus utterances (Section 8.1). */
export type BusMessageKind = 'claim' | 'hypothesis' | 'question' | 'evidence' | 'counterargument'

/** One ordered entry on the shared bus. */
export interface BusMessage {
  readonly id: BusMessageId
  readonly kind: BusMessageKind
  /** Authoring agent. */
  readonly agentId: AgentId
  /** Round the message was published in. */
  readonly round: number
  readonly text: string
  readonly timestamp: number
  /** Content hash for quoted evidence or provenance (Section 9.2). */
  readonly contentHash?: string
  /** Optional graph edges: claim → evidence, support/contradiction. */
  readonly edges?: readonly BusEdge[]
}

/** A typed edge between bus nodes in the knowledge graph. */
export interface BusEdge {
  readonly from: BusMessageId
  readonly to: BusMessageId
  readonly kind: 'supports' | 'contradicts' | 'questions' | 'derives'
}

// ---------------------------------------------------------------------------
// Discussion policy
// ---------------------------------------------------------------------------

/** Discussion stop policy values (Section 4.3). */
export type DiscussionPolicy =
  | 'TIME_LIMIT'
  | 'TURN_LIMIT'
  | 'UNTIL_CONTEXT_CLEAR'
  | 'UNTIL_DECISION_READY'
  | 'MANUAL'

// ---------------------------------------------------------------------------
// Context-clear convergence signals (Section 8.3)
// ---------------------------------------------------------------------------

/**
 * UNTIL_CONTEXT_CLEAR convergence signals. GOD declares stabilization only
 * when all configured metrics satisfy thresholds for N consecutive turns.
 */
export interface ConvergenceMetrics {
  /** Fraction [0,1] of subtopics addressed. */
  readonly coverage: number
  /** Per-claim evidence sufficiency [0,1]. */
  readonly evidenceSufficiency: number
  /** Count of unresolved contradictions. */
  readonly contradictionsLeft: number
  /** New claims per round — approaching 0 implies stabilization. */
  readonly newInformationRate: number
  /** Whether the current decision has been stable for N turns. */
  readonly decisionStability: boolean
  /** Wall-clock / turn budget gate. */
  readonly timeGate: boolean
  /** Whether the user has explicitly stopped the discussion. */
  readonly userGate: boolean
}

/** Named stop-policy signals for external wiring. */
export type StopSignal =
  | 'NEW_INFORMATION_RATE'
  | 'CONTRADICTIONS_LEFT'
  | 'COVERAGE'
  | 'DECISION_STABILITY'
  | 'EVIDENCE_SUFFICIENCY'
  | 'TIME_GATE'
  | 'USER_GATE'

/** Thresholds for the UNTIL_CONTEXT_CLEAR stop policy. */
export interface StopPolicyThresholds {
  /** Minimum coverage required. */
  readonly minCoverage: number
  /** Minimum evidence sufficiency per claim. */
  readonly minEvidenceSufficiency: number
  /** Maximum unresolved contradictions allowed. */
  readonly maxContradictionsLeft: number
  /** Maximum new-information rate still considered stable. */
  readonly maxNewInformationRate: number
  /** Whether decision stability is required. */
  readonly requireDecisionStability: boolean
  /** Consecutive turns all thresholds must hold before we declare clear. */
  readonly stableTurns: number
}

export const DEFAULT_STOP_THRESHOLDS: StopPolicyThresholds = {
  minCoverage: 0.8,
  minEvidenceSufficiency: 0.7,
  maxContradictionsLeft: 0,
  maxNewInformationRate: 0,
  requireDecisionStability: true,
  stableTurns: 2,
}

/** Whether `metrics` satisfies `thresholds` for one turn. */
export function isContextClear(
  metrics: ConvergenceMetrics,
  thresholds: StopPolicyThresholds = DEFAULT_STOP_THRESHOLDS,
): boolean {
  if (metrics.coverage < thresholds.minCoverage) return false
  if (metrics.evidenceSufficiency < thresholds.minEvidenceSufficiency) return false
  if (metrics.contradictionsLeft > thresholds.maxContradictionsLeft) return false
  if (metrics.newInformationRate > thresholds.maxNewInformationRate) return false
  if (thresholds.requireDecisionStability && !metrics.decisionStability) return false
  if (!metrics.timeGate) return false
  if (!metrics.userGate) return false
  return true
}

/** Which stop signals are still violated (i.e., block a clear decision). */
export function violatedSignals(
  metrics: ConvergenceMetrics,
  thresholds: StopPolicyThresholds = DEFAULT_STOP_THRESHOLDS,
): StopSignal[] {
  const out: StopSignal[] = []
  if (metrics.newInformationRate > thresholds.maxNewInformationRate) out.push('NEW_INFORMATION_RATE')
  if (metrics.contradictionsLeft > thresholds.maxContradictionsLeft) out.push('CONTRADICTIONS_LEFT')
  if (metrics.coverage < thresholds.minCoverage) out.push('COVERAGE')
  if (thresholds.requireDecisionStability && !metrics.decisionStability) out.push('DECISION_STABILITY')
  if (metrics.evidenceSufficiency < thresholds.minEvidenceSufficiency) out.push('EVIDENCE_SUFFICIENCY')
  if (!metrics.timeGate) out.push('TIME_GATE')
  if (!metrics.userGate) out.push('USER_GATE')
  return out
}

// ---------------------------------------------------------------------------
// Discussion Bus — ordered shared channel
// ---------------------------------------------------------------------------

/**
 * DiscussionBus is the single shared channel for claims, hypotheses,
 * assumptions, proposals, evidence, counterarguments, and questions.
 * Every utterance becomes a node in the knowledge graph.
 */
export class DiscussionBus extends Service {
  private readonly messages: BusMessage[] = []
  private consecutiveClearTurns = 0

  constructor(ctx: import('@deepseek-ai/cordis').Context) {
    super(ctx, 'discussion-bus')
  }

  /** Publish a message. Agents must have reasoned independently first. */
  publish(msg: BusMessage): void {
    if (msg.id.length === 0) throw new Error('BusMessage id must be non-empty')
    if (msg.text.length === 0) throw new Error('BusMessage text must be non-empty')
    this.messages.push(msg)
  }

  /** Ordered snapshot of the bus. */
  list(): readonly BusMessage[] { return this.messages }

  /** Messages of one kind. */
  listByKind(kind: BusMessageKind): readonly BusMessage[] {
    return this.messages.filter(m => m.kind === kind)
  }

  /** Novel-information rate for the last `window` rounds. */
  newInformationRate(window = 1): number {
    if (this.messages.length === 0) return 0
    const maxRound = Math.max(...this.messages.map(m => m.round))
    return this.messages.filter(m => m.round > maxRound - window).length
  }

  /**
   * Evaluate the UNTIL_CONTEXT_CLEAR stop policy. Tracks consecutive turns
   * where all thresholds are satisfied and returns true only after
   * `thresholds.stableTurns` consecutive clear turns.
   */
  checkContextClear(
    metrics: ConvergenceMetrics,
    thresholds: StopPolicyThresholds = DEFAULT_STOP_THRESHOLDS,
  ): boolean {
    if (isContextClear(metrics, thresholds)) {
      this.consecutiveClearTurns += 1
    } else {
      this.consecutiveClearTurns = 0
    }
    return this.consecutiveClearTurns >= thresholds.stableTurns
  }

  /** Reset consecutive-clear counter (e.g., after intervention). */
  resetStability(): void { this.consecutiveClearTurns = 0 }

  /** Whether the bus must keep accepting turns (has a timeout + budget guard). */
  mustContinue(): boolean { return true }
}

declare module '@deepseek-ai/cordis' {
  interface Context { 'discussion-bus': DiscussionBus }
}

export default DiscussionBus
