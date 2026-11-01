/**
 * XHE Enhanced - Main Entry Point
 * 
 * Complete integration of:
 * - I-WIN (Infinity Win Loop) - Never give up system
 * - M.A.D (Multi-Agent Discussion) - GOD AGENT coordinating sub-agents
 * - BYOK (Bring Your Own Key) - Multi-provider key manager with multi-key support
 * - 25+ Slash Commands (Claude Code style)
 * - Fuzzy Autocomplete System
 * - Token Optimization (Lazy Loading)
 * - Model Behavior Invariants (No excuses, balanced aggression)
 * - Web UI Components
 * 
 * @module @origin-labs-ai/xhe-enhanced
 */

// Import core subsystems
import { invariant, assertModelAccountability, assertBalancedAggression } from './invariant'
import { startup, DEFAULT_BEHAVIOR } from './startup'

// Import major feature systems
export { IWINEngine, createIWIN, iwinExecute } from './iwin'
export type { IWINTask, IWINTaskContext, IWINResult, IWINStats, Approach } from './iwin'

export { MADEngine, createMAD, madDiscuss } from './mad'
export type { MADResult } from './mad'

export { BYOKEngine, createBYOK } from './byok'
export type { KeyInfo, KeyHealthResult, BudgetStatus, UsageAnalytics, ExportedBYOKConfig } from './byok'

// Import utilities
import { initFuzzyAutocomplete, findMatches } from './fuzzy-autocomplete'
import { initTokenOptimizer, loadSkill, getTokenStats } from './token-optimizer'
import { registerCommands } from './commands'

// Re-export types
export type {
  SkillCommand,
  CommandContext,
  SkillCategory,
  FuzzyMatchResult,
  TokenStats,
  MADConfig,
  MAgentConfig,
  AgentRole,
  IWINConfig,
  IWINStrategy,
  IWINProgress,
  BYOKConfig,
  APIKeyConfig,
  BudgetConfig
} from './types'

// Re-export invariants
export { invariant, assertModelAccountability, assertBalancedAggression }
export { startup, DEFAULT_BEHAVIOR }

// ============================================================================
// Plugin Metadata
// ============================================================================

export const name = 'xhe-enhanced'
export const inject = ['commands', 'skills']

// ============================================================================
// Version & Metadata
// ============================================================================

export const VERSION = '2.0.0'
export const DESCRIPTION = 'DSH Enhanced: I-WIN, M.A.D, BYOK, 25+ commands, fuzzy autocomplete, token optimization'

// ============================================================================
// Main Setup Function
// ============================================================================

export interface DSHEnhancedConfig {
  enableIWIN?: boolean
  enableMAD?: boolean
  enableBYOK?: boolean
  enableCommands?: boolean
  enableAutocomplete?: boolean
  enableTokenOptimization?: boolean
  modelBehavior?: import('./startup').ModelBehaviorConfig
}

export async function setupDSHEnhanced(config: DSHEnhancedConfig = {}): Promise<void> {
  console.log('╔═══════════════════════════════════════════════════╗')
  console.log('║     🚀 XHE ENHANCED INITIALIZING                 ║')
  console.log('║     I-WIN | M.A.D | BYOK | COMMANDS             ║')
  console.log('╚═══════════════════════════════════════════════════╝')
  
  // Initialize model behavior rules first
  await startup({
    enableIWIN: config.enableIWIN,
    enableMAD: config.enableMAD,
    enableBYOK: config.enableBYOK,
    modelBehavior: config.modelBehavior
  })

  // Initialize optional features
  if (config.enableCommands !== false) {
    console.log('\n📜 Registering slash commands...')
    registerCommands({} as any) // Context would be injected by Cordis
  }

  if (config.enableAutocomplete !== false) {
    console.log('🔍 Initializing fuzzy autocomplete...')
    initFuzzyAutocomplete({})
  }

  if (config.enableTokenOptimization !== false) {
    console.log('⚡ Enabling token optimization...')
    initTokenOptimizer({})
  }

  console.log('\n✅ XHE Enhanced initialized successfully!')
  console.log(`   Version: ${VERSION}`)
  console.log(`   Features: I-WIN (${config.enableIWIN !== false ? 'ON' : 'OFF'}), ` +
              `M.A.D (${config.enableMAD !== false ? 'ON' : 'OFF'}), ` +
              `BYOK (${config.enableBYOK !== false ? 'ON' : 'OFF'})`)
}

// ============================================================================
// Quick Start Functions
// ============================================================================

/**
 * Quick start I-WIN for a task
 */
export async function iwinTask<T>(
  taskDescription: string,
  executeFn: () => Promise<T>
): Promise<T> {
  const { iwinExecute } = await import('./iwin')
  const result = await iwinExecute(taskDescription, async () => executeFn())
  
  if (!result.success) {
    throw result.error ?? new Error('I-WIN failed')
  }
  
  return result.result!
}

/**
 * Quick start M.A.D discussion
 */
export async function madTask(
  task: string,
  mode: 'plan' | 'build' | 'debug' = 'plan'
): Promise<string> {
  const { madDiscuss } = await import('./mad')
  const result = await madDiscuss(task, mode)
  return result.finalDecision
}

/**
 * Quick start BYOK with default configuration
 */
export function setupBYOK(): import('./byok').BYOKEngine {
  // Dynamic import to avoid circular dependency issues
  return import('./byok').then(({ createBYOK }) => 
    createBYOK({
      budget: { daily: 50, monthly: 500 },
      fallbackChain: ['openai', 'anthropic', 'google']
    })
  ) as any
}

// ============================================================================
// Utility Exports
// ============================================================================

export { findMatches, initFuzzyAutocomplete }
export { loadSkill, getTokenStats, initTokenOptimizer }
export { registerCommands }

// Command handlers for direct use
export {
  reviewHandler,
  testHandler,
  commitHandler,
  debugHandler,
  securityHandler,
  refactorHandler,
  gauntletHandler,
  iwinHandler,
  madHandler,
  byokHandler,
  helpHandler
} from './commands'

// Default export
export default {
  name,
  VERSION,
  DESCRIPTION,
  setup: setupDSHEnhanced,
  iwin: { engine: () => import('./iwin'), task: iwinTask },
  mad: { engine: () => import('./mad'), task: madTask },
  byok: { engine: () => import('./byok'), setup: setupBYOK }
}
