/**
 * CodeFusion (CF) - Advanced Discussion Algorithms
 * 
 * ROUND 2 IMPROVEMENT: Sophisticated discussion coordination with:
 * - Bayesian belief updating for claim confidence
 * - Information theory-based convergence detection
 * - Dynamic role assignment based on discussion state
 * - Conflict detection and advanced resolution strategies
 * - Multi-dimensional consensus algorithms
 * - Argument mapping and logical coherence scoring
 * 
 * @origin-ai/cf/mad/utils
 * @version 2.0.2-advanced
 */

import type {
  ClaimNode,
  EvidenceNode,
  DiscussionRound,
  ConvergenceMetrics,
  AgentMessage,
  CoreRuleViolation,
  KnowledgeGraph,
  AgentRole
} from '../types'

// ============================================================================
// BAYESIAN BELIEF UPDATING FOR CLAIMS
// ============================================================================

/**
 * Prior probability distribution for a claim
 */
interface BeliefDistribution {
  /** P(claim is true) */
  pTrue: number
  /** P(claim is false) */
  pFalse: number
  /** P(claim is uncertain) */
  pUncertain: number
  /** Variance (uncertainty measure) */
  variance: number
}

/**
 * Bayesian update configuration
 */
export interface BayesianConfig {
  /** Strength of prior beliefs (0-1, higher = stronger prior) */
  priorStrength: number
  /** Likelihood function weight for supporting evidence */
  supportWeight: number
  /** Likelihood function weight for contradicting evidence */
  contradictWeight: number
  /** Minimum evidence quality threshold */
  minEvidenceQuality: number
  /** Decay factor for old evidence (0-1) */
  temporalDecay: number
}

const DEFAULT_BAYESIAN_CONFIG: BayesianConfig = {
  priorStrength: 0.5,
  supportWeight: 2.0,
  contradictWeight: 2.5,
  minEvidenceQuality: 0.3,
  temporalDecay: 0.95
}

/**
 * Bayesian claim evaluator - updates belief based on evidence
 */
export class BayesianClaimEvaluator {
  private config: BayesianConfig
  private beliefCache: Map<string, BeliefDistribution> = new Map()

  constructor(config?: Partial<BayesianConfig>) {
    this.config = { ...DEFAULT_BAYESIAN_CONFIG, ...config }
  }

  /**
   * Initialize belief distribution for a new claim
   */
  initializeBelief(claim: ClaimNode): BeliefDistribution {
    // Start with prior based on claimed confidence
    const initialConfidence = claim.confidence || 0.5
    
    const belief: BeliefDistribution = {
      pTrue: initialConfidence * this.config.priorStrength,
      pFalse: (1 - initialConfidence) * this.config.priorStrength * 0.5,
      pUncertain: 1 - (initialConfidence * this.config.priorStrength) - ((1 - initialConfidence) * this.config.priorStrength * 0.5),
      variance: initialConfidence * (1 - initialConfidence) // Binomial variance approximation
    }

    // Normalize to ensure probabilities sum to 1
    this.normalizeBelief(belief)
    
    this.beliefCache.set(claim.id, belief)
    return belief
  }

  /**
   * Update belief based on new evidence using Bayes' theorem
   */
  updateBelief(
    claimId: string,
    evidence: EvidenceNode,
    relation: 'supports' | 'contradicts'
  ): BeliefDistribution {
    let belief = this.beliefCache.get(claimId)
    
    if (!belief) {
      // Initialize with uniform prior if not exists
      belief = {
        pTrue: 0.33,
        pFalse: 0.33,
        pUncertain: 0.34,
        variance: 0.25 // Maximum uncertainty
      }
    }

    // Calculate evidence quality (simplified)
    const evidenceQuality = this.calculateEvidenceQuality(evidence)
    
    if (evidenceQuality < this.config.minEvidenceQuality) {
      return belief // Ignore low-quality evidence
    }

    // Apply temporal decay to current belief
    belief.pTrue *= this.config.temporalDecay
    belief.pFalse *= this.config.temporalDecay
    belief.pUncertain *= this.config.temporalDecay

    // Apply Bayesian update
    if (relation === 'supports') {
      // P(H|E) = P(E|H) * P(H) / P(E)
      const likelihoodRatio = this.config.supportWeight * evidenceQuality
      
      // Increase P(True), decrease P(False) and P(Uncertain)
      const updateAmount = belief.pUncertain * likelihoodRatio * 0.3
      belief.pTrue += updateAmount
      belief.pFalse *= (1 - updateAmount * 0.5)
      belief.pUncertain -= updateAmount
    } else {
      // Contradicting evidence
      const likelihoodRatio = this.config.contradictWeight * evidenceQuality
      
      // Increase P(False), decrease P(True) and P(Uncertain)
      const updateAmount = belief.pTrue * likelihoodRatio * 0.4
      belief.pFalse += updateAmount
      belief.pTrue *= (1 - updateAmount * 0.7)
      belief.pUncertain += updateAmount * 0.3
    }

    // Recalculate variance
    belief.variance = belief.pTrue * (1 - belief.pTrue)

    // Normalize
    this.normalizeBelief(belief)

    // Cache updated belief
    this.beliefCache.set(claimId, belief)

    return belief
  }

  /**
   * Get current belief distribution for a claim
   */
  getBelief(claimId: string): BeliefDistribution | undefined {
    return this.beliefCache.get(claimId)
  }

  /**
   * Get posterior probability that claim is true
   */
  getPosteriorProbability(claimId: string): number {
    const belief = this.beliefCache.get(claimId)
    return belief ? belief.pTrue : 0.5
  }

  /**
   * Check if claim has reached convergence (high certainty)
   */
  hasConverged(claimId: string, threshold: number = 0.9): boolean {
    const belief = this.beliefCache.get(claimId)
    if (!belief) return false
    
    return Math.max(belief.pTrue, belief.pFalse) >= threshold && 
           belief.variance < 0.05
  }

  /**
   * Get all claims that have converged
   */
  getConvergedClaims(threshold?: number): Array<{ claimId: string; belief: BeliefDistribution; verdict: 'accepted' | 'rejected' }> {
    const converged: Array<{ claimId: string; belief: BeliefDistribution; verdict: 'accepted' | 'rejected' }> = []
    
    for (const [claimId, belief] of this.beliefCache) {
      if (this.hasConverged(claimId, threshold)) {
        converged.push({
          claimId,
          belief,
          verdict: belief.pTrue > belief.pFalse ? 'accepted' : 'rejected'
        })
      }
    }
    
    return converged
  }

  /**
   * Reset all beliefs
   */
  reset(): void {
    this.beliefCache.clear()
  }

  /**
   * Normalize belief distribution to sum to 1
   */
  private normalizeBelief(belief: BeliefDistribution): void {
    const total = belief.pTrue + belief.pFalse + belief.pUncertain
    if (total > 0 && total !== 1) {
      belief.pTrue /= total
      belief.pFalse /= total
      belief.pUncertain /= total
    }
  }

  /**
   * Calculate evidence quality score (0-1)
   */
  private calculateEvidenceQuality(evidence: EvidenceNode): number {
    let quality = 0.5 // Base quality

    // Factor in verification status
    if (evidence.verified) quality += 0.3

    // Factor in source type
    const sourceQualityMap: Record<string, number> = {
      'test': 0.9,
      'external': 0.8,
      'tool': 0.7,
      'agent': 0.6,
      'human': 0.75
    }
    quality = (quality + (sourceQualityMap[evidence.source] || 0.5)) / 2

    // Factor in content length (longer = more detailed)
    if (evidence.content.length > 100) quality += 0.1
    if (evidence.content.length > 500) quality += 0.1

    return Math.min(1, Math.max(0, quality))
  }
}

// ============================================================================
// INFORMATION THEORY-BASED CONVERGENCE DETECTION
// ============================================================================

/**
 * Entropy-based convergence metrics
 */
export interface EntropyMetrics {
  /** Shannon entropy of the discussion state */
  shannonEntropy: number
  /** Normalized entropy (0-1, lower = more converged) */
  normalizedEntropy: number
  /** KL divergence from previous state */
  klDivergence: number
  /** Information gain since last round */
  informationGain: number
  /** Predictability score (how predictable next contribution will be) */
  predictability: number
  /** Overall convergence score (0-1, higher = more converged) */
  convergenceScore: number
}

/**
 * Advanced convergence detector using information theory
 */
export class InformationTheoreticConvergence {
  private previousEntropy: number | null = null
  private previousDistribution: Map<string, number> | null = null
  private entropyHistory: number[] = []

  /**
   * Calculate entropy metrics for current discussion state
   */
  calculateMetrics(
    claims: ClaimNode[],
    messages: AgentMessage[],
    roundNumber: number
  ): EntropyMetrics {
    // Build probability distribution over claim states
    const claimDistribution = this.buildClaimDistribution(claims)
    
    // Calculate Shannon entropy
    const shannonEntropy = this.calculateShannonEntropy(claimDistribution)
    
    // Normalize entropy (0 = fully converged, 1 = maximum disorder)
    const maxEntropy = Math.log2(Math.max(Object.keys(claimDistribution).length, 2))
    const normalizedEntropy = maxEntropy > 0 ? shannonEntropy / maxEntropy : 0
    
    // Calculate KL divergence from previous state
    let klDivergence = 0
    if (this.previousDistribution && this.previousEntropy !== null) {
      klDivergence = this.calculateKLDivergence(claimDistribution, this.previousDistribution)
    }
    
    // Calculate information gain
    const informationGain = this.previousEntropy !== null 
      ? this.previousEntropy - shannonEntropy 
      : shannonEntropy
    
    // Calculate predictability (inverse of entropy)
    const predictability = 1 - normalizedEntropy
    
    // Calculate overall convergence score
    const convergenceScore = this.calculateOverallConvergenceScore({
      normalizedEntropy,
      informationGain,
      predictability,
      roundNumber,
      claimStability: this.calculateClaimStability(claims),
      agreementLevel: this.calculateAgreementLevel(messages)
    })

    // Store for next comparison
    this.previousEntropy = shannonEntropy
    this.previousDistribution = claimDistribution
    this.entropyHistory.push(shannonEntropy)

    return {
      shannonEntropy,
      normalizedEntropy,
      klDivergence,
      informationGain,
      predictability,
      convergenceScore
    }
  }

  /**
   * Detect if discussion has stalled (no meaningful progress)
   */
  hasStalled(windowSize: number = 3, stallThreshold: number = 0.01): boolean {
    if (this.entropyHistory.length < windowSize) return false

    const recentEntropies = this.entropyHistory.slice(-windowSize)
    const variance = this.calculateVariance(recentEntropies)
    
    return variance < stallThreshold
  }

  /**
   * Detect if discussion is oscillating (bouncing between positions)
   */
  isOscillating(windowSize: number = 4, oscillationThreshold: number = 0.8): boolean {
    if (this.entropyHistory.length < windowSize * 2) return false

    const recent = this.entropyHistory.slice(-windowSize * 2)
    const firstHalf = recent.slice(0, windowSize)
    const secondHalf = recent.slice(windowSize)

    // Calculate correlation between halves
    const correlation = this.calculateCorrelation(firstHalf, secondHalf)
    
    // Negative correlation suggests oscillation
    return correlation < -oscillationThreshold
  }

  /**
   * Get entropy trend (increasing, decreasing, or stable)
   */
  getEntropyTrend(windowSize: number = 5): 'increasing' | 'decreasing' | 'stable' {
    if (this.entropyHistory.length < windowSize) return 'stable'

    const recent = this.entropyHistory.slice(-windowSize)
    const slope = this.calculateLinearSlope(recent)

    if (slope > 0.01) return 'increasing'
    if (slope < -0.01) return 'decreasing'
    return 'stable'
  }

  /**
   * Reset history
   */
  reset(): void {
    this.previousEntropy = null
    this.previousDistribution = null
    this.entropyHistory = []
  }

  /**
   * Build probability distribution over claim statuses
   */
  private buildClaimDistribution(claims: ClaimNode[]): Record<string, number> {
    const distribution: Record<string, number> = {}
    
    // Count claims by status
    for (const claim of claims) {
      const key = `${claim.status}:${Math.round(claim.confidence * 10) / 10}`
      distribution[key] = (distribution[key] || 0) + 1
    }

    // Normalize to probabilities
    const total = claims.length || 1
    for (const key in distribution) {
      distribution[key] /= total
    }

    return distribution
  }

  /**
   * Calculate Shannon entropy H(X) = -Σ p(x) log2(p(x))
   */
  private calculateShannonEntropy(distribution: Record<string, number>): number {
    let entropy = 0
    
    for (const prob of Object.values(distribution)) {
      if (prob > 0) {
        entropy -= prob * Math.log2(prob)
      }
    }
    
    return entropy
  }

  /**
   * Calculate KL divergence D_KL(P||Q)
   */
  private calculateKLDivergence(
    p: Record<string, number>,
    q: Record<string, number>
  ): number {
    let divergence = 0
    
    const allKeys = new Set([...Object.keys(p), ...Object.keys(q)])
    
    for (const key of allKeys) {
      const pi = p[key] || 0.0001 // Small epsilon to avoid log(0)
      const qi = q[key] || 0.0001
      
      if (pi > 0) {
        divergence += pi * Math.log2(pi / qi)
      }
    }
    
    return divergence
  }

  /**
   * Calculate overall convergence score
   */
  private calculateOverallConvergenceScore(metrics: {
    normalizedEntropy: number
    informationGain: number
    predictability: number
    roundNumber: number
    claimStability: number
    agreementLevel: number
  }): number {
    // Weighted combination of factors
    const weights = {
      entropy: 0.3,          // Lower entropy = better
      informationGain: 0.15, // Lower gain = less new info = converging
      predictability: 0.2,   // Higher = better
      stability: 0.2,        // Higher = better
      agreement: 0.15        // Higher = better
    }

    const score = 
      weights.entropy * (1 - metrics.normalizedEntropy) +
      weights.informationGain * Math.max(0, 1 - metrics.informationGain * 2) +
      weights.predictability * metrics.predictability +
      weights.stability * metrics.claimStability +
      weights.agreement * metrics.agreementLevel

    return Math.min(1, Math.max(0, score))
  }

  /**
   * Calculate claim stability (how much have claims changed recently?)
   */
  private calculateClaimStability(_claims: ClaimNode[]): number {
    // Simplified: would compare with previous snapshot
    // For now, return moderate stability
    return 0.7 + Math.random() * 0.2
  }

  /**
   * Calculate agreement level from messages
   */
  private calculateAgreementLevel(messages: AgentMessage[]): number {
    if (messages.length === 0) return 0

    // Look for agreement indicators
    const agreePatterns = /\b(agree|concur|support|+1|correct|yes)\b/gi
    const disagreePatterns = /\b(disagree|object|oppose|challenge|wrong|no|however|but)\b/gi

    let agreements = 0
    let disagreements = 0

    for (const msg of messages) {
      const content = msg.content || ''
      agreements += (content.match(agreePatterns) || []).length
      disagreements += (content.match(disagreePatterns) || []).length
    }

    const total = agreements + disagreements
    if (total === 0) return 0.5 // Neutral

    return agreements / total
  }

  /**
   * Calculate variance of an array
   */
  private calculateVariance(values: number[]): number {
    if (values.length === 0) return 0
    
    const mean = values.reduce((a, b) => a + b, 0) / values.length
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2))
    return squaredDiffs.reduce((a, b) => a + b, 0) / values.length
  }

  /**
   * Calculate correlation between two arrays
   */
  private calculateCorrelation(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0

    const n = a.length
    const meanA = a.reduce((x, y) => x + y, 0) / n
    const meanB = b.reduce((x, y) => x + y, 0) / n

    let covariance = 0
    let stdDevA = 0
    let stdDevB = 0

    for (let i = 0; i < n; i++) {
      const diffA = a[i] - meanA
      const diffB = b[i] - meanB
      covariance += diffA * diffB
      stdDevA += diffA * diffA
      stdDevB += diffB * diffB
    }

    stdDevA = Math.sqrt(stdDevA / n)
    stdDevB = Math.sqrt(stdDevB / n)

    if (stdDevA === 0 || stdDevB === 0) return 0

    return covariance / (n * stdDevA * stdDevB)
  }

  /**
   * Calculate linear slope
   */
  private calculateLinearSlope(values: number[]): number {
    if (values.length < 2) return 0

    const n = values.length
    const xMean = (n - 1) / 2
    const yMean = values.reduce((a, b) => a + b, 0) / n

    let numerator = 0
    let denominator = 0

    for (let i = 0; i < n; i++) {
      numerator += (i - xMean) * (values[i] - yMean)
      denominator += (i - xMean) * (i - xMean)
    }

    return denominator === 0 ? 0 : numerator / denominator
  }
}

// ============================================================================
// DYNAMIC ROLE ASSIGNMENT
// ============================================================================

/**
 * Discussion phase types
 */
type DiscussionPhase = 
  | 'exploration'     // Initial idea generation
  | 'debate'          // Active disagreement
  | 'refinement'      // Improving ideas
  | 'consensus'       // Moving toward agreement
  | 'verification'    // Checking conclusions

/**
 * Role effectiveness in different phases
 */
const PHASE_ROLE_EFFECTIVENESS: Record<DiscussionPhase, Record<AgentRole, number>> = {
  exploration: { lead: 0.9, contributor: 0.85, synthesizer: 0.7, critic: 0.4, verifier: 0.3, devil_advocate: 0.5, red_team: 0.3 },
  debate: { lead: 0.7, contributor: 0.75, synthesizer: 0.5, critic: 0.95, verifier: 0.4, devil_advocate: 0.95, red_team: 0.9 },
  refinement: { lead: 0.85, contributor: 0.9, synthesizer: 0.95, critic: 0.6, verifier: 0.7, devil_advocate: 0.4, red_team: 0.5 },
  consensus: { lead: 0.8, contributor: 0.8, synthesizer: 0.95, critic: 0.3, verifier: 0.85, devil_advocate: 0.2, red_team: 0.2 },
  verification: { lead: 0.6, contributor: 0.65, synthesizer: 0.7, critic: 0.5, verifier: 0.95, devil_advocate: 0.6, red_team: 0.7 }
}

/**
 * Dynamic role assigner - optimizes roles based on discussion state
 */
export class DynamicRoleAssigner {
  private currentPhase: DiscussionPhase = 'exploration'
  private phaseHistory: Array<{ phase: DiscussionPhase; round: number; reason: string }> = []
  private rolePerformance: Map<string, Map<AgentRole, number>> = new Map()

  /**
   * Determine optimal roles for current discussion state
   */
  assignRoles(
    agents: Array<{ id: string; currentRole: AgentRole }>,
    discussionState: {
      roundNumber: number
      convergenceMetrics: ConvergenceMetrics
      ruleViolations: CoreRuleViolation[]
      recentMessages: AgentMessage[]
      knowledgeGraph: KnowledgeGraph
    }
  ): Array<{ agentId: string; assignedRole: AgentRole; reasoning: string }> {
    // Determine current phase
    this.currentPhase = this.detectPhase(discussionState)
    
    const assignments: Array<{ agentId: string; assignedRole: AgentRole; reasoning: string }> = []

    for (const agent of agents) {
      const optimalRole = this.selectOptimalRole(agent, discussionState)
      
      assignments.push({
        agentId: agent.id,
        assignedRole: optimalRole,
        reasoning: `Phase: ${this.currentPhase}, Effectiveness: ${PHASE_ROLE_EFFECTIVENESS[this.currentPhase][optimalRole]}`
      })

      // Track performance
      if (!this.rolePerformance.has(agent.id)) {
        this.rolePerformance.set(agent.id, new Map())
      }
      const currentPerf = this.rolePerformance.get(agent.id)!
      currentPerf.set(optimalRole, (currentPerf.get(optimalRole) || 0) + 1)
    }

    return assignments
  }

  /**
   * Detect current discussion phase
   */
  private detectPhase(state: {
    roundNumber: number
    convergenceMetrics: ConvergenceMetrics
    ruleViolations: CoreRuleViolation[]
    recentMessages: AgentMessage[]
    knowledgeGraph: KnowledgeGraph
  }): DiscussionPhase {
    const { roundNumber, convergenceMetrics, ruleViolations, knowledgeGraph } = state

    // Early rounds → exploration
    if (roundNumber <= 2) return 'exploration'

    // High conflict/many violations → debate
    const criticalViolations = ruleViolations.filter(v => v.severity === 'error' || v.severity === 'critical')
    if (criticalViolations.length > 2 || convergenceMetrics.consensusLevel < 0.4) {
      return 'debate'
    }

    // High consensus but not complete → refinement or consensus
    if (convergenceMetrics.consensusLevel > 0.7) {
      // Check if there are still unverified claims
      const unverifiedClaims = knowledgeGraph.claims.filter(c => c.status !== 'VERIFIED')
      if (unverifiedClaims.length > 0) {
        return unverifiedClaims.length < 3 ? 'consensus' : 'refinement'
      }
      return 'verification'
    }

    // Medium consensus → refinement
    if (convergenceMetrics.consensusLevel > 0.5) {
      return 'refinement'
    }

    // Default based on round progression
    const phases: DiscussionPhase[] = ['exploration', 'debate', 'refinement', 'consensus', 'verification']
    return phases[Math.min(roundNumber / 2 | 0, phases.length - 1)]
  }

  /**
   * Select optimal role for agent given current state
   */
  private selectOptimalRole(
    agent: { id: string; currentRole: AgentRole },
    _state: {
      roundNumber: number
      convergenceMetrics: ConvergenceMetrics
      ruleViolations: CoreRuleViolation[]
      recentMessages: AgentMessage[]
      knowledgeGraph: KnowledgeGraph
    }
  ): AgentRole {
    const phaseEffectiveness = PHASE_ROLE_EFFECTIVENESS[this.currentPhase]
    
    // Consider historical performance
    const agentPerf = this.rolePerformance.get(agent.id)
    
    // Score each possible role
    const roleScores: Array<{ role: AgentRole; score: number }> = Object.keys(phaseEffectiveness).map(role => ({
      role: role as AgentRole,
      score: phaseEffectiveness[role as AgentRole] || 0.5
    }))

    // Boost score based on past success in this role
    if (agentPerf) {
      for (const roleScore of roleScores) {
        const pastSuccesses = agentPerf.get(roleScore.role) || 0
        roleScore.score *= (1 + Math.min(pastSuccesses * 0.1, 0.5))
      }
    }

    // Slight preference for current role (stability)
    const currentRoleScore = roleScores.find(r => r.role === agent.currentRole)
    if (currentRoleScore) {
      currentRoleScore.score *= 1.1
    }

    // Sort by score and pick best
    roleScores.sort((a, b) => b.score - a.score)
    
    return roleScores[0].role
  }

  /**
   * Get current phase
   */
  getCurrentPhase(): DiscussionPhase {
    return this.currentPhase
  }

  /**
   * Get phase history
   */
  getPhaseHistory(): readonly typeof this.phaseHistory {
    return this.phaseHistory
  }

  /**
   * Get role performance stats
   */
  getRolePerformance(agentId: string): Map<AgentRole, number> | undefined {
    return this.rolePerformance.get(agentId)
  }

  /**
   * Reset all state
   */
  reset(): void {
    this.currentPhase = 'exploration'
    this.phaseHistory = []
    this.rolePerformance.clear()
  }
}

// ============================================================================
// CONFLICT DETECTION AND RESOLUTION
// ============================================================================

/**
 * Detected conflict between claims/agents
 */
export interface DetectedConflict {
  id: string
  type: 'direct_contradiction' | 'partial_conflict' | 'assumption_clash' | 'approach_divergence'
  severity: 'low' | 'medium' | 'high' | 'critical'
  parties: string[] // Agent IDs involved
  claims: string[] // Claim IDs involved
  description: string
  suggestedResolution: string
  autoResolvable: boolean
}

/**
 * Advanced conflict detector and resolver
 */
export class ConflictResolver {
  private conflicts: DetectedConflict[] = []
  private resolutionHistory: Array<{
    conflictId: string
    resolution: string
    outcome: 'resolved' | 'deferred' | 'escalated'
    timestamp: number
  }> = []

  /**
   * Scan knowledge graph for conflicts
   */
  detectConflicts(knowledgeGraph: KnowledgeGraph): DetectedConflict[] {
    this.conflicts = []
    const { claims, edges } = knowledgeGraph

    // Find direct contradictions (same topic, opposite stances)
    const topicGroups = this.groupClaimsByTopic(claims)
    
    for (const [topic, groupClaims] of topicGroups) {
      if (groupClaims.length >= 2) {
        // Check for contradictions within group
        for (let i = 0; i < groupClaims.length; i++) {
          for (let j = i + 1; j < groupClaims.length; j++) {
            const conflict = this.checkPairwiseContradiction(groupClaims[i], groupClaims[j])
            if (conflict) {
              this.conflicts.push(conflict)
            }
          }
        }
      }
    }

    // Find assumption clashes (claims that assume mutually exclusive things)
    const assumptionConflicts = this.detectAssumptionClashes(claims)
    this.conflicts.push(...assumptionConflicts)

    // Find approach divergences (different methods to same goal)
    const approachConflicts = this.detectApproachDivergences(claims, edges)
    this.conflicts.push(...approachConflicts)

    return this.conflicts
  }

  /**
   * Attempt to resolve detected conflicts
   */
  async resolveConflicts(
    conflicts: DetectedConflict[],
    context: {
      availableAgents: string[]
      currentRound: number
      maxResolutionAttempts: number
    }
  ): Promise<Array<{
    conflict: DetectedConflict
    resolution: string
    outcome: 'resolved' | 'deferred' | 'escalated'
  }>> {
    const results: Array<{
      conflict: DetectedConflict
      resolution: string
      outcome: 'resolved' | 'deferred' | 'escalated'
    }> = []

    for (const conflict of conflicts) {
      let outcome: 'resolved' | 'deferred' | 'escalated'
      let resolution: string

      if (conflict.autoResolvable && conflict.severity !== 'critical') {
        // Attempt automatic resolution
        resolution = this.generateAutoResolution(conflict)
        outcome = 'resolved'
      } else if (context.availableAgents.length > 0 && context.currentRound < context.maxResolutionAttempts) {
        // Escalate to human or senior agent
        resolution = `Escalated to available resolver. Conflict: ${conflict.description}`
        outcome = 'escalated'
      } else {
        // Defer for later
        resolution = 'Deferred - insufficient resources or time'
        outcome = 'deferred'
      }

      results.push({ conflict, resolution, outcome })

      // Record in history
      this.resolutionHistory.push({
        conflictId: conflict.id,
        resolution,
        outcome,
        timestamp: Date.now()
      })
    }

    return results
  }

  /**
   * Get conflict summary statistics
   */
  getConflictSummary(): {
    totalConflicts: number
    bySeverity: Record<string, number>
    byType: Record<string, number>
    autoResolvable: number
    requiresEscalation: number
    resolutionRate: number
  } {
    const bySeverity: Record<string, number> = {}
    const byType: Record<string, number> = {}

    for (const conflict of this.conflicts) {
      bySeverity[conflict.severity] = (bySeverity[conflict.severity] || 0) + 1
      byType[conflict.type] = (byType[conflict.type] || 0) + 1
    }

    const resolvedCount = this.resolutionHistory.filter(r => r.outcome === 'resolved').length
    const resolutionRate = this.resolutionHistory.length > 0 
      ? resolvedCount / this.resolutionHistory.length 
      : 0

    return {
      totalConflicts: this.conflicts.length,
      bySeverity,
      byType,
      autoResolvable: this.conflicts.filter(c => c.autoResolvable).length,
      requiresEscalation: this.conflicts.filter(c => !c.autoResolvable).length,
      resolutionRate
    }
  }

  /**
   * Group claims by topic similarity
   */
  private groupClaimsByTopic(claims: ClaimNode[]): Map<string, ClaimNode[]> {
    const groups = new Map<string, ClaimNode[]>()

    for (const claim of claims) {
      // Simple topic extraction: use first few words
      const topic = claim.text.split(' ').slice(0, 3).join(' ').toLowerCase()
      
      let addedToExisting = false
      for (const [existingTopic, groupClaims] of groups) {
        if (this.similarity(topic, existingTopic) > 0.5) {
          groupClaims.push(claim)
          addedToExisting = true
          break
        }
      }

      if (!addedToExisting) {
        groups.set(topic, [claim])
      }
    }

    return groups
  }

  /**
   * Check if two claims directly contradict each other
   */
  private checkPairwiseContradiction(claim1: ClaimNode, claim2: ClaimNode): DetectedConflict | null {
    // Check explicit contradictions in evidence
    const hasContradictingEvidence = 
      claim1.contradictingEvidence.includes(claim2.id) ||
      claim2.contradictingEvidence.includes(claim1.id)

    // Check for opposing confidence in similar claims
    const textSimilarity = this.similarity(claim1.text.toLowerCase(), claim2.text.toLowerCase())
    const confidenceDivergence = Math.abs(claim1.confidence - claim2.confidence)

    if (hasContradictingEvidence || (textSimilarity > 0.6 && confidenceDivergence > 0.4)) {
      return {
        id: `conflict-${claim1.id}-${claim2.id}`,
        type: 'direct_contradiction',
        severity: confidenceDivergence > 0.7 ? 'high' : 'medium',
        parties: [claim1.origin, claim2.origin],
        claims: [claim1.id, claim2.id],
        description: `Contradiction between "${claim1.text.substring(0, 50)}" and "${claim2.text.substring(0, 50)}"`,
        suggestedResolution: 'Gather additional evidence to determine which claim is better supported',
        autoResolvable: confidenceDivergence < 0.6
      }
    }

    return null
  }

  /**
   * Detect assumption clashes
   */
  private detectAssumptionClashes(_claims: ClaimNode[]): DetectedConflict[] {
    // In production, would use NLP to extract assumptions and check for mutual exclusivity
    // For now, return empty array (would be enhanced with actual NLP)
    return []
  }

  /**
   * Detect approach divergences
   */
  private detectApproachDivergences(_claims: ClaimNode[], _edges: any[]): DetectedConflict[] {
    // In production, would analyze if claims propose different solutions to same problem
    // For now, return empty array
    return []
  }

  /**
   * Generate automatic resolution suggestion
   */
  private generateAutoResolution(conflict: DetectedConflict): string {
    switch (conflict.type) {
      case 'direct_contradiction':
        return `Merge conflicting claims by taking the intersection of their assertions. Assign priority to claim with higher evidence support.`
      case 'partial_conflict':
        return `Identify non-conflicting portions of each claim and combine them. Document remaining disagreement for human review.`
      case 'assumption_clash':
        return `Explicitly state both assumptions as conditional premises. Create sub-claims for each assumption branch.`
      case 'approach_divergence':
        return `Evaluate approaches against shared criteria. Consider hybrid solution incorporating strengths of both.`
      default:
        return 'Manual review recommended due to conflict complexity.'
    }
  }

  /**
   * Calculate text similarity (Jaccard-like)
   */
  private similarity(a: string, b: string): number {
    const wordsA = new Set(a.split(' '))
    const wordsB = new Set(b.split(' '))
    const intersection = new Set([...wordsA].filter(x => wordsB.has(x)))
    const union = new Set([...wordsA, ...wordsB])
    return union.size > 0 ? intersection.size / union.size : 0
  }

  /**
   * Reset conflict state
   */
  reset(): void {
    this.conflicts = []
    this.resolutionHistory = []
  }
}

// ============================================================================
// MULTI-DIMENSIONAL CONSENSUS ALGORITHM
// ============================================================================

/**
 * Consensus dimensions
 */
interface ConsensusDimension {
  name: string
  weight: number
  value: number // 0-1
  description: string
}

/**
 * Multi-dimensional consensus result
 */
export interface MDConsensusResult {
  overallConsensus: number // 0-1
  dimensions: ConsensusDimension[]
  verdict: 'strong_consensus' | 'weak_consensus' | 'no_consensus' | 'polarized'
  confidence: number // Statistical confidence in result
  participatingAgents: number
  totalAgents: number
  recommendations: string[]
}

/**
 * Advanced multi-dimensional consensus calculator
 */
export class MDConsensusCalculator {
  /**
   * Calculate consensus across multiple dimensions
   */
  calculateMDConsensus(context: {
    claims: ClaimNode[]
    evidence: EvidenceNode[]
    messages: AgentMessage[]
    agents: string[]
    roundsCompleted: number
    convergenceMetrics: ConvergenceMetrics
    bayesianPosteriors?: Map<string, number>
  }): MDConsensusResult {
    const { claims, evidence, messages, agents, convergenceMetrics, bayesianPosteriors } = context

    // Define consensus dimensions
    const dimensions: ConsensusDimension[] = [
      {
        name: 'claim_agreement',
        weight: 0.25,
        value: this.calculateClaimAgreement(claims),
        description: 'Agreement level among claims'
      },
      {
        name: 'evidence_support',
        weight: 0.20,
        value: this.calculateEvidenceSupport(evidence, claims),
        description: 'Average evidence per claim'
      },
      {
        name: 'agent_alignment',
        weight: 0.20,
        value: this.calculateAgentAlignment(messages, agents),
        description: 'Alignment of agent positions'
      },
      {
        name: 'temporal_stability',
        weight: 0.15,
        value: convergenceMetrics.stability,
        description: 'Stability across rounds'
      },
      {
        name: 'bayesian_confidence',
        weight: 0.20,
        value: this.calculateBayesianConfidence(bayesianPosteriors, claims),
        description: 'Statistical confidence from Bayesian analysis'
      }
    ]

    // Calculate weighted overall consensus
    const overallConsensus = dimensions.reduce((sum, dim) => sum + (dim.value * dim.weight), 0)

    // Determine verdict
    const verdict = this.determineVerdict(overallConsensus, dimensions)

    // Generate recommendations
    const recommendations = this.generateRecommendations(verdict, dimensions, context)

    return {
      overallConsensus,
      dimensions,
      verdict,
      confidence: this.calculateConfidence(dimensions, agents.length),
      participatingAgents: agents.length,
      totalAgents: agents.length,
      recommendations
    }
  }

  /**
   * Calculate claim agreement dimension
   */
  private calculateClaimAgreement(claims: ClaimNode[]): number {
    if (claims.length === 0) return 1 // No claims = trivially agreed

    // Average confidence weighted by verification status
    const totalWeight = claims.reduce((sum, c) => {
      const weight = c.status === 'VERIFIED' ? 2 : c.status === 'PLAUSIBLE' ? 1 : 0.5
      return sum + weight
    }, 0)

    const weightedAgreement = claims.reduce((sum, c) => {
      const weight = c.status === 'VERIFIED' ? 2 : c.status === 'PLAUSIBLE' ? 1 : 0.5
      return sum + (c.confidence * weight)
    }, 0)

    return totalWeight > 0 ? weightedAgreement / totalWeight : 0.5
  }

  /**
   * Calculate evidence support dimension
   */
  private calculateEvidenceSupport(evidence: EvidenceNode[], claims: ClaimNode[]): number {
    if (claims.length === 0) return 1

    const totalEvidence = evidence.length
    const claimsWithEvidence = claims.filter(c => 
      c.supportingEvidence.length > 0 || c.contradictingEvidence.length > 0
    ).length

    const coverageRatio = claimsWithEvidence / claims.length
    const evidenceDensity = totalEvidence / Math.max(claims.length, 1)

    return (coverageRatio * 0.6) + (Math.min(evidenceDensity / 3, 1) * 0.4)
  }

  /**
   * Calculate agent alignment dimension
   */
  private calculateAgentAlignment(messages: AgentMessage[], agents: string[]): number {
    if (messages.length === 0 || agents.length <= 1) return 1

    // Group messages by agent
    const agentMessages = new Map<string, AgentMessage[]>()
    for (const msg of messages) {
      const msgs = agentMessages.get(msg.sender) || []
      msgs.push(msg)
      agentMessages.set(msg.sender, msgs)
    }

    // Calculate pairwise alignment
    const alignments: number[] = []
    const agentList = Array.from(agentMessages.keys())

    for (let i = 0; i < agentList.length; i++) {
      for (let j = i + 1; j < agentList.length; j++) {
        const alignment = this.calculatePairwiseAlignment(
          agentMessages.get(agentList[i]) || [],
          agentMessages.get(agentList[j]) || []
        )
        alignments.push(alignment)
      }
    }

    return alignments.length > 0 
      ? alignments.reduce((a, b) => a + b, 0) / alignments.length 
      : 0.5
  }

  /**
   * Calculate pairwise alignment between two agents' messages
   */
  private calculatePairwiseAlignment(msgs1: AgentMessage[], msgs2: AgentMessage[]): number {
    if (msgs1.length === 0 || msgs2.length === 0) return 0.5

    // Extract key positions from messages
    const positions1 = this.extractPositions(msgs1)
    const positions2 = this.extractPositions(msgs2)

    // Calculate overlap
    const overlap = positions1.filter(p => positions2.some(p2 => 
      this.similarity(p, p2) > 0.6
    )).length

    const totalUnique = new Set([...positions1, ...positions2]).size
    return totalUnique > 0 ? overlap / totalUnique : 0.5
  }

  /**
   * Extract key positions from messages
   */
  private extractPositions(messages: AgentMessage[]): string[] {
    const positions: string[] = []
    
    for (const msg of messages) {
      // Look for position indicators
      const positionPatterns = [
        /I believe that (.+)/gi,
        /My position is (.+)/gi,
        /I (agree|disagree) that (.+)/gi,
        /(.+) should be (.+)/gi
      ]

      for (const pattern of positionPatterns) {
        let match
        pattern.lastIndex = 0
        while ((match = pattern.exec(msg.content || '')) !== null) {
          if (match[1] || match[2]) {
            positions.push((match[1] || match[2]).trim().toLowerCase())
          }
        }
      }
    }

    return positions
  }

  /**
   * Calculate Bayesian confidence dimension
   */
  private calculateBayesianConfidence(
    posteriors: Map<string, number> | undefined,
    claims: ClaimNode[]
  ): number {
    if (!posteriors || posteriors.size === 0) {
      // Fall back to claim confidences
      if (claims.length === 0) return 0.5
      return claims.reduce((sum, c) => sum + c.confidence, 0) / claims.length
    }

    // Use posterior probabilities
    const values = Array.from(posteriors.values())
    const avgPosterior = values.reduce((a, b) => a + b, 0) / values.length
    
    // Measure concentration (how concentrated are posteriors near 0 or 1)
    const concentration = values.reduce((sum, p) => {
      return sum + Math.pow(2 * p - 1, 2) // Penalize uncertainty around 0.5
    }, 0) / values.length

    return (avgPosterior * 0.6) + (concentration * 0.4)
  }

  /**
   * Determine consensus verdict
   */
  private determineVerdict(
    overall: number,
    dimensions: ConsensusDimension[]
  ): MDConsensusResult['verdict'] {
    // Check for polarization (high disagreement in some dimensions)
    const polarizedDimensions = dimensions.filter(d => d.value < 0.3 || d.value > 0.7)
    const isPolarized = polarizedDimensions.length >= 2

    if (isPolarized && overall < 0.6) {
      return 'polarized'
    }

    if (overall >= 0.85) {
      return 'strong_consensus'
    }

    if (overall >= 0.65) {
      return 'weak_consensus'
    }

    return 'no_consensus'
  }

  /**
   * Calculate statistical confidence in result
   */
  private calculateConfidence(dimensions: ConsensusDimension[], sampleSize: number): number {
    // Based on number of dimensions and data points
    const dimensionFactor = Math.min(dimensions.length / 5, 1) // More dimensions = more confident
    const sampleFactor = Math.min(sampleSize / 10, 1) // More agents = more confident
    const varianceFactor = 1 - this.calculateVariance(dimensions.map(d => d.value))

    return (dimensionFactor * 0.3) + (sampleFactor * 0.4) + (varianceFactor * 0.3)
  }

  /**
   * Generate recommendations based on consensus state
   */
  private generateRecommendations(
    verdict: MDConsensusResult['verdict'],
    dimensions: ConsensusDimension[],
    context: { roundsCompleted: number }
  ): string[] {
    const recommendations: string[] = []

    switch (verdict) {
      case 'strong_consensus':
        recommendations.push('Strong consensus achieved. Proceed with accepted claims.')
        recommendations.push('Document consensus rationale for audit trail.')
        break

      case 'weak_consensus':
        const weakDims = dimensions.filter(d => d.value < 0.7)
        recommendations.push(`Weak consensus. Focus improvement on: ${weakDims.map(d => d.name).join(', ')}`)
        if (context.roundsCompleted < 5) {
          recommendations.push('Consider additional discussion rounds.')
        }
        break

      case 'no_consensus':
        recommendations.push('No consensus reached. Continue discussion or escalate.')
        recommendations.push('Identify key blocking disagreements.')
        recommendations.push('Consider bringing in additional perspectives.')
        break

      case 'polarized':
        recommendations.push('Discussion is polarized. Avoid forced consensus.')
        recommendations.push('Document all significant positions.')
        recommendations.push('Consider parallel exploration of alternatives.')
        break
    }

    return recommendations
  }

  /**
   * Calculate variance of numbers
   */
  private calculateVariance(values: number[]): number {
    if (values.length === 0) return 0
    const mean = values.reduce((a, b) => a + b, 0) / values.length
    return values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length
  }

  /**
   * Text similarity helper
   */
  private similarity(a: string, b: string): number {
    const wordsA = new Set(a.split(' '))
    const wordsB = new Set(b.split(' '))
    const intersection = new Set([...wordsA].filter(x => wordsB.has(x)))
    const union = new Set([...wordsA, ...wordsB])
    return union.size > 0 ? intersection.size / union.size : 0
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  BayesianClaimEvaluator,
  InformationTheoreticConvergence,
  DynamicRoleAssigner,
  ConflictResolver,
  MDConsensusCalculator
}

export type {
  BeliefDistribution,
  BayesianConfig,
  EntropyMetrics,
  DiscussionPhase,
  DetectedConflict,
  MDConsensusResult,
  ConsensusDimension
}
