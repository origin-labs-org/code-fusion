/**
 * CF Production Sweep — 4-agent sweep (QA + annotation-linter
 * TODO/FIXME/XXX/HACK + adversarial + UX) with dedup / severity /
 * dependency graph → remediation + fresh resweep + READY gates.
 *
 * @module @origin-ai/cf-production-sweep
 */

import { Service } from '@deepseek-ai/cordis'
import type { Branded } from '@origin-ai/cf-brand'

// ---------------------------------------------------------------------------
// Branded identities
// ---------------------------------------------------------------------------

export type FindingId = Branded<'FindingId'>
export type SweepId = Branded<'SweepId'>

export function findingId(id: string): FindingId { return id as FindingId }
export function sweepId(id: string): SweepId { return id as SweepId }

// ---------------------------------------------------------------------------
// 4-agent sweep
// ---------------------------------------------------------------------------

/** The 4 sweep agents. */
export type SweepAgentKind = 'qa' | 'annotation-linter' | 'adversarial' | 'ux'

/** Annotation patterns the linter hunts. */
export type AnnotationKind = 'TODO' | 'FIXME' | 'XXX' | 'HACK'

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'

export interface Finding {
  readonly id: FindingId
  readonly agent: SweepAgentKind
  readonly severity: Severity
  readonly message: string
  /** Optional source location / file. */
  readonly location?: string
  /** For annotation-linter findings. */
  readonly annotationKind?: AnnotationKind
  /** Deduplication key (e.g. normalized message + location). */
  readonly dedupKey: string
}

export interface SweepResult {
  readonly id: SweepId
  readonly findings: readonly Finding[]
  readonly startedAt: number
  readonly finishedAt: number
}

// ---------------------------------------------------------------------------
// Dedup / severity / dependency graph
// ---------------------------------------------------------------------------

/** Deduplicate findings by `dedupKey`, keeping the highest severity. */
export function dedupFindings(findings: readonly Finding[]): Finding[] {
  const rank: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 }
  const best = new Map<string, Finding>()
  for (const f of findings) {
    const prev = best.get(f.dedupKey)
    if (!prev || rank[f.severity] > rank[prev.severity]) best.set(f.dedupKey, f)
  }
  return [...best.values()]
}

/** Sort by severity descending (critical first). */
export function sortBySeverity(findings: readonly Finding[]): Finding[] {
  const rank: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 }
  return [...findings].sort((a, b) => rank[b.severity] - rank[a.severity])
}

/** Dependency edge between findings (A blocks B). */
export interface DependencyEdge {
  readonly from: FindingId
  readonly to: FindingId
  readonly reason?: string
}

export interface RemediationGraph {
  readonly findings: readonly Finding[]
  readonly edges: readonly DependencyEdge[]
}

// ---------------------------------------------------------------------------
// READY gates
// ---------------------------------------------------------------------------

export interface ReadyGates {
  /** No critical/high findings remain. */
  readonly noBlockingFindings: boolean
  readonly testsPass: boolean
  readonly securityPass: boolean
  readonly performancePass: boolean
  readonly proofsVerified: boolean
  readonly limitationsDocumented: boolean
}

export type ReadyVerdict = 'READY' | 'READY_WITH_RISKS' | 'NOT_READY'

export function evaluateGates(g: ReadyGates): ReadyVerdict {
  const allPass = g.noBlockingFindings && g.testsPass && g.securityPass && g.performancePass && g.proofsVerified && g.limitationsDocumented
  if (allPass) return 'READY'
  // Only minor (medium/low/info) issues remain but core gates pass
  if (g.testsPass && g.securityPass && g.proofsVerified) return 'READY_WITH_RISKS'
  return 'NOT_READY'
}

// ---------------------------------------------------------------------------
// Production Sweep — 4-agent sweep + remediation + fresh resweep
// ---------------------------------------------------------------------------

export interface ProductionSweepConfig {
  /** Whether to fail on any high-or-above finding. */
  readonly failOnHigh?: boolean
}

export class ProductionSweep extends Service {
  private sweeps: SweepResult[] = []
  private remediation?: RemediationGraph

  constructor(ctx: import('@deepseek-ai/cordis').Context, private readonly config: ProductionSweepConfig = {}) {
    super(ctx, 'cf-production-sweep')
    void this.config
  }

  /**
   * Run a 4-agent sweep in parallel (stub: no findings). Production fans out
   * to 4 sub-agents: QA, annotation-linter, adversarial, UX.
   */
  async sweep(): Promise<SweepResult> {
    const now = Date.now()
    const result: SweepResult = { id: sweepId(`sweep-${this.sweeps.length}`), findings: [], startedAt: now, finishedAt: now }
    this.sweeps.push(result)
    return result
  }

  /** Deduplicate + severity-rank the last sweep's findings. */
  consolidate(result: SweepResult): Finding[] {
    return sortBySeverity(dedupFindings(result.findings))
  }

  /** Build a dependency graph of fixes (stub: no edges). */
  buildGraph(findings: readonly Finding[]): RemediationGraph {
    const g: RemediationGraph = { findings, edges: [] }
    this.remediation = g
    return g
  }

  /** Current remediation graph if any. */
  getGraph(): RemediationGraph | undefined { return this.remediation }

  /**
   * Fresh resweep with new agents after remediation (stub: delegates to sweep).
   */
  async resweep(): Promise<SweepResult> { return this.sweep() }

  /** Evaluate READY gates from a consolidated finding set and external signals. */
  checkReady(gates: ReadyGates): ReadyVerdict { return evaluateGates(gates) }

  listSweeps(): readonly SweepResult[] { return this.sweeps }
}

declare module '@deepseek-ai/cordis' {
  interface Context { 'cf-production-sweep': ProductionSweep }
}

export default ProductionSweep
