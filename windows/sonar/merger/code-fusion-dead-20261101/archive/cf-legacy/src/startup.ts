/**
 * Startup initialization for XHE Popular Skills
 * Handles plugin bootstrapping and model behavior configuration
 */

import { invariant } from './invariant'

export interface StartupConfig {
  enableIWIN?: boolean
  enableMAD?: boolean
  enableBYOK?: boolean
  modelBehavior?: ModelBehaviorConfig
  aggressionLevel?: 'polite' | 'balanced' | 'firm' | 'aggressive'
}

export interface ModelBehaviorConfig {
  requireAccountability: boolean
  allowConstructiveCriticism: boolean
  directErrorFixing: boolean
  balancedAggression: boolean
  autoFixErrors: boolean
}

const DEFAULT_BEHAVIOR: ModelBehaviorConfig = {
  requireAccountability: true,
  allowConstructiveCriticism: true,
  directErrorFixing: true,
  balancedAggression: true,
  autoFixErrors: true
}

export async function startup(config: StartupConfig = {}): Promise<void> {
  console.log('🚀 XHE Popular Skills starting up...')
  
  invariant(typeof config === 'object', 'Config must be object')
  
  const behavior = { ...DEFAULT_BEHAVIOR, ...config.modelBehavior }
  
  applyModelBehaviorRules(behavior)
  
  if (config.enableIWIN) {
    console.log('♾️ I-WIN (Infinity Win Loop) enabled')
    initIWINMode()
  }
  
  if (config.enableMAD) {
    console.log('🏛️ M.A.D (Multi-Agent Discussion) enabled')
    initMADMode()
  }
  
  if (config.enableBYOK) {
    console.log('🔑 BYOK (Bring Your Own Key) system ready')
    initBYOKSystem()
  }
  
  console.log('✅ XHE Popular Skills initialized successfully!')
}

function applyModelBehaviorRules(behavior: ModelBehaviorConfig): void {
  if (behavior.requireAccountability) {
    console.log('📋 Rule: Models MUST take accountability for errors')
    console.log('   ❌ "Not my fault" → ✅ "My mistake, fixing now"')
  }
  
  if (behavior.allowConstructiveCriticism) {
    console.log('💬 Rule: Constructive criticism allowed (balanced)')
    console.log('   ✅ "This code is problematic because..." allowed')
    console.log('   ❌ Personal attacks NOT allowed')
  }
  
  if (behavior.directErrorFixing) {
    console.log('🔧 Rule: Fix errors directly, no excuses')
    console.log('   ✅ "Here\'s the fix: [code]" required')
  }
  
  if (behavior.balancedAggression) {
    console.log('⚖️ Rule: Balanced aggression (firm but fair)')
    console.log('   ✅ "This approach is wrong, do X instead"')
    console.log('   ❌ Too polite/Too aggressive blocked')
  }
  
  if (behavior.autoFixErrors) {
    console.log('🤖 Rule: Auto-fix errors when detected')
  }
}

function initIWINMode(): void {
  console.log('   → Infinity Win Loop: Never give up mode active')
}

function initMADMode(): void {
  console.log('   → Multi-Agent Discussion: Multiple models collaborate')
}

function initBYOKSystem(): void {
  console.log('   → Bring Your Own Key: Support any API provider')
}

export { DEFAULT_BEHAVIOR }
