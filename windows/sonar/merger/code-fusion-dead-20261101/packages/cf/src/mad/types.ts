/**
 * CodeFusion (CF) - MAD (Multi-Agent Deployment) System
 *
 * Core type definitions for the Multi-Agent Deployment architecture.
 * This implements the complete GOD Runtime specification from TRANSCRIPT.md.
 *
 * @origin-ai/cf/mad
 * @version 2.0.0
 *
 * Also known as:
 * - CodeFusion / CodeFusion
 * - CodeFusion
 *
 * Fork of: CodeFusion
 */

// ============================================================================
// Core Identity Types
// ============================================================================

export interface CfIdentity {
  /** Primary project name */
  name: 'CodeFusion' | 'CF'
  /** Alternative names / aliases */
  aliases: ('CodeFusion' | 'CF')[]
  /** Package scope */
  packageScope: '@origin-ai/cf'
  /** Lineage note */
  forkOf: 'CodeFusion'
}

export const CF_IDENTITY: CfIdentity = {
  name: 'CodeFusion',
  aliases: ['CodeFusion', 'CF'],
  packageScope: '@origin-ai/cf',
  forkOf: 'CodeFusion',
}

// ============================================================================
// Provider & Model Types (from TRANSCRIPT Section 1)
// ============================================================================

export interface ProviderCredential {
  id: string
  key: string
  provider: string
  models: ModelConfig[]
  rateLimits?: RateLimit
  priority?: number // Lower = higher priority for routing
  enabled?: boolean
}

export interface ModelConfig {
  id: string
  name: string
  contextWindow: number // tokens
  maxOutput: number // tokens
  cost?: CostStructure
  capabilities: ModelCapability[]
  strengths?: string[] // What this model is best at
  weaknesses?: string[] // Known limitations
  latencyMs?: number // Average response time
  reliabilityScore?: number // 0-1 historical reliability
}

export interface RateLimit {
  concurrent: number
  rpm?: number // requests per minute
  tpm?: number // tokens per minute
}

export interface CostStructure {
  inputPer1K: number
  outputPer1K: number
  cacheHitPer1K?: number
}

export type ModelCapability =
  | 'code-generation'
  | 'debugging'
  | 'analysis'
  | 'vision'
  | 'math'
  | 'reasoning'
  | 'creative'
  | 'security'
  | 'testing'
  | 'documentation'
  | 'architecture'
  | 'optimization'

// ============================================================================
// Agent Types (from TRANSCRIPT Section 4-5)
// ============================================================================

export interface AgentConfig {
  id: string
  name: string
  provider: string
  model: string
  role: AgentRole
  specialization: string[]
  apiKeyRef: string
  personality?: AgentPersonality
  constraints?: AgentConstraints
}

export interface AgentPersonality {
  aggressionLevel: 'low' | 'medium' | 'high' | 'adaptive'
  creativityBias: number // 0-1, higher = more creative
  thoroughnessBias: number // 0-1, higher = more thorough
  communicationStyle: 'formal' | 'casual' | 'technical' | 'socratic'
  devilAdvocateProbability: number // 0-1, chance to challenge consensus
}

export interface AgentConstraints {
  maxTokensPerResponse?: number
  forcedPerspective?: boolean // Must maintain assigned role
  allowedTopics?: string[]
  blockedTopics?: string[]
  evidenceRequired?: boolean // Must provide evidence for claims
}

export type AgentRole =
  | 'lead'
  | 'contributor'
  | 'critic'
  | 'verifier'
  | 'synthesizer'
  | 'devil_advocate'
  | 'red_team'
  | 'builder'
  | 'architect'
  | 'debugger'
  | 'tester'
  | 'security'
  | 'ux'
  | 'coordinator'
  | 'devils_advocate'
  | 'researcher'
  | 'documenter'

export interface ActiveAgent extends AgentConfig {
  instanceId: string
  messageCount: number
  lastResponse: string
  isActive: boolean
  performanceScore: number // 0-100, updated dynamically
  subAgents?: ActiveAgent[]
  currentTask?: string
  state: 'idle' | 'thinking' | 'responding' | 'waiting' | 'error'
  metrics: AgentMetrics
}

export interface AgentMetrics {
  averageResponseTime: number
  successRate: number // 0-1
  qualityScore: number // 0-100
  contributionValue: number // Calculated by routing formula
  tokensUsed: number
  costIncurred: number
  lastActive: number
}

// ============================================================================
// Discussion Bus Types (from TRANSCRIPT Section 5)
// ============================================================================

export interface AgentMessage {
  messageId: string
  agentId: string
  content: string
  timestamp: number
  round: number
  type: MessageType
  confidence?: number // 0-100
  evidenceRefs?: string[] // SHA-256 hashes of evidence
  challengedBy?: string[] // IDs of agents who challenged this
  parentId?: string // For threaded discussions
  metadata?: MessageMetadata
}

export interface MessageMetadata {
  tokensUsed?: number
  processingTimeMs?: number
  modelVersion?: string
  temperature?: number
  toolsUsed?: string[]
}

export type MessageType =
  | 'opinion'
  | 'critique'
  | 'question'
  | 'consensus'
  | 'fact'
  | 'claim'
  | 'challenge'
  | 'evidence'
  | 'concession'
  | 'synthesis'

export interface DiscussionRound {
  roundId: string
  roundNumber: number
  messages: AgentMessage[]
  summary: string
  consensusLevel: number // 0-1
  newInformationRate: number // How much new info vs repeated
  contradictionsFound: number
  coverageScore: number // How well covered all aspects
  dominantViewpoint?: string // If one view is dominating
  stalled: boolean // Is discussion making progress?
  actionItems: string[] // Decisions or actions from this round
}

export interface DiscussionBusState {
  isActive: boolean
  currentRound: number
  totalMessages: number
  stopPolicy: StopPolicy
  convergenceMetrics: ConvergenceMetrics
  participants: string[]
  turnOrder: string[] // Who speaks when
  currentSpeaker?: string
  interruptions: number // Times agents spoke out of turn
}

export interface StopPolicy {
  maxTurns?: number
  maxTimeMs?: number
  untilContextClear?: boolean
  untilDecisionReady?: boolean
  manualStop?: boolean
  untilConsensus?: number // Consensus threshold to stop
  untilExhaustion?: boolean // Until no new information emerges
}

export interface ConvergenceMetrics {
  modelCoverage: number // fraction of models participated
  evidenceSufficiency: number // verified supports / total claims
  stability: number // change rate between rounds (lower = more stable)
  decisionStability: number // how stable are decisions over time
  informationEntropy: number // Shannon entropy of information content
  agreementMatrix: number[][] // Pairwise agreement between agents
}

// ============================================================================
// Knowledge Graph Types (from TRANSCRIPT Section 4)
// ============================================================================

export interface ClaimNode {
  claimId: string
  text: string
  originModel: string
  originAgent: string
  confidence: number // 0-100
  status: ClaimStatus
  timestamp: number
  evidenceIds: string[]
  challengeIds: string[]
  supportingClaims: string[] // IDs of claims that support this
  contradictingClaims: string[] // IDs that contradict this
  domain?: string // What area this claim relates to
  tags?: string[]
  version: number // For tracking claim evolution
}

export type ClaimStatus =
  | 'HYPOTHESIS'
  | 'PLAUSIBLE'
  | 'VERIFIED'
  | 'CONTRADICTED'
  | 'REJECTED'
  | 'PENDING'
  | 'SUPERSEDED'
  | 'PARTIALLY_VERIFIED'

export interface EvidenceNode {
  evidenceId: string
  type: EvidenceType
  content: string
  sourceModel: string
  sourceAgent: string
  sourceType: 'agent' | 'external' | 'tool' | 'test' | 'human'
  verifiedBy: string[]
  timestamp: number
  hash: string // SHA-256
  strength: number // 0-1, how strong this evidence is
  reproducible?: boolean // Can this be reproduced?
  expiration?: number // Timestamp when this becomes stale
  relatedClaims: string[]
  metadata?: EvidenceMetadata
}

export interface EvidenceMetadata {
  testResults?: TestResultData
  benchmarkData?: BenchmarkData
  externalReference?: ExternalRef
  toolOutput?: ToolOutputData
}

export interface TestResultData {
  framework: string
  passed: boolean
  coverage?: number
  duration: number
  assertions: number
}

export interface BenchmarkData {
  benchmarkName: string
  score: number
  unit: string
  baseline?: number
  improvement?: number
}

export interface ExternalRef {
  url: string
  title: string
  author?: string
  date?: string
  credibility: number // 0-1
}

export interface ToolOutputData {
  toolName: string
  exitCode: number
  stdout: string
  stderr: string
  executionTime: number
}

export type EvidenceType =
  | 'CODE'
  | 'LOG'
  | 'TEST_RESULT'
  | 'BENCHMARK'
  | 'EXTERNAL_REF'
  | 'TOOL_OUTPUT'
  | 'MATHEMATICAL_PROOF'
  | 'EXPERT_JUDGMENT'
  | 'USER_FEEDBACK'
  | 'CODE_REVIEW'
  | 'SECURITY_SCAN'
  | 'PERFORMANCE_PROFILE'

export interface KnowledgeEdge {
  from: string // claim or evidence ID
  to: string // claim or evidence ID
  relation: EdgeRelation
  timestamp: number
  strength: number // 0-1
  sourceAgent: string
}

export type EdgeRelation =
  | 'supports'
  | 'contradicts'
  | 'derived_from'
  | 'challenges'
  | 'verified_by'
  | 'refines'
  | 'generalizes'
  | 'exemplifies'
  | 'addresses'
  | 'mitigates'

// ============================================================================
// Memory Fabric Types (from TRANSCRIPT Section 6)
// ============================================================================

export interface MemoryFabric {
  hot: HotContext
  warm: WarmMemory
  cold: ColdArchive
}

export interface HotContext {
  currentTask: string
  activeClaims: ClaimNode[]
  activeEvidence: EvidenceNode[]
  openConflicts: string[] // Claim IDs with conflicts
  userConstraints: string[]
  currentDecisions: string[]
  criticalUnknowns: string[]
  provenancePointers: Map<string, string> // Track where info came from
  conversationHistory: AgentMessage[]
  workingMemory: Map<string, any> // Scratch space for calculations
  contextWindow: ContextWindowUsage
  lastUpdated: number
}

export interface ContextWindowUsage {
  used: number
  total: number
  criticalThreshold: number // % above this is critical
  byCategory: Map<string, number> // Breakdown by category
}

export interface WarmMemory {
  sqlLookupEnabled: boolean
  vectorSearchEnabled: boolean
  ftsEnabled: boolean
  temporalRetrievalEnabled: boolean
  graphQueryEnabled: boolean
  fileRetrievalEnabled: boolean
  cacheSize: number
  retentionPeriod: number // ms
  indexingRules: IndexingRule[]
}

export interface IndexingRule {
  pattern: RegExp
  priority: number
  extractMetadata: boolean
  ttl?: number
}

export interface ColdArchive {
  runs: TelemetryRun[]
  agents: TelemetryAgent[]
  tasks: TelemetryTask[]
  prompts: TelemetryPrompt[]
  contexts: TelemetryContext[]
  messages: TelemetryMessage[]
  toolCalls: TelemetryToolCall[]
  outputs: TelemetryOutput[]
  errors: TelemetryError[]
  decisions: TelemetryDecision[]
  evidence: TelemetryEvidence[]
  costs: TelemetryCost[]
  timings: TelemetryTiming[]
  skills: TelemetrySkill[]
  audits: TelemetryAudit[]
  compressionStats: CompressionStats
}

export interface CompressionStats {
  originalSize: number
  compressedSize: number
  compressionRatio: number
  algorithm: string
  lastCompressed: number
}

// Telemetry types for cold storage
export interface TelemetryRun {
  runId: string
  startTime: number
  endTime: number
  mode: MADMode
  taskDescription: string
  outcome: 'success' | 'failure' | 'partial' | 'timeout'
  finalReportHash: string
}

export interface TelemetryAgent {
  agentId: string
  runId: string
  model: string
  provider: string
  messagesSent: number
  tokensUsed: number
  cost: number
  performanceScore: number
  errors: number
}

export interface TelemetryTask {
  taskId: string
  runId: string
  description: string
  status: string
  assignedTo: string
  startTime: number
  endTime: number
  resultHash?: string
}

export interface TelemetryPrompt {
  promptId: string
  runId: string
  template: string
  variables: Record<string, string>
  tokensUsed: number
  responseQuality: number
  timestamp: number
}

export interface TelemetryContext {
  contextId: string
  runId: string
  size: number
  hash: string
  components: string[]
  timestamp: number
}

export interface TelemetryMessage {
  messageId: string
  runId: string
  agentId: string
  round: number
  type: MessageType
  tokens: number
  timestamp: number
  hash: string
}

export interface TelemetryToolCall {
  callId: string
  runId: string
  agentId: string
  toolName: string
  arguments: Record<string, any>
  result: string
  success: boolean
  duration: number
  timestamp: number
}

export interface TelemetryOutput {
  outputId: string
  runId: string
  type: string
  content: string
  hash: string
  size: number
  timestamp: number
}

export interface TelemetryError {
  errorId: string
  runId: string
  agentId?: string
  type: string
  message: string
  stack?: string
  severity: 'fatal' | 'error' | 'warning' | 'info'
  recoverable: boolean
  timestamp: number
}

export interface TelemetryDecision {
  decisionId: string
  runId: string
  context: string
  decision: string
  rationale: string
  confidence: number
  participants: string[]
  timestamp: number
  hash: string
}

export interface TelemetryEvidence {
  evidenceId: string
  runId: string
  type: EvidenceType
  content: string
  hash: string
  verified: boolean
  timestamp: number
}

export interface TelemetryCost {
  costId: string
  runId: string
  category: 'input' | 'output' | 'cache' | 'tool'
  provider: string
  model: string
  tokens: number
  cost: number
  timestamp: number
}

export interface TelemetryTiming {
  timingId: string
  runId: string
  phase: string
  duration: number
  startTime: number
  endTime: number
  metadata?: Record<string, any>
}

export interface TelemetrySkill {
  skillId: string
  runId: string
  name: string
  version: string
  success: boolean
  duration: number
  inputs: string[]
  outputs: string[]
  timestamp: number
}

export interface TelemetryAudit {
  auditId: string
  runId: string
  auditor: string
  category: string
  findings: string[]
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  recommendations: string[]
  timestamp: number
  hash: string
}

// ============================================================================
// Verification Types (from TRANSCRIPT Section 10)
// ============================================================================

export interface VerificationConfig {
  level: VerificationLevel
  adversarialEnabled: boolean
  formalVerification: boolean
  humanApprovalRequired: boolean
  proofGateThreshold: number
  autoRemediate: boolean
  maxRetries: number
  timeout: number
}

export type VerificationLevel =
  | 'NORMAL'
  | 'STRICT'
  | 'ADVERSARIAL'
  | 'FORMAL_MATHEMATICAL'
  | 'PARANOID' // Maximum verification

export interface VerificationResult {
  verified: boolean
  confidence: number // 0-100
  evidencePool: EvidenceNode[]
  checksPerformed: VerificationCheck[]
  failures: VerificationFailure[]
  warnings: VerificationWarning[]
  timestamp: number
  duration: number
  verifierAgents: string[]
  summary: string
  nextSteps?: string[]
}

export interface VerificationCheck {
  checkId: string
  checkType: VerificationCheckType
  passed: boolean
  details: string
  evidenceRef?: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  duration: number
  retryCount: number
}

export type VerificationCheckType =
  | 'REPRODUCE'
  | 'UNIT_TEST'
  | 'INTEGRATION_TEST'
  | 'STATIC_ANALYSIS'
  | 'RUNTIME_CHECK'
  | 'BENCHMARK'
  | 'SECURITY_CHECK'
  | 'FORMAL_PROOF'
  | 'HUMAN_APPROVAL'
  | 'CROSS_VERIFICATION'
  | 'EDGE_CASE'
  | 'STRESS_TEST'
  | 'REGRESSION'
  | 'CONFORMANCE'
  | 'CONSISTENCY_CHECK'

export interface VerificationFailure {
  failureId: string
  checkType: VerificationCheckType
  severity: 'critical' | 'high' | 'medium' | 'low'
  description: string
  suggestedFix?: string
  affectedComponents?: string[]
  reproducingSteps?: string[]
  autoFixable: boolean
}

export interface VerificationWarning {
  warningId: string
  checkType: VerificationCheckType
  severity: 'info' | 'low'
  description: string
  suggestion?: string
}

// Verification Engine Layers (TRANSCRIPT Section 10)
export interface MicroVerificationLayer {
  name: 'micro'
  checks: VerificationCheckType[]
  timeout: number
  parallel: boolean
  focus: 'syntax' | 'logic' | 'formatting'
}

export interface GeneralVerificationLayer {
  name: 'general'
  checks: VerificationCheckType[]
  timeout: number
  parallel: boolean
  focus: 'functionality' | 'correctness' | 'performance'
  testSuites: string[]
}

export interface AdversarialVerificationLayer {
  name: 'adversarial'
  checks: VerificationCheckType[]
  timeout: number
  parallel: boolean
  focus: 'security' | 'edge-cases' | 'robustness'
  attackVectors: string[]
  redTeamAgents: string[]
  blueTeamAgents: string[]
}

// ============================================================================
// Gauntlet Loop Types (from TRANSCRIPT Section 10.2)
// ============================================================================

export interface GauntletConfig {
  enabled: boolean
  barSource: BarSource
  freezeHash: string
  maxRounds: number
  budget?: GauntletBudget
  stopConditions: GauntletStopConditions
  gradingPolicy: GradingPolicy
  marginalImprovementThreshold: number
}

export interface BarSource {
  type: 'url' | 'repo' | 'file' | 'test_suite' | 'benchmark' | 'specification'
  location: string
  description: string
  acquiredAt: number
  frozenAt?: number
  sha256?: string
  version?: string
  metadata?: Record<string, any>
}

export interface GauntletBudget {
  rounds?: number
  timeMs?: number
  tokens?: number
  cost?: number
  apiCalls?: number
}

export interface GauntletStopConditions {
  artifactWins: boolean
  marginalCollapseRounds: number
  budgetExhausted: boolean
  userOverride: boolean
  perfectScoreAchieved: boolean
  diminishingReturnsTriggered: boolean
}

export interface GradingPolicy {
  strictness: 'lenient' | 'standard' | 'strict' | 'brutal'
  criteria: GradingCriteria[]
  weights: Record<string, number>
  curveScores: boolean
  allowPartialCredit: boolean
}

export interface GradingCriteria {
  criterionId: string
  name: string
  description: string
  weight: number
  scorer: 'automated' | 'human' | 'hybrid'
  threshold: number // Minimum to pass
}

export interface GauntletResult {
  passed: boolean
  roundsCompleted: number
  finalVerdict: 'BAR_WINS' | 'ARTIFACT_WINS' | 'TIE' | 'ABORTED'
  roundLog: GauntletRound[]
  gapsIdentified: string[]
  regressionPassed: boolean
  finalScores: GauntletScores
  recommendations: string[]
  qualityTrend: number[] // Score progression
}

export interface GauntletRound {
  roundNumber: number
  builderOutput: string
  criticVerdict: 'bar' | 'artifact' | 'tie'
  scores: Partial<Record<string, number>>
  biggestGap?: string
  improvementNoted: boolean
  marginalImprovement: number // Improvement over last round
  feedback: string
  timeTaken: number
}

export interface GauntletScores {
  overall: number
  functionality: number
  quality: number
  performance: number
  security: number
  correctness: number
  completeness: number
}

// ============================================================================
// Production Sweep Types (from TRANSCRIPT Section 11)
// ============================================================================

export interface ProductionSweepConfig {
  enabled: boolean
  agents: ProductionAgentConfig[]
  severityThreshold: 'blocking' | 'critical' | 'all'
  autoRemediate: boolean
  maxSweeps: number
  parallel: boolean
  timeout: number
  reportingFormat: 'detailed' | 'summary' | 'minimal'
}

export interface ProductionAgentConfig {
  id: string
  role: 'quality_qa' | 'code_linter' | 'adversarial' | 'ux_review' | 'security_audit' | 'performance_test'
  focusAreas: string[]
  strictness: number // 0-1
  tools: string[]
  expertise: string[]
}

export interface ProductionFinding {
  findingId: string
  agentId: string
  sweepId: string
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  category: string
  description: string
  location?: string
  suggestedFix?: string
  dependencies?: string[]
  falsePositiveRisk: number // 0-1
  effortToFix: 'trivial' | 'easy' | 'moderate' | 'hard' | 'very_hard'
  blocking: boolean
  timestamp: number
}

export interface ProductionGateResult {
  status: 'READY' | 'READY_WITH_RISKS' | 'NOT_READY'
  criticalBlockers: number
  highBlockers: number
  mediumIssues: number
  lowIssues: number
  testStatus: 'PASS' | 'FAIL' | 'PENDING' | 'SKIPPED'
  securityStatus: 'PASS' | 'FAIL' | 'PENDING' | 'SKIPPED'
  performanceStatus: 'PASS' | 'FAIL' | 'PENDING' | 'SKIPPED'
  buildStatus: 'PASS' | 'FAIL' | 'PENDING' | 'SKIPPED'
  observabilityStatus: 'PASS' | 'FAIL' | 'PENDING' | 'SKIPPED'
  documentationStatus: 'PASS' | 'FAIL' | 'PENDING' | 'SKIPPED'
  knownRisksReviewed: boolean
  importantClaimsVerified: boolean
  findings: ProductionFinding[]
  remediationTasks: RemediationTask[]
  score: number // 0-100 readiness score
  timestamp: number
  nextReviewDate?: number
}

export interface RemediationTask {
  taskId: string
  findingId: string
  description: string
  priority: number
  assignedTo?: string
  dependencies: string[]
  status: 'pending' | 'in_progress' | 'completed' | 'blocked' | 'deferred'
  estimatedEffort: string
  deadline?: number
  created: number
  completedAt?: number
}

// ============================================================================
// GOD Runtime Types (from TRANSCRIPT Section 2)
// ============================================================================

export interface GODRuntimeConfig {
  mode: MADMode
  providers: ProviderCredential[]
  discussionPolicy: DiscussionPolicy
  verificationPolicy: VerificationConfig
  budgetPolicy: BudgetPolicy
  spawnPolicy: SpawnPolicy
  skillPolicy: SkillPolicy
  toolPolicy: ToolSecurityPolicy
  memoryPolicy: MemoryPolicy
  gauntletConfig?: GauntletConfig
  productionSweepConfig?: ProductionSweepConfig
  coreRules?: CoreRule[]
  costIntelligence?: CostIntelligenceConfig
  adaptiveRouting?: AdaptiveRoutingConfig
}

export type MADMode = 'PLAN' | 'BUILD' | 'DEBUG'

export interface DiscussionPolicy {
  timeLimit?: number
  turnLimit?: number
  untilContextClear?: boolean
  untilDecisionReady?: boolean
  manualStopAllowed: boolean
  allowInterruptions: boolean
  enforceRoleAdherence: boolean
  requireEvidenceForClaims: boolean
  devilAdvocateMandatory: boolean
  synthesisRequired: boolean
}

export interface BudgetPolicy {
  tokenBudget?: number
  timeBudget?: number // ms
  costBudget?: number
  concurrencyBudget?: number
  perAgentTokenLimit?: number
  overflowBehavior: 'fail' | 'warn' | 'degrade' | 'switch_provider'
  trackingGranularity: 'coarse' | 'fine' | 'realtime'
}

export interface SpawnPolicy {
  maxAgents: number
  maxTreeDepth: number
  maxChildrenPerAgent: number
  maxParallel: number
  cancellationEnabled: boolean
  autoSpawnOnComplexity: boolean
  complexityThreshold: number // Spawn sub-agents above this
  mergePolicy: 'vote' | 'synthesize' | 'all' | 'best'
}

export interface SkillPolicy {
  globalRegistry: boolean
  githubDiscovery: boolean
  lazyLoading: boolean
  maxActiveSkills: number
  trustRemoteSkills: boolean
  skillValidation: boolean
  sandboxExecution: boolean
}

export interface ToolSecurityPolicy {
  filesystemAccess: boolean
  terminalAccess: boolean
  networkAccess: boolean
  dangerousSystemCalls: boolean
  sandboxEnabled: boolean
  allowedTools: string[]
  blockedTools: string[]
  requireApprovalFor: string[]
  auditLog: boolean
}

export interface MemoryPolicy {
  hotContextSize: number // tokens
  warmRetentionHours: number
  coldCompressionEnabled: boolean
  autoArchive: boolean
  provenanceTracking: boolean
  forgetfulnessCurve: 'none' | 'linear' | 'exponential' | 'custom'
  privacyFilter: boolean
}

// ============================================================================
// Core Rules (from TRANSCRIPT Section 9)
// ============================================================================

export interface CoreRule {
  ruleId: string
  name: string
  description: string
  severity: 'mandatory' | 'strong' | 'guideline'
  category: RuleCategory
  enforcement: 'hard' | 'soft' | 'manual'
  examples: string[]
  antiPatterns: string[]
}

export type RuleCategory =
  | 'truth_seeking'
  | 'collaboration'
  | 'quality'
  | 'efficiency'
  | 'accountability'
  | 'innovation'

// Predefined 15 Core Rules from TRANSCRIPT
export const MAD_CORE_RULES: CoreRule[] = [
  {
    ruleId: 'CR001',
    name: 'Consensus ≠ Correctness',
    description: 'Majority opinion can be wrong. Always verify with evidence.',
    severity: 'mandatory',
    category: 'truth_seeking',
    enforcement: 'hard',
    examples: ['Historical scientific consenses that were wrong'],
    antiPatterns: ['Accepting majority without question'],
  },
  {
    ruleId: 'CR002',
    name: 'Confidence Must Be Earned',
    description: 'High confidence requires strong evidence. Low evidence = low confidence.',
    severity: 'mandatory',
    category: 'truth_seeking',
    enforcement: 'hard',
    examples: ['Requiring benchmarks for performance claims'],
    antiPatterns: ['Trusting confident-sounding but unsupported claims'],
  },
  {
    ruleId: 'CR003',
    name: 'Challenge Assumptions',
    description: 'Explicitly identify and challenge underlying assumptions.',
    severity: 'mandatory',
    category: 'truth_seeking',
    enforcement: 'hard',
    examples: ['Listing assumptions before analysis'],
    antiPatterns: ['Building on unstated assumptions'],
  },
  {
    ruleId: 'CR004',
    name: 'Diverse Perspectives Required',
    description: 'Multiple viewpoints improve outcomes. Never rely on single source.',
    severity: 'mandatory',
    category: 'collaboration',
    enforcement: 'hard',
    examples: ['Getting security, UX, and performance reviews'],
    antiPatterns: ['Single-agent decision making'],
  },
  {
    ruleId: 'CR005',
    name: 'Evidence Over Authority',
    description: 'Arguments stand on evidence, not credentials or seniority.',
    severity: 'mandatory',
    category: 'truth_seeking',
    enforcement: 'hard',
    examples: ['Evaluating code quality, not who wrote it'],
    antiPatterns: ['Deferring to "senior" models without review'],
  },
  {
    ruleId: 'CR006',
    name: 'Embrace Uncertainty',
    description: 'Acknowledge what you don\'t know. Uncertainty is better than false certainty.',
    severity: 'strong',
    category: 'truth_seeking',
    enforcement: 'soft',
    examples: ['Expressing confidence ranges'],
    antiPatterns: ['Overconfident predictions without data'],
  },
  {
    ruleId: 'CR007',
    name: 'Iterative Refinement',
    description: 'First drafts are rarely optimal. Iterate toward excellence.',
    severity: 'strong',
    category: 'quality',
    enforcement: 'soft',
    examples: ['Multiple revision cycles before finalizing'],
    antiPatterns: ['Accepting first solution as final'],
  },
  {
    ruleId: 'CR008',
    name: 'Cost-Aware Reasoning',
    description: 'Match reasoning depth to problem importance. Don\'t over-analyze trivial issues.',
    severity: 'strong',
    category: 'efficiency',
    enforcement: 'soft',
    examples: ['Quick decisions for simple fixes, deep analysis for architecture'],
    antiPatterns: ['Spending $10 of compute on $1 decisions'],
  },
  {
    ruleId: 'CR009',
    name: 'Never Stop Early',
    description: 'Continue until genuine completion, not just apparent success.',
    severity: 'mandatory',
    category: 'quality',
    enforcement: 'hard',
    examples: ['Running full test suites, not stopping at first pass'],
    antiPatterns: ['Stopping after first successful attempt'],
  },
  {
    ruleId: 'CR010',
    name: 'Constructive Conflict',
    description: 'Disagreement improves outcomes when focused on ideas, not egos.',
    severity: 'strong',
    category: 'collaboration',
    enforcement: 'soft',
    examples: ['Challenging code, not coders'],
    antiPatterns: ['Personal attacks or dismissiveness'],
  },
  {
    ruleId: 'CR011',
    name: 'Provenance Tracking',
    description: 'Track where information comes from. Source matters.',
    severity: 'strong',
    category: 'accountability',
    enforcement: 'soft',
    examples: ['Citing sources for claims'],
    antiPatterns: ['Unsourced assertions treated as fact'],
  },
  {
    ruleId: 'CR012',
    name: 'Reproducibility Matters',
    description: 'Results must be independently verifiable.',
    severity: 'mandatory',
    category: 'quality',
    enforcement: 'hard',
    examples: ['Providing reproduction steps for bugs'],
    antiPatterns: ['One-off solutions that can\'t be reproduced'],
  },
  {
    ruleId: 'CR013',
    name: 'Adaptive Specialization',
    description: 'Leverage each model\'s strengths. No universal best model.',
    severity: 'strong',
    category: 'efficiency',
    enforcement: 'soft',
    examples: ['Using specialized models for specific tasks'],
    antiPatterns: ['Using GPT-4 for simple regex tasks'],
  },
  {
    ruleId: 'CR014',
    name: 'Security By Default',
    description: 'Assume threats exist. Verify, don\'t trust.',
    severity: 'mandatory',
    category: 'security',
    enforcement: 'hard',
    examples: ['Input validation, principle of least privilege'],
    antiPatterns: ['Trusting user input without sanitization'],
  },
  {
    ruleId: 'CR015',
    name: 'Continuous Learning',
    description: 'Update beliefs based on new evidence. Avoid confirmation bias.',
    severity: 'strong',
    category: 'innovation',
    enforcement: 'soft',
    examples: ['Changing approach when evidence contradicts'],
    antiPatterns: ['Doubling down on failing approaches'],
  },
]

// ============================================================================
// Cost Intelligence Types (from TRANSCRIPT Section 8)
// ============================================================================

export interface CostIntelligenceConfig {
  enabled: boolean
  strategy: CostStrategy
  explorationBudget: number // % of budget for cheap exploration
  selectiveThreshold: number // Confidence below this triggers escalation
  expensiveThreshold: number // Impact above this justifies expensive verification
  realTimeTracking: boolean
  optimizationGoal: 'minimize_cost' | 'maximize_quality' | 'balanced'
}

export type CostStrategy =
  | 'conservative' // Minimize cost, accept lower quality
  | 'balanced'     // Optimal cost-quality tradeoff
  | 'aggressive'  // Maximize quality, accept higher cost
  | 'adaptive'    // Dynamically adjust based on task

export interface CostTier {
  tier: 'exploration' | 'selective' | 'verification'
  models: string[] // Model IDs suitable for this tier
  maxCostPerCall: number
  expectedQuality: number // 0-100
  useCases: string[]
}

export interface CostEstimate {
  estimatedTokens: number
  estimatedCost: number
  confidence: number // 0-100 in estimate accuracy
  breakdown: CostBreakdown[]
  recommendedTier: CostTier['tier']
  alternatives: AlternativeCost[]
}

export interface CostBreakdown {
  category: string
  tokens: number
  cost: number
  percentage: number
}

export interface AlternativeCost {
  model: string
  estimatedCost: number
  expectedQualityDelta: number
  tradeoffs: string[]
}

// ============================================================================
// Adaptive Routing Types (from TRANSCRIPT Section 7)
// ============================================================================

export interface AdaptiveRoutingConfig {
  enabled: boolean
  formula: RoutingFormulaWeights
  historyWindow: number // Number of past tasks to consider
  diversityBonus: number // Bonus for selecting different models
  correlationPenalty: number // Penalty for similar past selections
  explorationRate: number // Rate of trying new options (epsilon-greedy)
  learningRate: number // How fast to update weights
}

export interface RoutingFormulaWeights {
  eviWeight: number        // Expected Value of Information
  performanceWeight: number // Historical Performance
  diversityWeight: number   // Diversity Benefit
  evidenceWeight: number    // Evidence Quality
  latencyWeight: number     // Latency penalty
  costWeight: number        // Cost penalty
  correlationWeight: number // Correlation risk penalty
}

export interface RoutingDecision {
  taskId: string
  selectedAgent: string
  selectionReason: RoutingReason
  score: number
  alternatives: AlternativeRoute[]
  confidence: number // 0-100 in routing decision
  expectedOutcome: ExpectedOutcome
  costEstimate: CostEstimate
  timestamp: number
}

export interface RoutingReason {
  primary: string
  factors: RoutingFactor[]
  ruleApplied?: string
}

export interface RoutingFactor {
  factor: string
  value: number
  weight: number
  contribution: number
}

export interface AlternativeRoute {
  agentId: string
  score: number
  reason: string
  tradeoffs: string[]
}

export interface ExpectedOutcome {
  quality: number // 0-100
  latency: number // ms
  cost: number
  confidence: number // 0-100
  risks: string[]
}

// ============================================================================
// Result Types
// ============================================================================

export interface MADResult {
  success: boolean
  mode: MADMode
  consensus?: string
  discussions: DiscussionRound[]
  participatingAgents: string[]
  totalRounds: number
  duration: number
  finalDecision: string
  verificationResult?: VerificationResult
  gauntletResult?: GauntletResult
  productionResult?: ProductionGateResult
  knowledgeGraph: {
    claims: ClaimNode[]
    evidence: EvidenceNode[]
    edges: KnowledgeEdge[]
  }
  telemetry: MADTelemetry
  coreRuleViolations: CoreRuleViolation[]
  costSummary: CostSummary
  recommendations: string[]
}

export interface CoreRuleViolation {
  ruleId: string
  ruleName: string
  severity: 'mandatory' | 'strong' | 'guideline'
  description: string
  violatingAgent?: string
  context: string
  resolved: boolean
}

export interface CostSummary {
  totalTokens: number
  totalCost: number
  byProvider: Record<string, number>
  byAgent: Record<string, number>
  byTier: Record<string, number>
  budgetRemaining: number
  efficiency: number // Value achieved per dollar
}

export interface MADTelemetry {
  startTime: number
  endTime: number
  totalTokensUsed: number
  totalCost: number
  agentPerformance: Map<string, AgentPerformance>
  routingDecisions: RoutingDecision[]
  verificationAttempts: number
  gauntletRounds: number
  productionSweeps: number
}

export interface AgentPerformance {
  agentId: string
  messagesSent: number
  averageResponseTime: number
  qualityScore: number
  contributionValue: number
  rulesFollowed: number
  rulesViolated: number
  costIncurred: number
  tokensUsed: number
  uptime: number // % of time active vs waiting/error
}

// ============================================================================
// API Interface Types (from TRANSCRIPT Section 15)
// ============================================================================

export interface GodRuntime {
  initializeTask(taskSpec: TaskSpecification): Promise<void>
  decomposeTask(): Promise<TaskGraph>
  routeTask(taskId: string): Promise<ModelAssignment[]>
  conductDiscussion(taskPrompt: string): Promise<DiscussionRound[]>
  recordClaim(claim: ClaimNode): void
  addEvidence(evidence: EvidenceNode): void
  verify(claims: string[]): Promise<VerificationResult>
  runGauntlet(artifact: string): Promise<GauntletResult>
  runProductionSweep(): Promise<ProductionGateResult>
  checkProgress(): VerificationStatus
  cancelRun(reason: string): void
  finalize(): FinalReport
  getState(): GODState
  getTelemetry(): MADTelemetry
}

export interface TaskSpecification {
  id: string
  description: string
  mode: MADMode
  requirements: string[]
  constraints: string[]
  priority: 'low' | 'medium' | 'high' | 'critical'
  budget?: BudgetPolicy
  barSource?: BarSource
  context?: string
  expectedOutcome?: string
  stakeholders?: string[]
}

export interface TaskGraph {
  nodes: TaskNode[]
  edges: TaskEdge[]
  rootTaskId: string
}

export interface TaskNode {
  taskId: string
  description: string
  status: 'pending' | 'in_progress' | 'completed' | 'blocked' | 'failed' | 'skipped'
  dependencies: string[]
  assignedAgent?: string
  complexity: number // 1-10
  estimatedTokens: number
  actualTokens?: number
  output?: string
  verificationStatus?: 'pending' | 'passed' | 'failed'
}

export interface TaskEdge {
  from: string
  to: string
  type: 'depends_on' | 'blocks' | 'enables' | 'refines'
  strength: number // 0-1, how strong this dependency is
}

export interface ModelAssignment {
  modelInstance: ActiveAgent
  role: string
  taskId: string
  assignmentReason: string
  expectedDuration: number
  priority: number
}

export type VerificationStatus =
  | 'IN_PROGRESS'
  | 'EVIDENCE_GATHERING'
  | 'DISCUSSION_ACTIVE'
  | 'VERIFICATION_COMPLETE'
  | 'GAUNTLET_ACTIVE'
  | 'PRODUCTION_SWEEP'
  | 'READY_FOR_EXECUTION'
  | 'CANCELLED'
  | 'FAILED'
  | 'COMPLETED'

export interface FinalReport {
  runId: string
  task: TaskSpecification
  result: MADResult
  recommendations: string[]
  lessonsLearned: string[]
  nextSteps: string[]
  artifacts: Artifact[]
  signOff: SignOff[]
  timestamp: number
  hash: string // SHA-256 of report contents
}

export interface Artifact {
  artifactId: string
  type: 'code' | 'document' | 'config' | 'test' | 'output'
  name: string
  location: string
  hash: string
  size: number
  verified: boolean
}

export interface SignOff {
  role: string
  agentId: string
  approved: boolean
  comments: string
  timestamp: number
}

// ============================================================================
// Internal State Types
// ============================================================================

export interface GODState {
  currentTask: TaskSpecification | null
  status: VerificationStatus
  phase: MADPhase
  activeProviders: string[]
  initialized: boolean
  error?: Error
  checkpoints: Checkpoint[]
}

export type MADPhase =
  | 'idle'
  | 'initializing'
  | 'observation'
  | 'decomposition'
  | 'routing'
  | 'discussion'
  | 'verification'
  | 'gauntlet'
  | 'production_sweep'
  | 'finalizing'
  | 'complete'
  | 'error'
  | 'cancelled'

export interface Checkpoint {
  phase: MADPhase
  timestamp: number
  stateSnapshot: string // Serialized state
  hash: string
  restorable: boolean
}

// ============================================================================
// Export all types
// ============================================================================

export type {
  CfIdentity,
  ProviderCredential,
  ModelConfig,
  RateLimit,
  CostStructure,
  AgentConfig,
  ActiveAgent,
  AgentPersonality,
  AgentConstraints,
  AgentMetrics,
  AgentMessage,
  MessageMetadata,
  DiscussionRound,
  DiscussionBusState,
  StopPolicy,
  ConvergenceMetrics,
  ClaimNode,
  EvidenceNode,
  EvidenceMetadata,
  TestResultData,
  BenchmarkData,
  ExternalRef,
  ToolOutputData,
  KnowledgeEdge,
  MemoryFabric,
  HotContext,
  ContextWindowUsage,
  WarmMemory,
  IndexingRule,
  ColdArchive,
  TelemetryRun,
  TelemetryAgent,
  TelemetryTask,
  TelemetryPrompt,
  TelemetryContext,
  TelemetryMessage,
  TelemetryToolCall,
  TelemetryOutput,
  TelemetryError,
  TelemetryDecision,
  TelemetryEvidence,
  TelemetryCost,
  TelemetryTiming,
  TelemetrySkill,
  TelemetryAudit,
  CompressionStats,
  VerificationConfig,
  VerificationResult,
  VerificationCheck,
  VerificationFailure,
  VerificationWarning,
  MicroVerificationLayer,
  GeneralVerificationLayer,
  AdversarialVerificationLayer,
  GauntletConfig,
  BarSource,
  GauntletBudget,
  GauntletStopConditions,
  GradingPolicy,
  GradingCriteria,
  GauntletResult,
  GauntletRound,
  GauntletScores,
  ProductionSweepConfig,
  ProductionAgentConfig,
  ProductionFinding,
  ProductionGateResult,
  RemediationTask,
  GODRuntimeConfig,
  DiscussionPolicy,
  BudgetPolicy,
  SpawnPolicy,
  SkillPolicy,
  ToolSecurityPolicy,
  MemoryPolicy,
  CoreRule,
  CostIntelligenceConfig,
  CostStrategy,
  CostTier,
  CostEstimate,
  CostBreakdown,
  AlternativeCost,
  AdaptiveRoutingConfig,
  RoutingFormulaWeights,
  RoutingDecision,
  RoutingReason,
  RoutingFactor,
  AlternativeRoute,
  ExpectedOutcome,
  MADResult,
  CoreRuleViolation,
  CostSummary,
  MADTelemetry,
  AgentPerformance,
  GodRuntime,
  TaskSpecification,
  TaskGraph,
  TaskNode,
  TaskEdge,
  ModelAssignment,
  FinalReport,
  Artifact,
  SignOff,
  GODState,
  Checkpoint,
}

export type {
  ModelCapability,
  AgentRole,
  MessageType,
  ClaimStatus,
  EvidenceType,
  EdgeRelation,
  VerificationLevel,
  VerificationCheckType,
  MADMode,
  RuleCategory,
  VerificationStatus as GODVerificationStatus,
  MADPhase,
}

// ============================================================================
// Additional Types for Advanced Implementation (v2.0.0-advanced)
// ============================================================================

/** Updated GOD State for state machine */
export type GODStateV2 =
  | 'IDLE'
  | 'INITIALIZING'
  | 'READY'
  | 'PLANNING'
  | 'BUILDING'
  | 'DEBUGGING'
  | 'DISCUSSING'
  | 'ARBITRATING'
  | 'VERIFYING'
  | 'GAUNTLET'
  | 'PRODUCTION_SWEEP'
  | 'FINALIZING'
  | 'COMPLETE'
  | 'ERROR'
  | 'SHUTTING_DOWN'

/** Updated Stop Policy for discussion coordinator */
export type StopPolicyV2 =
  | 'fixed-rounds'
  | 'context-clear'
  | 'consensus'
  | 'budget-exhausted'

/** Warm Memory Entry (for Memory Fabric) */
export interface WarmMemoryEntry {
  id: string
  contentHash: string
  content: string
  type: string
  metadata?: any
  storedAt: number
  lastAccessed: number
  accessCount: number
  tags: string[]
  sizeBytes: number
}

/** Hot Context Item */
export interface HotContextItem {
  id: string
  content: string
  type: string
  metadata?: any
  addedAt: number
  accessCount: number
}

/** Updated Hot Context */
export interface HotContextV2 {
  activeItems: HotContextItem[]
  currentTaskId: string
  contextWindow: Record<string, any>
  maxSize: number
  lastAccessed: number
}

/** Updated Warm Memory Stats */
export interface WarmMemoryStats {
  totalEntries: number
  totalSizeBytes: number
  indexedTerms: number
}

/** Updated Cold Archive Entry */
export interface ColdArchiveEntry {
  contentHash: string
  originalId: string
  content: string
  compressed: boolean
  archivedAt: number
  reason: string
  sizeBytes: number
}

/** Updated Cold Archive Stats */
export interface ColdArchiveStats {
  totalEntries: number
  totalSizeBytes: number
}

/** Updated Memory Fabric Interface */
export interface MemoryFabricV2 {
  hot: HotContextV2
  warmStats: WarmMemoryStats
  coldStats: ColdArchiveStats
}

/** Knowledge Graph for Discussion Bus */
export interface KnowledgeGraph {
  claims: ClaimNode[]
  evidence: EvidenceNode[]
  edges: KnowledgeEdge[]
}

/** Skill Manifest for Skill Manager */
export interface SkillManifest {
  id: string
  name: string
  version: string
  category: string
  description: string
  capabilities: string[]
  dependencies?: string[]
  tags?: string[]
}

/** Audit Log Entry */
export interface AuditLogEntry {
  id: string
  type: string
  details: string
  timestamp: number
  severity?: 'info' | 'warning' | 'error' | 'critical'
}

/** Replay Session */
export interface ReplaySession {
  id: string
  checkpointId: string
  startedAt: number
  status: 'running' | 'completed' | 'stopped'
  actionsReplayed: number
  currentState: any
  modifications: Map<string, any>
  lastActionAt?: number
  completedAt?: number
}

/** Telemetry Event */
export interface TelemetryEvent {
  type: string
  subtype?: string
  agentId?: string
  taskId?: string
  metricName?: string
  metricValue?: number
  details?: any
  timestamp: number
}

/** Core Rule Violation with round info */
export interface CoreRuleViolationV2 extends CoreRuleViolation {
  round?: number
  remediation: string
}

/** Gauntlet Round Result */
export interface GauntletRoundV2 {
  roundNumber: number
  artifactHash: string
  barHash: string
  criticDecision: 'artifact' | 'bar' | 'tie'
  criticFeedback: {
    winner: 'artifact' | 'bar' | 'tie'
    feedback: string
    biggestGap: string
  }
  conformancePassed: boolean
  conformanceIssues: string[]
  improvements?: number
  duration: number
  regressionChecked: { passed: boolean; regressions: string[] }
}

/** Production Finding with agent attribution */
export interface ProductionFindingV2 extends ProductionFinding {
  agent: string
}

/** Routing Decision with alternatives */
export interface RoutingDecisionV2 {
  modelId: string
  providerId: string
  confidence: number
  reasoning: string
  alternatives: Array<{ modelId: string; confidence: number }>
  costEstimate: number
  latencyEstimate: number
}

/** Cost Summary V2 with phase breakdown */
export interface CostSummaryV2 {
  totalCost: number
  budgetAllocated: number
  budgetRemaining: number
  utilization: number
  entries: number
  byAgent: Record<string, number>
  byModel: Record<string, number>
  byPhase: Record<string, number>
  forecast: { estimated: number; confidence: 'high' | 'medium' | 'low' }
}

/** Discussion Bus State V2 with participants and violations */
export interface DiscussionBusStateV2 {
  isActive: boolean
  currentRound: number
  totalRounds: number
  participants: Array<{ agentId: string; role: string; hasSpoken: boolean }>
  knowledgeGraph: KnowledgeGraph
  convergenceHistory: ConvergenceMetrics[]
  ruleViolations: CoreRuleViolationV2[]
}

/** Final Report V2 with all advanced features */
export interface FinalReportV2 {
  taskId: string
  status: 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'TIMEOUT' | 'BUDGET_EXHAUSTED'
  result: {
    output: string
    confidence: number
    sources: Array<{ id: string; content: string }>
  }
  discussion?: {
    rounds: number
    finalState: DiscussionBusStateV2
    claims: ClaimNode[]
    evidence: EvidenceNode[]
  }
  verification?: VerificationResult
  gauntlet?: GauntletResult
  productionGate?: ProductionGateResult
  cost: CostSummaryV2
  telemetry: {
    totalTime: number
    agentUtilization: number
    modelUsage: Array<{ model: string; cost: number }>
    memoryUsage: ReturnType<MemoryFabricManager['getStats']>
  }
  timestamp: number
}

/** Type imports for god-runtime components */
export type MemoryFabricManager = import('../mad/core/god-runtime').MemoryFabricManager
export type StateManager = import('../mad/core/god-runtime').StateManager
export type ModelRouter = import('../mad/core/god-runtime').ModelRouter
export type Scheduler = import('../mad/core/god-runtime').Scheduler
export type DiscussionCoordinator = import('../mad/core/god-runtime').DiscussionCoordinator
export type Arbiter = import('../mad/core/god-runtime').Arbiter
export type VerificationEngine = import('../mad/core/god-runtime').VerificationEngine
export type PolicyAgentTreeManager = import('../mad/core/god-runtime').PolicyAgentTreeManager
export type SkillManager = import('../mad/core/god-runtime').SkillManager
export type TelemetryManager = import('../mad/core/god-runtime').TelemetryManager
export type AuditReplayManager = import('../mad/core/god-runtime').AuditReplayManager
export type CostIntelligenceManager = import('../mad/core/god-runtime').CostIntelligenceManager
export type GauntletLoop = import('../mad/core/god-runtime').GauntletLoop
export type ProductionReadinessSweep = import('../mad/core/god-runtime').ProductionReadinessSweep

// Default configurations
export const VERIFICATION_LEVELS = {
  MICRO: 'micro' as const,
  GENERAL: 'general' as const,
  ADVERSARIAL: 'adversarial' as const,
}

export const GAUNTLET_DEFAULT_CONFIG: GauntletConfig = {
  enabled: true,
  maxRounds: 20,
  budget: {
    maxRounds: 20,
    maxTimeMs: 300000, // 5 minutes
    maxCost: 50,
  },
  stopConditions: {
    barMet: true,
    marginalCollapseRounds: 3,
    userStop: true,
    regressionFailure: true,
  },
  requireConformance: true,
  requireRegressionCheck: true,
  freezeBar: true,
}

export const PRODUCTION_SWEEP_DEFAULT_CONFIG: ProductionSweepConfig = {
  enabled: true,
  agents: {
    qualityQA: { enabled: true, severityThreshold: 'warning' },
    linter: { enabled: true, checkTODOs: true, checkDebugCode: true },
    stressTest: { enabled: true, testEdgeCases: true, testRaceConditions: false },
    uxReview: { enabled: true, simulateWorkflows: true },
  },
  maxSweeps: 5,
  blockingSeverities: ['error', 'critical'],
  autoRemediate: false,
}

export const STOP_POLICIES_V2: Record<StopPolicyV2, string> = {
  'fixed-rounds': 'Stop after a fixed number of rounds',
  'context-clear': 'Stop when context is clear and stable',
  'consensus': 'Stop when consensus threshold is reached',
  'budget-exhausted': 'Continue until budget is exhausted (external control)',
}

export const CORE_RULES: Array<{
  id: string
  name: string
  description: string
}> = [
  { id: 'RULE_1', name: 'Consensus ≠ Correctness', description: 'High agreement does not guarantee truth' },
  { id: 'RULE_2', name: 'Confidence Must Be Earned', description: 'Confidence must be proportional to evidence' },
  { id: 'RULE_3', name: 'Independent Reasoning First', description: 'Form opinions before seeing others' },
  { id: 'RULE_4', name: 'Evidence Required for Claims', description: 'Factual claims need supporting evidence' },
  { id: 'RULE_5', name: 'Challenge Aggressively', description: 'Actively seek flaws in reasoning' },
  { id: 'RULE_6', name: 'Counterexample Search', description: 'Search for disconfirming evidence' },
  { id: 'RULE_7', name: 'No Fake Claims', description: 'Never invent results or citations' },
  { id: 'RULE_8', name: 'Explicit Uncertainty', description: 'State when uncertain' },
  { id: 'RULE_9', name: 'Fresh Critics Required', description: 'Use unbiased agents for verification' },
  { id: 'RULE_10', name: 'Observe Anomalies', description: 'Flag unusual patterns' },
  { id: 'RULE_11', name: 'User Premise Checking', description: 'Verify assumptions' },
  { id: 'RULE_12', name: 'Preserve Knowledge', description: 'Record decisions and outcomes' },
  { id: 'RULE_13', name: 'Load Only What Is Needed', description: 'Minimize context to relevant info' },
  { id: 'RULE_14', name: 'Own Failures', description: 'Acknowledge mistakes openly' },
  { id: 'RULE_15', name: 'Never Confuse Confidence with Truth', description: 'High confidence ≠ correctness' },
]

export const MAD_PHASES_V2: Record<MADPhase, string> = {
  'idle': 'System idle, waiting for task',
  'initializing': 'Setting up runtime',
  'observation': 'Observing initial conditions',
  'decomposition': 'Breaking down task',
  'routing': 'Assigning to models',
  'discussion': 'Multi-agent discussion active',
  'verification': 'Verifying outputs',
  'gauntlet': 'Running quality gauntlet',
  'production_sweep': 'Production readiness sweep',
  'finalizing': 'Generating final report',
  'complete': 'Task complete',
  'error': 'Error state',
  'cancelled': 'Task cancelled',
}

export const GOD_STATES_V2: Record<GODStateV2, string> = {
  'IDLE': 'Runtime idle',
  'INITIALIZING': 'Initializing components',
  'READY': 'Ready for tasks',
  'PLANNING': 'In planning mode',
  'BUILDING': 'In building mode',
  'DEBUGGING': 'In debugging mode',
  'DISCUSSING': 'Discussion in progress',
  'ARBITRATING': 'Arbitrating conflicts',
  'VERIFYING': 'Verification in progress',
  'GAUNTLET': 'Gauntlet loop running',
  'PRODUCTION_SWEEP': 'Production sweep running',
  'FINALIZING': 'Finalizing results',
  'COMPLETE': 'Task complete',
  'ERROR': 'Error state',
  'SHUTTING_DOWN': 'Shutting down',
}
