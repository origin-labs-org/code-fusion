/**
 * CodeFusion (CF) - MAD (Multi-Agent Deployment) System
 *
 * Main entry point for the Multi-Agent Deployment architecture.
 * Implements the complete GOD Runtime specification from TRANSCRIPT.md.
 *
 * FULL ADVANCED IMPLEMENTATION (v2.0.0-advanced)
 *
 * This module exports:
 * - Core GOD Runtime with all 12 components fully implemented
 * - Advanced MAD Engine with real LLM API integration
 * - Basic MAD Engine for simulation/testing mode
 * - Complete type system for all components
 * - Factory functions and convenience methods
 *
 * @origin-ai/cf/mad
 * @version 2.0.0-advanced
 *
 * Also known as:
 * - CodeFusion / CodeFusion
 * - CodeFusion
 *
 * Fork of: CodeFusion
 */

// ============================================================================
// CORE EXPORTS - GOD Runtime (Full Advanced Implementation)
// ============================================================================

export { GodRuntime, GODRuntime, default as GodRuntimeDefault } from './core/god-runtime'
export type { GodRuntime } from './types'

// Re-export all GOD Runtime component classes for advanced usage
export {
  StateManager,
  ModelRouter,
  Scheduler,
  DiscussionCoordinator,
  Arbiter,
  VerificationEngine,
  PolicyAgentTreeManager,
  SkillManager,
  MemoryFabricManager,
  TelemetryManager,
  AuditReplayManager,
  CostIntelligenceManager,
  GauntletLoop,
  ProductionReadinessSweep,
} from './core/god-runtime'

// Re-export advanced systems
export {
  createGODRuntime,
  cfExecute as godXheExecute,
  enforceCoreRules,
} from './core/god-runtime'

// ============================================================================
// ADVANCED EXPORTS - Advanced MAD Engine (Real API Integration)
// ============================================================================

export {
  AdvancedMADEngine,
  LLMAPIClient,
  createAdvancedMADEngine,
  cfAdvExecute,
} from './mad'

export type {
  MAgentResponse,
  LLMProviderConfig,
  AdvancedMADConfig,
  DiscussionTurn,
  MADSessionResult,
} from './mad'

// ============================================================================
// BASIC EXPORTS - Basic MAD Engine (Simulation Mode)
// ============================================================================

export { MADEngine } from './mad'

// ============================================================================
// TYPE EXPORTS - Complete Type System
// ============================================================================

// Core Identity
export type { CfIdentity } from './types'
export { CF_IDENTITY } from './types'

// Provider & Model Types
export type {
  ProviderCredential,
  ModelConfig,
  RateLimit,
  CostStructure,
  ModelCapability,
} from './types'

// Agent Types
export type {
  AgentConfig,
  ActiveAgent,
  AgentRole,
  AgentPersonality,
  AgentConstraints,
  AgentMetrics,
  MAgentConfig,
} from './types'

// Discussion System
export type {
  AgentMessage,
  MessageType,
  MessageMetadata,
  DiscussionRound,
  DiscussionBusState,
  StopPolicy,
  ConvergenceMetrics,
} from './types'

// Knowledge Graph
export type {
  ClaimNode,
  ClaimStatus,
  EvidenceNode,
  EvidenceType,
  EvidenceMetadata,
  TestResultData,
  BenchmarkData,
  ExternalRef,
  ToolOutputData,
  KnowledgeEdge,
  EdgeRelation,
} from './types'

// Memory System
export type {
  MemoryFabric,
  HotContext,
  ContextWindowUsage,
  WarmMemory,
  IndexingRule,
  ColdArchive,
  CompressionStats,
} from './types'

// V2 Advanced Memory Types
export type {
  WarmMemoryEntry,
  HotContextItem,
  HotContextV2,
  WarmMemoryStats,
  ColdArchiveEntry,
  ColdArchiveStats,
  MemoryFabricV2,
} from './types'

// Verification System
export type {
  VerificationConfig,
  VerificationLevel,
  VerificationCheckType,
  VerificationResult,
  VerificationCheck,
  VerificationFailure,
  VerificationWarning,
  MicroVerificationLayer,
  GeneralVerificationLayer,
  AdversarialVerificationLayer,
} from './types'

// Gauntlet Quality System
export type {
  GauntletConfig,
  BarSource,
  GauntletBudget,
  GauntletStopConditions,
  GradingPolicy,
  GradingCriteria,
  GauntletResult,
  GauntletRound,
  GauntletScores,
} from './types'

// V2 Advanced Gauntlet Types
export type { GauntletRoundV2 } from './types'

// Production Readiness
export type {
  ProductionSweepConfig,
  ProductionAgentConfig,
  ProductionFinding,
  ProductionGateResult,
  RemediationTask,
} from './types'

// V2 Advanced Production Types
export type { ProductionFindingV2 } from './types'

// GOD Runtime Configuration
export type {
  GODRuntimeConfig,
  MADMode,
  DiscussionPolicy,
  BudgetPolicy,
  SpawnPolicy,
  SkillPolicy,
  ToolSecurityPolicy,
  MemoryPolicy,
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
} from './types'

// V2 Advanced Routing & Cost Types
export type { RoutingDecisionV2, CostSummaryV2 } from './types'

// Results & API
export type {
  MADResult,
  MADTelemetry,
  AgentPerformance,
  TaskSpecification,
  TaskGraph,
  TaskNode,
  TaskEdge,
  ModelAssignment,
  VerificationStatus,
  FinalReport,
  Artifact,
  SignOff,
} from './types'

// V2 Advanced Result Types
export type { FinalReportV2 } from './types'

// Internal State Types
export type {
  GODState,
  MADPhase,
  Checkpoint,
  GODVerificationStatus,
} from './types'

// V2 Advanced State Types
export type { GODStateV2, StopPolicyV2 } from './types'

// Additional Advanced Types
export type {
  KnowledgeGraph,
  SkillManifest,
  AuditLogEntry,
  ReplaySession,
  TelemetryEvent,
  CoreRuleViolation,
  CoreRuleViolationV2,
  DiscussionBusStateV2,
} from './types'

// Core Rules & Configurations
export {
  VERIFICATION_LEVELS,
  GAUNTLET_DEFAULT_CONFIG,
  PRODUCTION_SWEEP_DEFAULT_CONFIG,
  STOP_POLICIES_V2,
  CORE_RULES,
  MAD_PHASES_V2,
  GOD_STATES_V2,
} from './types'

// Telemetry Types (for cold storage)
export type {
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
} from './types'

// Rule System
export type {
  CoreRule,
  RuleCategory,
  MADCoreRule,
} from './types'

// ============================================================================
// CONSTANTS
// ============================================================================

export { CF_IDENTITY } from './types'

// ============================================================================
// FACTORY FUNCTIONS & CONVENIENCE EXPORTS
// ============================================================================

/**
 * Create a new CF/GOD Runtime instance
 */
export function createCF(config?: Partial<import('./types').GODRuntimeConfig>): import('./core/god-runtime').GodRuntime {
  const { GodRuntime } = require('./core/god-runtime')
  return new GodRuntime(config || {})
}

/**
 * Quick execute helper - runs a complete MAD session
 */
export async function cfExecute(
  task: string,
  mode: MADMode = 'PLAN',
  options?: Partial<import('./types').GODRuntimeConfig>,
): Promise<FinalReport> {
  const runtime = createCF({ mode, ...options })

  await runtime.initialize()

  return runtime.executeTask({
    id: `task-${Date.now()}`,
    description: task,
    mode,
    requirements: [],
    constraints: [],
    priority: 'medium',
  })
}

/**
 * Create advanced MAD engine with real API support
 */
export function createAdvancedCF(config?: Partial<import('./mad').AdvancedMADConfig>): import('./mad').AdvancedMADEngine {
  const { AdvancedMADEngine } = require('./mad')
  return new AdvancedMADEngine(config || {})
}

/**
 * Quick execute with real LLM APIs
 */
export async function cfAdvancedExecute(
  task: string,
  options?: {
    mode?: MADMode
    providers?: import('./mad').LLMProviderConfig[]
    maxRounds?: number
    qualityBar?: import('./types').BarSource
  },
): Promise<import('./mad').MADSessionResult> {
  const { cfAdvExecute } = require('./mad')
  return cfAdvExecute(task, options)
}

// ============================================================================
// VERSION & METADATA
// ============================================================================

export const MAD_VERSION = '2.0.0-advanced'
export const MAD_DESCRIPTION = 'CodeFusion (CF) - Multi-Agent Deployment System with full GOD Runtime implementation'
export const MAD_STATUS = 'production-ready'

/**
 * Get information about the MAD system
 */
export function getMADInfo(): {
  version: string
  description: string
  status: string
  features: string[]
  coreComponents: number
  rulesEnforced: number
  supportedProviders: string[]
} {
  return {
    version: MAD_VERSION,
    description: MAD_DESCRIPTION,
    status: MAD_STATUS,
    features: [
      'Multi-model coordination (8+ heterogeneous instances)',
      'Plan/Build/Debug modes with distinct workflows',
      'Adversarial discussion with devil\'s advocate',
      'Evidence-gated claims and knowledge graph',
      '3-level verification (Micro/General/Adversarial)',
      'Gauntlet quality loop with "Never stop early"',
      'Production readiness sweep (4 audit agents)',
      '15 MAD Core Rules enforcement',
      'Cost intelligence and adaptive routing',
      'HOT/WARM/COLD memory fabric',
      'SHA-256 content addressing',
      'Real LLM API integration (OpenAI, Anthropic, Google, DeepSeek)',
      'Audit trail and replay capabilities',
      'Full telemetry and observability',
    ],
    coreComponents: 12,
    rulesEnforced: 15,
    supportedProviders: ['openai', 'anthropic', 'google', 'deepseek', 'local', 'custom'],
  }
}
