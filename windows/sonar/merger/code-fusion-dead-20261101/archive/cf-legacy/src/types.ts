/**
 * Type definitions for XHE Popular Skills
 */

export interface SkillCommand {
  name: string
  description: string
  handler: CommandHandler
  category: SkillCategory
  examples?: string[]
  aliases?: string[]
}

export type CommandHandler = (ctx: CommandContext, args?: string[]) => Promise<void>

export interface CommandContext {
  input: string
  cwd: string
  agent: any
  session: any
  commands: any
}

export type SkillCategory = 
  | 'code-review' | 'testing' | 'git' | 'debugging' | 'security'
  | 'refactoring' | 'quality' | 'ai-features' | 'frontend' | 'general'

export interface FuzzyMatchResult {
  command: SkillCommand
  score: number
  matched: boolean
}

export interface TokenStats {
  baseTokens: number
  loadedSkills: string[]
  savedTokens: number
  efficiency: number
}

// MAD Types
export interface MADConfig {
  mode: 'plan' | 'build' | 'debug'
  agents: MAgentConfig[]
  timeout?: number
  maxRounds?: number
  balanceLevel: 'quick' | 'balanced' | 'thorough' | 'zen'
}

export interface MAgentConfig {
  id: string; name: string; provider: string; model: string
  role: AgentRole; specialization: string[]; apiKeyRef: string
}

export type AgentRole = 'builder' | 'critic' | 'security' | 'ux' | 'optimizer'
  | 'documentation' | 'debugger' | 'tester' | 'architect' | 'devils_advocate'

// I-WIN Types
export interface IWINConfig {
  enabled: boolean
  maxIterations?: number
  persistenceFile?: string
  strategy: IWINStrategy
  onProgress?: (progress: IWINProgress) => void
}

export type IWINStrategy = 'persistent' | 'adaptive' | 'aggressive' | 'collaborative'

export interface IWINProgress {
  iteration: number
  status: 'running' | 'stuck' | 'progressing' | 'complete' | 'paused'
  currentApproach: string
  attempts: string[]
  nextStrategy?: string
}

// BYOK Types
export interface BYOKConfig {
  keys: APIKeyConfig[]
  defaultProvider?: string
  budget?: BudgetConfig
  fallbackChain?: string[]
}

export interface APIKeyConfig {
  id: string; provider: string; apiKey: string; model: string
  tier: 'primary' | 'secondary' | 'fallback'
  specialization: string[]
  costPerToken?: { input: number; output: number }
  baseUrl?: string
}

export interface BudgetConfig {
  daily?: number; monthly?: number; alertThreshold?: number
}
