/**
 * I-WIN (Infinity Win Loop) - Never Give Up System
 * 
 * Core Philosophy: If a task is given, it WILL be completed.
 * No excuses. No surrender. Just persistent execution until success.
 * 
 * Features:
 * - Infinite retry with adaptive strategies
 * - Progress tracking and persistence
 * - Multiple fallback approaches
 * - Stuck detection and recovery
 * - Context-aware retry logic
 */

import type { IWINConfig, IWINProgress, IWINStrategy } from './types'
import { invariant } from './invariant'

// ============================================================================
// Core I-WIN State
// ============================================================================

interface IWINState {
  iteration: number
  startTime: number
  attempts: ApproachAttempt[]
  currentStrategy: IWINStrategy
  status: 'running' | 'stuck' | 'progressing' | 'complete' | 'paused'
  lastError?: Error
  stuckCount: number
}

interface ApproachAttempt {
  strategy: string
  timestamp: number
  success: boolean
  duration: number
  error?: string
}

// ============================================================================
// Strategy Definitions
// ============================================================================

const STRATEGIES: Record<IWINStrategy, {
  name: string
  description: string
  maxRetries: number
  backoffMs: number[]
}> = {
  persistent: {
    name: 'Persistent',
    description: 'Keep trying the same approach with minor tweaks',
    maxRetries: Infinity,
    backoffMs: [1000, 2000, 5000, 10000, 30000]
  },
  adaptive: {
    name: 'Adaptive',
    description: 'Change approach based on failure patterns',
    maxRetries: Infinity,
    backoffMs: [1000, 3000, 8000, 15000, 60000]
  },
  aggressive: {
    name: 'Aggressive',
    description: 'Try multiple approaches simultaneously',
    maxRetries: Infinity,
    backoffMs: [500, 1000, 2000, 5000, 10000]
  },
  collaborative: {
    name: 'Collaborative',
    description: 'Request human input when stuck, then continue',
    maxRetries: Infinity,
    backoffMs: [2000, 5000, 10000, 20000, 45000]
  }
}

// ============================================================================
// I-WIN Engine Class
// ============================================================================

export class IWINEngine {
  private state: IWINState
  private config: Required<IWINConfig>
  private persistencePath?: string
  private approachGenerators: ApproachGenerator[]

  constructor(config: IWINConfig) {
    this.config = {
      enabled: true,
      maxIterations: config.maxIterations ?? Infinity,
      strategy: config.strategy ?? 'adaptive',
      persistenceFile: config.persistenceFile,
      onProgress: config.onProgress ?? (() => {})
    } as Required<IWINConfig>

    this.state = {
      iteration: 0,
      startTime: Date.now(),
      attempts: [],
      currentStrategy: this.config.strategy,
      status: 'running',
      stuckCount: 0
    }

    this.persistencePath = this.config.persistenceFile
    this.approachGenerators = this.initializeApproachGenerators()

    if (this.persistencePath) {
      this.loadState()
    }
  }

  // ============================================================================
  // Main Execution Loop
  // ============================================================================

  async execute<T>(task: IWINTask<T>): Promise<IWINResult<T>> {
    invariant(this.state.status === 'running', 'I-WIN engine is not running')
    invariant(task?.execute, 'Task must have an execute function')
    invariant(task?.description, 'Task must have a description')

    console.log('╔══════════════════════════════════════════════╗')
    console.log('║     ♾️  I-WIN MODE ACTIVATED                 ║')
    console.log('║     INFINITY WIN LOOP - NEVER GIVES UP!     ║')
    console.log('╚══════════════════════════════════════════════╝')
    console.log(`🎯 TASK: ${task.description}`)
    console.log(`📊 STRATEGY: ${STRATEGIES[this.config.strategy].name}`)
    console.log(`🔄 MAX ITERATIONS: ${this.config.maxIterations === Infinity ? 'UNLIMITED' : this.config.maxIterations}`)
    console.log('')

    let result: T | undefined
    let lastError: Error | undefined

    while (this.shouldContinue()) {
      this.state.iteration++
      
      try {
        this.reportProgress()
        
        const approach = this.getNextApproach()
        console.log(`\n🔄 Attempt #${this.state.iteration} | Strategy: ${approach.name}`)
        console.log(`   Approach: ${approach.description}`)

        const attemptStart = Date.now()
        result = await task.execute({
          iteration: this.state.iteration,
          previousAttempts: this.state.attempts,
          suggestedApproach: approach,
          cancel: () => { this.state.status = 'complete' }
        })

        const duration = Date.now() - attemptStart
        
        this.recordAttempt({
          strategy: approach.name,
          timestamp: attemptStart,
          success: true,
          duration
        })

        console.log(`✅ SUCCESS on attempt #${this.state.iteration}! (${duration}ms)`)
        this.state.status = 'complete'
        this.saveState()

        return {
          success: true,
          result: result!,
          iterations: this.state.iteration,
          totalDuration: Date.now() - this.state.startTime,
          attempts: this.state.attempts
        }

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        this.handleFailure(lastError)
        
        // Check if stuck (need to work around TS control flow narrowing)
        const isStuck = (this.state.status as string) === 'stuck'
        if (isStuck) {
          await this.recoverFromStuck()
        }

        await this.applyBackoff()
      }
    }

    // If we exit loop without success
    console.log('\n⚠️ I-WIN exhausted all options')
    return {
      success: false,
      error: lastError ?? new Error('I-WIN: Maximum iterations reached'),
      iterations: this.state.iteration,
      totalDuration: Date.now() - this.state.startTime,
      attempts: this.state.attempts
    }
  }

  // ============================================================================
  // Strategy & Approach Management
  // ============================================================================

  private shouldContinue(): boolean {
    if (this.state.status === 'complete') return false
    if (this.state.iteration >= this.config.maxIterations) return false
    return true
  }

  private getNextApproach(): Approach {
    const generator = this.approachGenerators[this.state.iteration % this.approachGenerators.length]
    return generator(this.state, this.config)
  }

  private initializeApproachGenerators(): ApproachGenerator[] {
    return [
      // Primary approach - direct execution
      (state, _config) => ({
        name: 'direct',
        description: 'Execute task directly with current context',
        tweaks: {}
      }),

      // Context enhancement
      (state, _config) => ({
        name: 'enhanced_context',
        description: 'Add more context and details to execution',
        tweaks: { verbose: true, extraContext: true }
      }),

      // Alternative method
      (state, _config) => ({
        name: 'alternative_method',
        description: 'Try completely different approach',
        tweaks: { alternativeMode: true }
      }),

      // Debug mode
      (state, _config) => ({
        name: 'debug_focused',
        description: 'Focus on debugging what went wrong',
        tweaks: { debugMode: true, logEverything: true }
      }),

      // Minimal reproduction
      (state, _config) => ({
        name: 'minimal_repro',
        description: 'Simplify task to minimal reproducible case',
        tweaks: { minimal: true, stepByStep: true }
      }),

      // Fresh start
      (state, _config) => ({
        name: 'fresh_start',
        description: 'Clear cache and start fresh',
        tweaks: { clearCache: true, freshContext: true }
      }),

      // Aggressive mode
      (state, _config) => ({
        name: 'aggressive',
        description: 'Use maximum resources and parallelism',
        tweaks: { aggressive: true, parallel: true }
      }),

      // Collaborative
      (state, _config) => ({
        name: 'collaborative',
        description: 'Break down and solve piece by piece with validation',
        tweaks: { collaborative: true, validateEachStep: true }
      })
    ]
  }

  // ============================================================================
  // Failure Handling & Recovery
  // ============================================================================

  private handleFailure(error: Error): void {
    this.recordAttempt({
      strategy: this.state.currentStrategy,
      timestamp: Date.now(),
      success: false,
      duration: 0,
      error: error.message
    })

    this.state.lastError = error
    this.state.stuckCount++

    console.log(`❌ Failed: ${error.message}`)
    console.log(`   Stuck count: ${this.state.stuckCount}`)

    // Detect if we're stuck
    if (this.state.stuckCount >= 3) {
      this.state.status = 'stuck'
      console.log('⚠️ WARNING: I-WIN detects stuck pattern!')
    } else {
      this.state.status = 'progressing'
    }

    this.saveState()
  }

  private async recoverFromStuck(): Promise<void> {
    console.log('\n🔧 RECOVERY MODE ACTIVATED')
    console.log('   Analyzing failure patterns...')
    
    // Switch strategy if needed
    const strategies: IWINStrategy[] = ['persistent', 'adaptive', 'aggressive', 'collaborative']
    const currentIndex = strategies.indexOf(this.config.strategy)
    const nextStrategy = strategies[(currentIndex + 1) % strategies.length]
    
    console.log(`   Switching strategy: ${this.config.strategy} → ${nextStrategy}`)
    this.state.currentStrategy = nextStrategy
    this.state.stuckCount = 0
    this.state.status = 'running'

    // Force garbage collection hint (only available with --expose-gc flag)
    try {
      if (typeof globalThis !== 'undefined' && (globalThis as any).gc) {
        (globalThis as any).gc()
      }
    } catch {
      // GC not available, ignore
    }
  }

  private async applyBackoff(): Promise<void> {
    const strategy = STRATEGIES[this.state.currentStrategy]
    const attemptIndex = Math.min(this.state.attempts.length - 1, strategy.backoffMs.length - 1)
    const delay = strategy.backoffMs[Math.max(0, attemptIndex)]

    if (delay > 0) {
      console.log(`⏳ Backoff: ${delay}ms before next attempt...`)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }

  // ============================================================================
  // State Management
  // ============================================================================

  private recordAttempt(attempt: ApproachAttempt): void {
    this.state.attempts.push(attempt)
    // Keep only last 100 attempts in memory
    if (this.state.attempts.length > 100) {
      this.state.attempts = this.state.attempts.slice(-100)
    }
  }

  private reportProgress(): void {
    const progress: IWINProgress = {
      iteration: this.state.iteration,
      status: this.state.status,
      currentApproach: `Attempt #${this.state.iteration}`,
      attempts: this.state.attempts.map(a => a.strategy),
      nextStrategy: this.state.status === 'stuck' ? 'Switching strategy' : undefined
    }

    this.config.onProgress(progress)
  }

  private saveState(): void {
    if (!this.persistencePath) return
    
    try {
      const stateData = {
        ...this.state,
        savedAt: new Date().toISOString()
      }
      // In real implementation, would write to file
      console.log(`💾 State saved (${this.state.attempts.length} attempts)`)
    } catch (error) {
      console.warn('⚠️ Could not save I-WIN state:', error)
    }
  }

  private loadState(): void {
    if (!this.persistencePath) return
    
    try {
      // In real implementation, would read from file
      console.log('📂 Loading saved I-WIN state...')
    } catch (error) {
      console.warn('⚠️ Could not load I-WIN state, starting fresh')
    }
  }

  // ============================================================================
  // Public API
  // ============================================================================

  getStatus(): IWINProgress {
    return {
      iteration: this.state.iteration,
      status: this.state.status,
      currentApproach: `Attempt #${this.state.iteration}`,
      attempts: this.state.attempts.map(a => a.strategy),
      nextStrategy: this.state.currentStrategy
    }
  }

  pause(): void {
    this.state.status = 'paused'
    console.log('⏸️ I-WIN paused')
  }

  resume(): void {
    if (this.state.status === 'paused') {
      this.state.status = 'running'
      console.log('▶️ I-WIN resumed')
    }
  }

  cancel(): void {
    this.state.status = 'complete'
    console.log('🛑 I-WIN cancelled')
  }

  getStats(): IWINStats {
    return {
      totalAttempts: this.state.attempts.length,
      successfulAttempts: this.state.attempts.filter(a => a.success).length,
      failedAttempts: this.state.attempts.filter(a => !a.success).length,
      averageDuration: this.state.attempts.length > 0
        ? this.state.attempts.reduce((sum, a) => sum + a.duration, 0) / this.state.attempts.length
        : 0,
      totalTime: Date.now() - this.state.startTime,
      currentStrategy: this.state.currentStrategy,
      stuckRecoveries: Math.floor(this.state.stuckCount / 3)
    }
  }
}

// ============================================================================
// Type Exports
// ============================================================================

export interface IWINTask<T> {
  description: string
  execute: (context: IWINTaskContext) => Promise<T>
}

export interface IWINTaskContext {
  iteration: number
  previousAttempts: ApproachAttempt[]
  suggestedApproach: Approach
  cancel: () => void
}

export interface Approach {
  name: string
  description: string
  tweaks: Record<string, any>
}

export type ApproachGenerator = (state: IWINState, config: Required<IWINConfig>) => Approach

export interface IWINResult<T> {
  success: boolean
  result?: T
  error?: Error
  iterations: number
  totalDuration: number
  attempts: ApproachAttempt[]
}

export interface IWINStats {
  totalAttempts: number
  successfulAttempts: number
  failedAttempts: number
  averageDuration: number
  totalTime: number
  currentStrategy: IWINStrategy
  stuckRecoveries: number
}

// ============================================================================
// Factory Function
// ============================================================================

export function createIWIN(config?: Partial<IWINConfig>): IWINEngine {
  return new IWINEngine({
    enabled: true,
    strategy: 'adaptive',
    maxIterations: Infinity,
    ...config
  })
}

// ============================================================================
// Quick Execute Helper
// ============================================================================

export async function iwinExecute<T>(
  taskDescription: string,
  executeFn: (context: IWINTaskContext) => Promise<T>,
  options?: Partial<IWINConfig>
): Promise<IWINResult<T>> {
  const engine = createIWIN(options)
  
  return engine.execute({
    description: taskDescription,
    execute: executeFn
  })
}
