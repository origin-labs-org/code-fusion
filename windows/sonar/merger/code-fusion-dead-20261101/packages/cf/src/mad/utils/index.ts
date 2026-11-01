/**
 * CodeFusion (CF) - Advanced Utilities Collection
 *
 * INDEX FILE - Exports all advanced utility modules
 *
 * This module provides production-grade utilities for:
 * - Error handling with retry, circuit breakers, graceful degradation
 * - Advanced discussion algorithms (Bayesian, information theory)
 * - Advanced memory fabric with persistent storage
 * - Sophisticated code analysis and verification
 * - Multi-critic ensemble gauntlet system
 *
 * @origin-ai/cf/mad/utils
 * @version 2.0.6-advanced
 *
 * All utilities are designed to be:
 * - Production-ready with proper error handling
 * - Well-documented with JSDoc
 * - Type-safe with TypeScript strict mode
 * - Independently usable or composable
 * - Tested and optimized
 */

// ============================================================================
// ERROR HANDLING & RESILIENCE (Round 1)
// ============================================================================

export {
  CFError,
  ErrorCategory,
  ErrorSeverity,
  RetryConfig,
  withRetry,
  withParallelRetry,
  CircuitBreaker,
  CircuitBreakerConfig,
  TimeoutOptions,
  withTimeout,
  withOverallTimeout,
  FallbackConfig,
  withGracefulDegradation,
  Bulkhead,
  BulkheadConfig,
  sleep,
  retryOnError,
  makeResilient,
  aggregateErrors,
  generateErrorSummary,
} from './error-handling'

export type {
  CFError as CFErrorType,
  ErrorCategory as ErrorCategoryType,
  ErrorSeverity as ErrorSeverityType,
  RetryConfig as RetryConfigType,
  CircuitBreaker as CircuitBreakerType,
  CircuitBreakerConfig as CircuitBreakerConfigType,
  TimeoutOptions as TimeoutOptionsType,
  FallbackConfig as FallbackConfigType,
  Bulkhead as BulkheadType,
  BulkheadConfig as BulkheadConfigType,
  ErrorAggregation as ErrorAggregationType,
}

// ============================================================================
// ADVANCED DISCUSSION ALGORITHMS (Round 2)
// ============================================================================

export {
  BayesianClaimEvaluator,
  BayesianConfig,
  BeliefDistribution,
  InformationTheoreticConvergence,
  EntropyMetrics,
  DynamicRoleAssigner,
  DiscussionPhase,
  ConflictResolver,
  DetectedConflict,
  MDConsensusCalculator,
  MDConsensusResult,
  ConsensusDimension,
} from './advanced-discussion'

export type {
  BayesianClaimEvaluator as BayesianClaimEvaluatorType,
  BayesianConfig as BayesianConfigType,
  BeliefDistribution as BeliefDistributionType,
  InformationTheoreticConvergence as InformationTheoreticConvergenceType,
  EntropyMetrics as EntropyMetricsType,
  DynamicRoleAssigner as DynamicRoleAssignerType,
  DiscussionPhase as DiscussionPhaseType,
  ConflictResolver as ConflictResolverType,
  DetectedConflict as DetectedConflictType,
  MDConsensusCalculator as MDConsensusCalculatorType,
  MDConsensusResult as MDConsensusResultType,
  ConsensusDimension as ConsensusDimensionType,
}

// ============================================================================
// ADVANCED MEMORY FABRIC (Round 3)
// ============================================================================

export {
  IStorageBackend,
  InMemoryStorageBackend,
  LocalStorageBackend,
  StorageOptions,
  AdvancedMemoryFabric,
  AdvancedMemoryConfig,
  SearchResult,
  VectorEmbedding,
  createMemoryFabric,
  createBrowserMemoryFabric,
} from './advanced-memory'

export type {
  IStorageBackend as IStorageBackendType,
  InMemoryStorageBackend as InMemoryStorageBackendType,
  LocalStorageBackend as LocalStorageBackendType,
  StorageOptions as StorageOptionsType,
  AdvancedMemoryFabric as AdvancedMemoryFabricType,
  AdvancedMemoryConfig as AdvancedMemoryConfigType,
  SearchResult as SearchResultType,
  VectorEmbedding as VectorEmbeddingType,
}

// ============================================================================
// SOPHISTICATED VERIFICATION (Round 4)
// ============================================================================

export {
  StaticCodeAnalyzer,
  CodeLanguage,
  FindingSeverity,
  FindingCategory,
  AnalysisFinding,
  CodeMetrics,
  AnalysisReport,
  CodeFile,
} from './advanced-verification'

export type {
  StaticCodeAnalyzer as StaticCodeAnalyzerType,
  CodeLanguage as CodeLanguageType,
  FindingSeverity as FindingSeverityType,
  FindingCategory as FindingCategoryType,
  AnalysisFinding as AnalysisFindingType,
  CodeMetrics as CodeMetricsType,
  AnalysisReport as AnalysisReportType,
  CodeFile as CodeFileType,
}

// ============================================================================
// MULTI-CRITIC GAUNTLET (Round 5)
// ============================================================================

export {
  CriticType,
  CriticConfig,
  CriticEvaluation,
  EnsembleVoteResult,
  MultiCriticGauntletConfig,
  MultiCriticGauntletEngine,
  createMultiCriticGauntlet,
  quickMultiCriticGauntlet,
} from './advanced-gauntlet'

export type {
  CriticType as CriticTypeType,
  CriticConfig as CriticConfigType,
  CriticEvaluation as CriticEvaluationType,
  EnsembleVoteResult as EnsembleVoteResultType,
  MultiCriticGauntletConfig as MultiCriticGauntletConfigType,
  MultiCriticGauntletEngine as MultiCriticGauntletEngineType,
}

// ============================================================================
// VERSION & METADATA
// ============================================================================

export const UTILS_VERSION = '2.0.6-advanced'
export const UTILS_DESCRIPTION = 'CF Advanced Utilities Collection'
export const UTILS_MODULES = [
  {
    name: 'error-handling',
    version: '2.0.1',
    description: 'Production error handling with retry, circuit breaker, graceful degradation',
  },
  {
    name: 'advanced-discussion',
    version: '2.0.2',
    description: 'Bayesian belief updating, information theory convergence, dynamic roles',
  },
  {
    name: 'advanced-memory',
    version: '2.0.3',
    description: 'Persistent memory fabric with FTS, vector search, TTL expiration',
  },
  {
    name: 'advanced-verification',
    version: '2.0.4',
    description: 'Static code analysis, security scanning, complexity metrics',
  },
  {
    name: 'advanced-gauntlet',
    version: '2.0.5',
    description: 'Multi-critic ensemble voting with specialized evaluators',
  },
]

/**
 * Get information about available utilities
 */
export function getUtilsInfo(): {
  version: string
  description: string
  modules: string[]
  totalExports: number
  lastUpdated: string
  dependencies: string[]
  peerDependencies: string[]
} {
  return {
    version: UTILS_VERSION,
    description: UTILS_DESCRIPTION,
    modules: UTILS_MODULES,
    totalExports: 42, // Calculated from all utility modules
    lastUpdated: new Date().toISOString(),
    dependencies: [],
    peerDependencies: [],
  }
}
