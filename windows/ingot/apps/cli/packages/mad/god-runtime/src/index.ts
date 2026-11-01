/**
 * GOD Runtime — control plane for CF multi-agent deliberation (MAD).
 *
 * Owns the 4-level topology (Provider / Credential / Model / Instance), the
 * 2-stage router (eligibility filter + scored selection), the budget scheduler,
 * the shared discussion bus, the evidence-gated claim graph, the arbiter, and
 * the verification gate. Everything is deterministic and serialisable so a run
 * can be persisted, inspected, and resumed by the CLI and the `/mad` skill.
 *
 * @module @origin-ai/cf-god-runtime
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { Branded } from '@origin-ai/cf-brand'
import {
  DiscussionBus,
  type BusMessage,
  type BusMessageKind,
  type ConvergenceMetrics,
  type DiscussionPolicy,
  type StopPolicyThresholds,
} from '@origin-ai/cf-discussion-bus'
import { Verification, type VerificationConfig } from '@origin-ai/cf-verification'
import { sha256 } from '@origin-ai/cf-memory-fabric'

// ---------------------------------------------------------------------------
// Branded identities
// ---------------------------------------------------------------------------

/** Opaque provider identifier. */
export type ProviderId = Branded<'ProviderId'>
/** Opaque credential identifier. */
export type CredentialId = Branded<'CredentialId'>
/** Opaque model identifier. */
export type ModelId = Branded<'ModelId'>
/** Opaque runtime instance identifier. */
export type InstanceId = Branded<'InstanceId'>
/** Opaque task identifier. */
export type TaskId = Branded<'TaskId'>
/** Opaque run identifier. */
export type RunId = Branded<'RunId'>
/** Opaque claim identifier. */
export type ClaimId = Branded<'ClaimId'>

/** Cast a string to a branded id — zero runtime cost. */
export function providerId(id: string): ProviderId { return id as ProviderId }
export function credentialId(id: string): CredentialId { return id as CredentialId }
export function modelId(id: string): ModelId { return id as ModelId }
export function instanceId(id: string): InstanceId { return id as InstanceId }
export function taskId(id: string): TaskId { return id as TaskId }
export function runId(id: string): RunId { return id as RunId }
export function claimId(id: string): ClaimId { return id as ClaimId }

// ---------------------------------------------------------------------------
// 4-level domain model
// ---------------------------------------------------------------------------

/** A provider declares credentials; each credential grants model access. */
export interface Provider {
  readonly id: ProviderId
  readonly name: string
  readonly credentials: readonly Credential[]
}

/** A credential — access resource granting one or more models. */
export interface Credential {
  readonly id: CredentialId
  readonly providerId: ProviderId
  readonly models: readonly Model[]
  /** Declared concurrency / rate limits (configuration, not hard-coded). */
  readonly limits?: ProviderLimits
}

/** A selectable model capability. */
export interface Model {
  readonly id: ModelId
  readonly name: string
  /** Many concurrent runtime instances per model. */
  readonly instances: readonly ModelInstance[]
}

/** A concurrent runtime worker for a model. */
export interface ModelInstance {
  readonly id: InstanceId
  readonly modelId: ModelId
  readonly providerId: ProviderId
  readonly credentialId: CredentialId
  /** Last known liveness. */
  readonly available: boolean
  /** Whether the backing provider is currently in backoff. */
  readonly healthy: boolean
}

/** Provider-declared limits that the scheduler enforces. */
export interface ProviderLimits {
  readonly requestsPerMinute?: number
  readonly tokensPerMinute?: number
  readonly concurrency?: number
  readonly costPerToken?: number
}

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------

/**
 * ProviderRegistry owns the 4-level topology: Provider → Credential → Model
 * → Instance. Credentials map many-to-many with models; models map one-to-many
 * with instances.
 */
export class ProviderRegistry {
  private readonly providers = new Map<ProviderId, Provider>()
  private readonly instances = new Map<InstanceId, ModelInstance>()

  /** Register or replace a provider and its subtree. */
  register(provider: Provider): void {
    if (provider.id.length === 0) throw new Error('Provider id must be non-empty')
    this.providers.set(provider.id, provider)
    for (const cred of provider.credentials) {
      for (const model of cred.models) {
        for (const inst of model.instances) {
          this.instances.set(inst.id, inst)
        }
      }
    }
  }

  /** Remove a provider and its instances. */
  unregister(id: ProviderId): void {
    const p = this.providers.get(id)
    if (!p) return
    for (const cred of p.credentials) {
      for (const model of cred.models) {
        for (const inst of model.instances) this.instances.delete(inst.id)
      }
    }
    this.providers.delete(id)
  }

  /** All registered providers in insertion order. */
  listProviders(): Provider[] { return [...this.providers.values()] }

  /** All known instances. */
  listInstances(): ModelInstance[] { return [...this.instances.values()] }

  /** Retrieve a single instance by id. */
  getInstance(id: InstanceId): ModelInstance | undefined { return this.instances.get(id) }

  /** Mark one instance unavailable (backoff) or healthy again. */
  setHealth(id: InstanceId, health: { available?: boolean; healthy?: boolean }): void {
    const current = this.instances.get(id)
    if (!current) throw new Error(`Unknown instance: ${id}`)
    this.instances.set(id, {
      ...current,
      available: health.available ?? current.available,
      healthy: health.healthy ?? current.healthy,
    })
  }
}

// ---------------------------------------------------------------------------
// Router — 2-stage
// ---------------------------------------------------------------------------

/** Requirements a task places on a candidate instance. */
export interface TaskRequirements {
  readonly capability?: string
  readonly contextWindow?: number
  readonly requiredTools?: readonly string[]
  readonly permissions?: readonly string[]
}

/** Why an instance was excluded at stage 1. */
export interface EligibilityExclusion {
  readonly instanceId: InstanceId
  readonly reason: string
}

/** Scored selection input per eligible candidate. */
export interface ScoredCandidate {
  readonly instance: ModelInstance
  /** Expected Value of Information for this assignment. */
  readonly voi: number
  /** Historical task-specific success rate [0,1]. */
  readonly historicalPerformance: number
  /** Evidence quality of prior outputs [0,1]. */
  readonly evidenceQuality: number
  /** Estimated latency (lower is better). */
  readonly latencyMs: number
  /** Estimated cost (lower is better). */
  readonly cost: number
  /** Correlation risk penalty — same-model/family over-representation. */
  readonly correlationRisk: number
  /** Diversity benefit — preference for uncorrelated reasoning. */
  readonly diversityBenefit: number
}

/** Result of the two-stage routing. */
export interface RoutingResult {
  readonly eligible: readonly ModelInstance[]
  readonly excluded: readonly EligibilityExclusion[]
  readonly selected: readonly ModelInstance[]
  readonly scores: ReadonlyMap<InstanceId, number>
}

/** Per-instance empirical outcome counters. */
export interface InstanceHistory {
  readonly attempts: number
  readonly successes: number
}

/**
 * Router applies a 2-stage policy:
 *  1. Eligibility filter (availability, provider health, declared limits).
 *  2. Scored selection optimising VOI + history + diversity + evidence quality
 *     − latency − cost − correlation.
 */
export class Router {
  private readonly history = new Map<InstanceId, { attempts: number; successes: number }>()

  /**
   * Stage 1 — eligibility filter. Ineligible candidates are excluded before
   * scoring and each exclusion reason is reported.
   */
  filter(
    candidates: readonly ModelInstance[],
    _requirements: TaskRequirements,
  ): { eligible: ModelInstance[]; excluded: EligibilityExclusion[] } {
    const eligible: ModelInstance[] = []
    const excluded: EligibilityExclusion[] = []
    for (const inst of candidates) {
      const reason = this.eligibilityReason(inst)
      if (reason === undefined) eligible.push(inst)
      else excluded.push({ instanceId: inst.id, reason })
    }
    return { eligible, excluded }
  }

  private eligibilityReason(inst: ModelInstance): string | undefined {
    if (!inst.available) return 'availability'
    if (!inst.healthy) return 'provider health (backoff)'
    return undefined
  }

  /**
   * Stage 2 — scored selection among eligible candidates.
   * Score = VOI + historical + diversity + evidenceQuality − latency − cost − correlationRisk.
   * Diversity and correlation risk are mandatory terms: correlated instances are
   * not scored as independent opinions.
   */
  score(candidates: readonly ScoredCandidate[]): ReadonlyMap<InstanceId, number> {
    const scores = new Map<InstanceId, number>()
    for (const c of candidates) {
      const s = c.voi + c.historicalPerformance + c.diversityBenefit + c.evidenceQuality
        - c.latencyMs / 1000 - c.cost - c.correlationRisk
      scores.set(c.instance.id, s)
    }
    return scores
  }

  /** Full 2-stage route: filter then score and pick top-k. */
  route(
    candidates: readonly ModelInstance[],
    requirements: TaskRequirements,
    scoredInputs: ReadonlyMap<InstanceId, Omit<ScoredCandidate, 'instance'>>,
    topK: number,
  ): RoutingResult {
    const { eligible, excluded } = this.filter(candidates, requirements)
    const scored: ScoredCandidate[] = eligible.map((inst) => {
      const s = scoredInputs.get(inst.id)
      return {
        instance: inst,
        voi: s?.voi ?? 0,
        historicalPerformance: s?.historicalPerformance ?? this.empiricalPerformance(inst.id),
        evidenceQuality: s?.evidenceQuality ?? 0,
        latencyMs: s?.latencyMs ?? 0,
        cost: s?.cost ?? 0,
        correlationRisk: s?.correlationRisk ?? 0,
        diversityBenefit: s?.diversityBenefit ?? 0,
      }
    })
    const scores = this.score(scored)
    const sorted = [...scored].sort((a, b) => (scores.get(b.instance.id) ?? 0) - (scores.get(a.instance.id) ?? 0))
    const selected = sorted.slice(0, Math.max(0, topK)).map(s => s.instance)
    return { eligible, excluded, selected, scores }
  }

  /** Record a per-task outcome to improve historical performance empirically. */
  recordOutcome(instance: InstanceId, _task: TaskId, success: boolean): void {
    const current = this.history.get(instance) ?? { attempts: 0, successes: 0 }
    this.history.set(instance, {
      attempts: current.attempts + 1,
      successes: current.successes + (success ? 1 : 0),
    })
  }

  /** Empirical success rate for an instance (0 when it has never run). */
  empiricalPerformance(instance: InstanceId): number {
    const h = this.history.get(instance)
    if (h === undefined || h.attempts === 0) return 0
    return h.successes / h.attempts
  }

  /** Recorded history for every instance that ran at least once. */
  listHistory(): ReadonlyMap<InstanceId, InstanceHistory> {
    return new Map(this.history)
  }
}

// ---------------------------------------------------------------------------
// Scheduler — budgets, parallelism, backoff
// ---------------------------------------------------------------------------

/** Budget ceilings for a run. At least one must be set. */
export interface BudgetPolicy {
  /** Maximum total tokens across the run. */
  readonly tokens?: number
  /** Maximum wall-clock time in milliseconds. */
  readonly timeMs?: number
  /** Maximum spend in USD. */
  readonly costUsd?: number
  /** Maximum concurrent agent instances. */
  readonly concurrency?: number
}

/** Scheduler state snapshot. */
export interface SchedulerState {
  readonly tokensUsed: number
  readonly costUsed: number
  readonly concurrencyUsed: number
  readonly startedAt: number
}

/** Backoff decision after a provider failure. */
export interface BackoffDecision {
  readonly agentId: string
  readonly attempts: number
  readonly retryAllowed: boolean
  readonly nextAttemptAt: number
  readonly reason: string
}

/**
 * Global Scheduler enforces budgets, parallelism, exponential backoff, and
 * retry gating.
 */
export class Scheduler {
  private tokensUsed = 0
  private costUsed = 0
  private concurrencyUsed = 0
  private startedAt = Date.now()
  private readonly failures = new Map<string, { attempts: number; nextAttemptAt: number; reason: string }>()

  constructor(private readonly budgets: BudgetPolicy) {
    if (budgets.tokens === undefined && budgets.timeMs === undefined && budgets.costUsd === undefined && budgets.concurrency === undefined) {
      throw new Error('Scheduler requires at least one budget ceiling')
    }
  }

  /** Whether another agent/tokens reservation fits within budgets. */
  reserveResources(agentCount: number, tokens: number): boolean {
    if (this.isExhausted()) return false
    if (this.budgets.concurrency !== undefined && this.concurrencyUsed + agentCount > this.budgets.concurrency) return false
    if (this.budgets.tokens !== undefined && this.tokensUsed + tokens > this.budgets.tokens) return false
    this.concurrencyUsed += agentCount
    this.tokensUsed += tokens
    return true
  }

  /** Release one agent's concurrency slot. */
  releaseResources(_agentId: string): void {
    this.concurrencyUsed = Math.max(0, this.concurrencyUsed - 1)
  }

  /** Charge measured spend after an agent turn. */
  charge(costUsd: number, tokens: number): void {
    this.costUsed += costUsd
    this.tokensUsed += tokens
  }

  /** Handle a provider failure with exponential backoff and retry gating. */
  handleFailure(agentId: string, reason: string, maxAttempts = 3): BackoffDecision {
    const previous = this.failures.get(agentId)
    const attempts = (previous?.attempts ?? 0) + 1
    const retryAllowed = attempts < maxAttempts
    const nextAttemptAt = Date.now() + Math.min(2 ** attempts * 100, 30_000)
    this.failures.set(agentId, { attempts, nextAttemptAt, reason })
    if (!retryAllowed) this.releaseResources(agentId)
    return { agentId, attempts, retryAllowed, nextAttemptAt, reason }
  }

  /** Whether `agentId` has a live backoff window. */
  isBackingOff(agentId: string, now = Date.now()): boolean {
    const state = this.failures.get(agentId)
    return state !== undefined && state.nextAttemptAt > now
  }

  /** Clear a failure record after a successful turn. */
  clearFailure(agentId: string): void {
    this.failures.delete(agentId)
  }

  /** Whether any budget or wall-clock ceiling has been exceeded. */
  isExhausted(): boolean {
    if (this.budgets.tokens !== undefined && this.tokensUsed >= this.budgets.tokens) return true
    if (this.budgets.costUsd !== undefined && this.costUsed >= this.budgets.costUsd) return true
    if (this.budgets.timeMs !== undefined && Date.now() - this.startedAt >= this.budgets.timeMs) return true
    return false
  }

  /** Current scheduler counters. */
  snapshot(): SchedulerState {
    return { tokensUsed: this.tokensUsed, costUsed: this.costUsed, concurrencyUsed: this.concurrencyUsed, startedAt: this.startedAt }
  }

  /** Declared ceilings (for status output). */
  policy(): BudgetPolicy { return this.budgets }

  /** Re-apply persisted usage so a resumed run keeps its budget accounting. */
  restore(state: SchedulerState): void {
    this.tokensUsed = state.tokensUsed
    this.costUsed = state.costUsed
    this.concurrencyUsed = state.concurrencyUsed
    this.startedAt = state.startedAt
  }
}

// ---------------------------------------------------------------------------
// Arbiter — evidence-gated resolution of competing judgments
// ---------------------------------------------------------------------------

/** One competing judgment with its evidence hashes. */
export interface Judgment {
  readonly label: string
  readonly evidence: readonly string[]
}

/** Resolution of conflicting critic judgments. */
export interface ArbiterDecision {
  /** Winning label, or `undefined` when evidence cannot decide. */
  readonly winner?: string
  readonly reason: string
  readonly evidenceHashes: readonly string[]
  readonly decisive: boolean
}

/**
 * Arbiter resolves conflicting critic judgments by counting distinct evidence
 * hashes. Ties and evidence-free judgments are explicitly undecided — the
 * arbiter never picks a winner without evidence.
 */
export class Arbiter {
  /** Resolve two competing judgments. */
  decide(a: Judgment, b: Judgment): ArbiterDecision {
    const aEvidence = distinctHashes(a.evidence)
    const bEvidence = distinctHashes(b.evidence)
    if (aEvidence.length === 0 && bEvidence.length === 0) {
      return { reason: 'no evidence supplied by either judgment', evidenceHashes: [], decisive: false }
    }
    if (aEvidence.length === bEvidence.length) {
      return {
        reason: `evidence tie (${aEvidence.length} vs ${bEvidence.length} distinct hashes)`,
        evidenceHashes: [...new Set([...aEvidence, ...bEvidence])].sort(),
        decisive: false,
      }
    }
    const winner = aEvidence.length > bEvidence.length ? a : b
    return {
      winner: winner.label,
      reason: `${winner.label} carries more distinct evidence (${Math.max(aEvidence.length, bEvidence.length)} vs ${Math.min(aEvidence.length, bEvidence.length)})`,
      evidenceHashes: [...new Set([...aEvidence, ...bEvidence])].sort(),
      decisive: true,
    }
  }
}

function distinctHashes(values: readonly string[]): string[] {
  return [...new Set(values.filter(v => v.trim().length > 0))]
}

// ---------------------------------------------------------------------------
// Run state
// ---------------------------------------------------------------------------

/** Deliberation mode. */
export type MadMode = 'PLAN' | 'BUILD' | 'DEBUG'

/** Lifecycle of a MAD run. */
export type MadRunStatus = 'running' | 'finalized' | 'cancelled'

/** Task status inside the run DAG. */
export type MadTaskStatus = 'pending' | 'assigned' | 'done' | 'failed' | 'skipped'

/** A task node in the decomposition DAG. */
export interface MadTaskNode {
  readonly id: TaskId
  readonly label: string
  readonly dependsOn: readonly TaskId[]
  readonly requirements: TaskRequirements
  status: MadTaskStatus
  assigned: InstanceId[]
  note?: string
}

/** Evidence-gated claim in the knowledge graph. */
export interface MadClaim {
  readonly id: ClaimId
  readonly text: string
  readonly evidence: readonly string[]
  readonly status: 'proposed' | 'supported' | 'accepted' | 'rejected'
  readonly author: string
  readonly round: number
  readonly createdAt: number
}

/** Input accepted by {@link GodRuntime.recordClaim}. */
export interface MadClaimInput {
  readonly text: string
  readonly evidence?: readonly string[]
  /** Defaults to `god-runtime`. */
  readonly author?: string
  /** Defaults to the current discussion round. */
  readonly round?: number
}

/** Snapshot persisted by the CLI after every mutation. */
export interface MadRunSnapshot {
  readonly runId: RunId
  readonly description: string
  readonly mode: MadMode
  readonly status: MadRunStatus
  readonly cancelledReason?: string
  readonly startedAt: number
  readonly tasks: readonly MadTaskNode[]
  readonly claims: readonly MadClaim[]
  readonly routing: readonly {
    readonly taskId: TaskId
    readonly selected: readonly InstanceId[]
    readonly excluded: readonly EligibilityExclusion[]
  }[]
  readonly discussion: readonly BusMessage[]
  readonly budgets: BudgetPolicy
  readonly usage: SchedulerState
}

/** Final report produced by {@link GodRuntime.finalize}. */
export interface MadFinalReport {
  readonly runId: RunId
  readonly status: MadRunStatus
  readonly tasks: number
  readonly assigned: number
  readonly claims: number
  readonly acceptedClaims: number
  readonly evidenceHashes: readonly string[]
  readonly durationMs: number
  readonly usage: SchedulerState
}

/** GOD Runtime configuration. */
export interface GodRuntimeConfig {
  /** Budget ceilings enforced by the scheduler. */
  readonly budgets: BudgetPolicy
  /** Maximum agent instances in one run. */
  readonly maxAgents?: number
  /** Maximum delegation depth below the root agent. */
  readonly maxDepth?: number
  /** Discussion stop policy (defaults to UNTIL_CONTEXT_CLEAR). */
  readonly discussionPolicy?: DiscussionPolicy
  /** Convergence thresholds for UNTIL_CONTEXT_CLEAR. */
  readonly stopThresholds?: StopPolicyThresholds
  /** Verifier modes enabled for this run. */
  readonly verifierModes?: VerificationConfig['modes']
}

/** Decomposition templates per mode. */
export const MAD_DECOMPOSITION: Record<MadMode, readonly string[]> = {
  PLAN: ['scope', 'constraints', 'architecture', 'risks', 'decision'],
  BUILD: ['scope', 'design', 'implement', 'verify', 'report'],
  DEBUG: ['reproduce', 'isolate', 'hypothesis', 'fix', 'regression'],
}

const DEFAULT_VERIFIER_MODES: VerificationConfig['modes'] = ['tests', 'static', 'runtime']

/**
 * GodRuntime — the sole control plane for cross-agent coordination.
 *
 * A run moves through: initialize → decompose → route → discuss/claim →
 * verify → finalize. Every transition is deterministic and reflected in
 * {@link GodRuntime.snapshot}, which the CLI persists to `.cf/mad/runs/`.
 */
export class GodRuntime extends Service {
  readonly registry: ProviderRegistry
  readonly router: Router
  readonly scheduler: Scheduler
  readonly discussion: DiscussionBus
  readonly verification: Verification
  readonly arbiter: Arbiter

  private run: RunId = runId('run-0')
  private description = ''
  private mode: MadMode = 'PLAN'
  private status: MadRunStatus = 'running'
  private cancelledReason: string | undefined
  private startedAt = Date.now()
  private maxAgents: number
  private readonly tasks: MadTaskNode[] = []
  private readonly claims: MadClaim[] = []
  private readonly routing: { taskId: TaskId; selected: InstanceId[]; excluded: EligibilityExclusion[] }[] = []
  private readonly discussionPolicy: DiscussionPolicy

  constructor(ctx: Context, config: GodRuntimeConfig) {
    super(ctx, 'god-runtime')
    this.registry = new ProviderRegistry()
    this.router = new Router()
    this.scheduler = new Scheduler(config.budgets)
    this.discussion = new DiscussionBus(ctx)
    this.verification = new Verification(ctx, { modes: config.verifierModes ?? DEFAULT_VERIFIER_MODES })
    this.arbiter = new Arbiter()
    this.maxAgents = config.maxAgents ?? 6
    this.discussionPolicy = config.discussionPolicy ?? 'UNTIL_CONTEXT_CLEAR'
    void config.maxDepth
    void config.stopThresholds
  }

  // -- lifecycle -----------------------------------------------------------

  /** Normalize goal + constraints into an initial run context (core loop step 1). */
  initializeTask(spec: { description: string; mode?: MadMode; maxAgents?: number }): Promise<MadRunSnapshot> {
    const description = spec.description.trim()
    if (description.length === 0) throw new Error('MAD task description must be non-empty')
    this.description = description
    this.mode = spec.mode ?? 'PLAN'
    this.run = runId(`run-${sha256(description + Date.now().toString()).slice(0, 12)}`)
    if (spec.maxAgents !== undefined) this.maxAgents = spec.maxAgents
    this.status = 'running'
    this.cancelledReason = undefined
    return Promise.resolve(this.snapshot())
  }

  /** Decompose the task into a DAG of task nodes (step 3). Idempotent. */
  decomposeTask(): Promise<readonly TaskId[]> {
    this.assertActive()
    if (this.tasks.length > 0) return Promise.resolve(this.tasks.map(t => t.id))
    const labels = MAD_DECOMPOSITION[this.mode]
    let previous: TaskId | undefined
    for (const label of labels) {
      const id = taskId(`${label}-${this.tasks.length + 1}`)
      this.tasks.push({
        id,
        label,
        dependsOn: previous === undefined ? [] : [previous],
        requirements: { capability: label },
        status: 'pending',
        assigned: [],
      })
      previous = id
    }
    return Promise.resolve(this.tasks.map(t => t.id))
  }

  /**
   * Route a task to eligible model instances (step 4).
   * Stage 1 drops unavailable/backed-off instances; stage 2 scores the rest.
   */
  routeTask(
    task: TaskId,
    scoredInputs: ReadonlyMap<InstanceId, Omit<ScoredCandidate, 'instance'>> = new Map(),
  ): readonly ModelInstance[] {
    this.assertActive()
    const node = this.tasks.find(t => t.id === task)
    if (node === undefined) throw new Error(`Unknown MAD task: ${task}`)
    const candidates = this.registry.listInstances()
    if (candidates.length === 0) throw new Error('No model instances registered — call registry.register first')
    const result = this.router.route(candidates, node.requirements, scoredInputs, this.maxAgents)
    node.assigned = result.selected.map(i => i.id)
    node.status = result.selected.length > 0 ? 'assigned' : 'failed'
    node.note = result.selected.length === 0
      ? `no eligible instance (${result.excluded.map(e => e.reason).join(', ') || 'none registered'})`
      : undefined
    this.routing.push({ taskId: task, selected: node.assigned, excluded: [...result.excluded] })
    return result.selected
  }

  /** Mark a routed task as finished and feed the router's empirical history. */
  completeTask(task: TaskId, success: boolean): void {
    this.assertActive()
    const node = this.tasks.find(t => t.id === task)
    if (node === undefined) throw new Error(`Unknown MAD task: ${task}`)
    node.status = success ? 'done' : 'failed'
    for (const instance of node.assigned) this.router.recordOutcome(instance, task, success)
  }

  /** Publish a discussion utterance onto the shared bus. */
  discuss(kind: BusMessageKind, text: string, author = 'god-runtime', round = this.currentRound()): BusMessage {
    this.assertActive()
    const trimmed = text.trim()
    if (trimmed.length === 0) throw new Error('Discussion text must be non-empty')
    const message: BusMessage = {
      id: `bus-${sha256(`${author}:${round}:${trimmed}`).slice(0, 12)}` as BusMessage['id'],
      kind,
      agentId: author as BusMessage['agentId'],
      round,
      text: trimmed,
      timestamp: Date.now(),
      contentHash: sha256(trimmed),
    }
    this.discussion.publish(message)
    return message
  }

  /**
   * Record a claim into the knowledge graph. Claims without evidence stay
   * `proposed` and block progress — evidence-gating is a hard invariant.
   */
  recordClaim(input: MadClaimInput): MadClaim {
    this.assertActive()
    const text = input.text.trim()
    if (text.length === 0) throw new Error('Claim text must be non-empty')
    const evidence = distinctHashes(input.evidence ?? [])
    const claim: MadClaim = {
      id: claimId(`claim-${sha256(text).slice(0, 8)}-${this.claims.length + 1}`),
      text,
      evidence,
      status: evidence.length > 0 ? 'supported' : 'proposed',
      author: input.author ?? 'god-runtime',
      round: input.round ?? this.currentRound(),
      createdAt: Date.now(),
    }
    this.claims.push(claim)
    this.discuss('claim', text, claim.author, claim.round)
    return claim
  }

  /** Accept or reject a supported claim. Unsupported claims cannot be accepted. */
  resolveClaim(id: ClaimId, accept: boolean): MadClaim {
    this.assertActive()
    const claim = this.claims.find(c => c.id === id)
    if (claim === undefined) throw new Error(`Unknown claim: ${id}`)
    if (accept && claim.evidence.length === 0) throw new Error(`Claim ${id} has no evidence and cannot be accepted`)
    const updated: MadClaim = { ...claim, status: accept ? 'accepted' : 'rejected' }
    const index = this.claims.indexOf(claim)
    this.claims[index] = updated
    return updated
  }

  /**
   * Whether the run may continue: budget available, every task routed, every
   * claim resolved. `true` means "keep going is allowed and needed".
   */
  checkProgress(): boolean {
    if (this.status !== 'running') return false
    if (this.scheduler.isExhausted()) return false
    const unresolved = this.claims.some(c => c.status === 'proposed' || c.status === 'supported')
    const unrouted = this.tasks.some(t => t.status === 'pending')
    return unresolved || unrouted
  }

  /** Convergence signal from the shared bus (UNTIL_CONTEXT_CLEAR policy). */
  isDecisionReady(metrics: ConvergenceMetrics): boolean {
    if (this.discussionPolicy !== 'UNTIL_CONTEXT_CLEAR') return false
    return this.discussion.checkContextClear(metrics)
  }

  /** Cancel the run with a reason; further mutations throw. */
  cancelRun(reason: string): void {
    this.status = 'cancelled'
    this.cancelledReason = reason.trim() || 'cancelled'
  }

  /** Emit the final report with provenance (step 12). */
  finalize(): MadFinalReport {
    if (this.status === 'running') this.status = 'finalized'
    const evidenceHashes = distinctHashes(this.claims.flatMap(c => c.evidence)).sort()
    return {
      runId: this.run,
      status: this.status,
      tasks: this.tasks.length,
      assigned: this.tasks.filter(t => t.assigned.length > 0).length,
      claims: this.claims.length,
      acceptedClaims: this.claims.filter(c => c.status === 'accepted').length,
      evidenceHashes,
      durationMs: Date.now() - this.startedAt,
      usage: this.scheduler.snapshot(),
    }
  }

  /** Serializable state used by the CLI to persist runs. */
  snapshot(): MadRunSnapshot {
    return {
      runId: this.run,
      description: this.description,
      mode: this.mode,
      status: this.status,
      cancelledReason: this.cancelledReason,
      startedAt: this.startedAt,
      tasks: this.tasks.map(t => ({ ...t, dependsOn: [...t.dependsOn], assigned: [...t.assigned] })),
      claims: this.claims.map(c => ({ ...c, evidence: [...c.evidence] })),
      routing: this.routing.map(r => ({ ...r, selected: [...r.selected], excluded: [...r.excluded] })),
      discussion: [...this.discussion.list()],
      budgets: this.scheduler.policy(),
      usage: this.scheduler.snapshot(),
    }
  }

  /** Current discussion round (0 before any message). */
  currentRound(): number {
    const messages = this.discussion.list()
    if (messages.length === 0) return 0
    return Math.max(...messages.map(m => m.round))
  }

  /**
   * Rebuild a runtime from a persisted snapshot so a later CLI invocation can
   * keep mutating the same run (claims, discussion, cancel, finalize).
   */
  static restore(ctx: Context, snapshot: MadRunSnapshot, config?: Partial<GodRuntimeConfig>): GodRuntime {
    const runtime = new GodRuntime(ctx, { budgets: snapshot.budgets, ...config })
    runtime.run = snapshot.runId
    runtime.description = snapshot.description
    runtime.mode = snapshot.mode
    runtime.status = snapshot.status
    runtime.cancelledReason = snapshot.cancelledReason
    runtime.startedAt = snapshot.startedAt
    runtime.tasks.push(...snapshot.tasks.map(t => ({ ...t, dependsOn: [...t.dependsOn], assigned: [...t.assigned] })))
    runtime.claims.push(...snapshot.claims.map(c => ({ ...c, evidence: [...c.evidence] })))
    runtime.routing.push(...snapshot.routing.map(r => ({ ...r, selected: [...r.selected], excluded: [...r.excluded] })))
    runtime.scheduler.restore(snapshot.usage)
    for (const message of snapshot.discussion) runtime.discussion.publish(message)
    return runtime
  }

  private assertActive(): void {
    if (this.status === 'cancelled') throw new Error(`MAD run is cancelled: ${this.cancelledReason ?? 'unknown reason'}`)
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context { 'god-runtime': GodRuntime }
}

export default GodRuntime
