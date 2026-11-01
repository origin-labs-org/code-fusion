/**
 * CodeFusion (CF) - Error Handling & Resilience Utilities
 *
 * ROUND 1 IMPROVEMENT: Production-grade error handling with:
 * - Exponential backoff retry logic
 * - Circuit breaker pattern
 * - Error classification and recovery strategies
 * - Timeout wrappers
 * - Graceful degradation
 *
 * @origin-ai/cf/mad/utils
 * @version 2.0.1-advanced
 */

// ============================================================================
// ERROR CLASSIFICATION SYSTEM
// ============================================================================

/**
 * Error severity levels for classification
 */
export type ErrorSeverity = 'critical' | 'error' | 'warning' | 'info'

/**
 * Error categories for routing to appropriate handlers
 */
export type ErrorCategory =
  | 'network'           // API connectivity issues
  | 'authentication'    // Auth failures (bad keys, expired tokens)
  | 'rate_limit'        // Throttling errors (429)
  | 'validation'       // Invalid input/config
  | 'timeout'          // Operation exceeded time limit
  | 'resource_exhausted' // Budget/memory limits hit
  | 'internal'         // Unexpected code bugs
  | 'external'         // Third-party service failures
  | 'context_window'   // Token limit exceeded
  | 'permission'       // Access denied errors

/**
 * Classified error with metadata for smart handling
 */
export class CFError extends Error {
  public readonly category: ErrorCategory
  public readonly severity: ErrorSeverity
  public readonly retryable: boolean
  public readonly statusCode?: number
  public readonly provider?: string
  public readonly model?: string
  public readonly originalError?: Error
  public readonly timestamp: number
  public readonly context?: Record<string, any>
  public retryCount: number = 0

  constructor(
    message: string,
    options: {
      category: ErrorCategory
      severity?: ErrorSeverity
      retryable?: boolean
      statusCode?: number
      provider?: string
      model?: string
      originalError?: Error
      context?: Record<string, any>
    },
  ) {
    super(message)
    this.name = 'CFError'
    this.category = options.category
    this.severity = options.severity || this.inferSeverity(options.category)
    this.retryable = options.retryable ?? this.isRetryableByCategory(options.category)
    this.statusCode = options.statusCode
    this.provider = options.provider
    this.model = options.model
    this.originalError = options.originalError
    this.timestamp = Date.now()
    this.context = options.context

    // Maintain proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, CFError)
    }
  }

  private inferSeverity(category: ErrorCategory): ErrorSeverity {
    const severityMap: Record<ErrorCategory, ErrorSeverity> = {
      network: 'error',
      authentication: 'critical',
      rate_limit: 'warning',
      validation: 'warning',
      timeout: 'error',
      resource_exhausted: 'error',
      internal: 'critical',
      external: 'error',
      context_window: 'error',
      permission: 'critical',
    }
    return severityMap[category] || 'error'
  }

  private isRetryableByCategory(category: ErrorCategory): boolean {
    const retryableCategories: ErrorCategory[] = [
      'network', 'rate_limit', 'timeout', 'external', 'context_window',
    ]
    return retryableCategories.includes(category)
  }

  /**
   * Create a new instance with incremented retry count
   */
  withRetry(): CFError {
    const newError = new CFError(this.message, {
      category: this.category,
      severity: this.severity,
      retryable: this.retryable,
      statusCode: this.statusCode,
      provider: this.provider,
      model: this.model,
      originalError: this.originalError,
      context: this.context,
    })
    newError.retryCount = this.retryCount + 1
    return newError
  }

  /**
   * Convert to plain object for serialization
   */
  toJSON(): Record<string, any> {
    return {
      name: this.name,
      message: this.message,
      category: this.category,
      severity: this.severity,
      retryable: this.retryable,
      statusCode: this.statusCode,
      provider: this.provider,
      model: this.model,
      timestamp: this.timestamp,
      retryCount: this.retryCount,
      context: this.context,
      stack: this.stack,
    }
  }

  /**
   * Classify a generic error into an CFError
   */
  static classify(error: unknown, context?: { provider?: string; model?: string }): CFError {
    if (error instanceof CFError) {
      return error
    }

    const message = error instanceof Error ? error.message : String(error)

    // Network errors
    if (message.includes('ECONNREFUSED') || message.includes('ENOTFOUND') || message.includes('network')) {
      return new CFError(message, {
        category: 'network',
        originalError: error instanceof Error ? error : undefined,
        ...context,
      })
    }

    // Auth errors
    if (message.includes('401') || message.includes('403') || message.includes('unauthorized') || message.includes('forbidden')) {
      return new CFError(message, {
        category: 'authentication',
        statusCode: message.includes('401') ? 401 : 403,
        originalError: error instanceof Error ? error : undefined,
        ...context,
      })
    }

    // Rate limit errors
    if (message.includes('429') || message.includes('rate limit') || message.includes('too many requests')) {
      return new CFError(message, {
        category: 'rate_limit',
        statusCode: 429,
        originalError: error instanceof Error ? error : undefined,
        ...context,
      })
    }

    // Context window errors
    if (message.includes('context length') || message.includes('token limit') || message.includes('too long')) {
      return new CFError(message, {
        category: 'context_window',
        originalError: error instanceof Error ? error : undefined,
        ...context,
      })
    }

    // Timeout errors
    if (message.includes('timeout') || message.includes('timed out') || message.includes('abort')) {
      return new CFError(message, {
        category: 'timeout',
        originalError: error instanceof Error ? error : undefined,
        ...context,
      })
    }

    // Default to internal error
    return new CFError(message, {
      category: 'internal',
      originalError: error instanceof Error ? error : undefined,
      ...context,
    })
  }
}

// ============================================================================
// EXPONENTIAL BACKOFF RETRY WITH JITTER
// ============================================================================

/**
 * Configuration for retry behavior
 */
export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries: number
  /** Initial delay in milliseconds (default: 1000) */
  initialDelayMs: number
  /** Maximum delay in milliseconds (default: 30000) */
  maxDelayMs: number
  /** Multiplier for each subsequent delay (default: 2) */
  backoffMultiplier: number
  /** Add randomness to prevent thundering herd (default: true) */
  jitter: boolean
  /** Jitter amount as fraction of delay (default: 0.2 = ±20%) */
  jitterAmount: number
  /** Specific error categories to retry on (default: all retryable) */
  retryOnCategories?: ErrorCategory[]
  /** Callback before each retry */
  onRetry?: (error: CFError, attempt: number) => void | Promise<void>
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitter: true,
  jitterAmount: 0.2,
}

/**
 * Calculate delay with exponential backoff and optional jitter
 */
function calculateDelay(attempt: number, config: RetryConfig): number {
  // Exponential backoff: delay = initialDelay * multiplier^attempt
  let delay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt)

  // Cap at maximum
  delay = Math.min(delay, config.maxDelayMs)

  // Add jitter if enabled
  if (config.jitter) {
    const jitterRange = delay * config.jitterAmount
    delay = delay + (Math.random() * jitterRange * 2) - jitterRange
  }

  return Math.max(0, Math.floor(delay))
}

/**
 * Execute a function with automatic retry on failure
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {},
): Promise<T> {
  const fullConfig = { ...DEFAULT_RETRY_CONFIG, ...config }
  let lastError: CFError | Error | unknown

  for (let attempt = 0; attempt <= fullConfig.maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error

      // Classify the error
      const cfError = CFError.classify(error)

      // Check if we should retry this error type
      if (!cfError.retryable) {
        throw cfError
      }

      // Check if we've exhausted retries
      if (attempt >= fullConfig.maxRetries) {
        throw cfError.withRetry()
      }

      // Call retry callback if provided
      if (fullConfig.onRetry) {
        await fullConfig.onRetry(cfError.withRetry(), attempt + 1)
      }

      // Calculate and wait
      const delay = calculateDelay(attempt, fullConfig)
      console.log(`[Retry] Attempt ${attempt + 1}/${fullConfig.maxRetries} failed, retrying in ${delay}ms...`)
      await sleep(delay)
    }
  }

  // Should never reach here, but TypeScript needs it
  throw lastError
}

/**
 * Execute multiple functions in parallel with individual retry logic
 */
export async function withParallelRetry<T>(
  tasks: Array<() => Promise<T>>,
  config: Partial<RetryConfig> & { concurrency?: number } = {},
): Promise<Array<{ result: T; index: number } | { error: CFError; index: number }>> {
  const concurrency = config.concurrency || tasks.length
  const results: Array<{ result: T; index: number } | { error: CFError; index: number }> = []

  // Process in batches
  for (let i = 0; i < tasks.length; i += concurrency) {
    const batch = tasks.slice(i, i + concurrency)
    const batchResults = await Promise.allSettled(
      batch.map((task, batchIndex) =>
        withRetry(task, config).then(
          result => ({ result, index: i + batchIndex }),
          error => ({ error: CFError.classify(error), index: i + batchIndex }),
        ),
      ),
    )

    results.push(...batchResults.map(result =>
      result.status === 'fulfilled' ? result.value : { error: CFError.classify(result.reason), index: i },
    ))
  }

  return results
}

// ============================================================================
// CIRCUIT BREAKER PATTERN
// ============================================================================

/**
 * Circuit breaker states
 */
type CircuitState = 'closed' | 'open' | 'half-open'

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /** Number of failures before opening circuit (default: 5) */
  failureThreshold: number
  /** Time in ms before attempting half-open state (default: 30000) */
  resetTimeoutMs: number
  /** Number of successes to close circuit in half-open (default: 3) */
  halfOpenSuccessThreshold: number
  /** Name for logging/identification */
  name: string
}

/**
 * Circuit breaker prevents cascading failures by failing fast
 */
export class CircuitBreaker {
  private state: CircuitState = 'closed'
  private failureCount: number = 0
  private successCount: number = 0
  private lastFailureTime: number = 0
  private readonly config: CircuitBreakerConfig

  constructor(config: CircuitBreakerConfig) {
    this.config = {
      failureThreshold: 5,
      resetTimeoutMs: 30000,
      halfOpenSuccessThreshold: 3,
      ...config,
    }
  }

  /**
   * Execute function through circuit breaker
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.checkState()

    if (this.state === 'open') {
      throw new CFError(
        `Circuit breaker '${this.config.name}' is open - failing fast`,
        {
          category: 'external',
          severity: 'error',
          retryable: false,
          context: { circuitName: this.config.name, state: this.state },
        },
      )
    }

    try {
      const result = await fn()
      this.recordSuccess()
      return result
    } catch (error) {
      this.recordFailure()
      throw error
    }
  }

  /**
   * Check and potentially transition state
   */
  private checkState(): void {
    if (this.state === 'open') {
      const timeSinceFailure = Date.now() - this.lastFailureTime
      if (timeSinceFailure >= this.config.resetTimeoutMs) {
        this.state = 'half-open'
        this.successCount = 0
        console.log(`[CircuitBreaker] '${this.config.name}' transitioning to half-open`)
      }
    }
  }

  /**
   * Record successful execution
   */
  private recordSuccess(): void {
    this.failureCount = 0

    if (this.state === 'half-open') {
      this.successCount++
      if (this.successCount >= this.config.halfOpenSuccessThreshold) {
        this.state = 'closed'
        console.log(`[CircuitBreaker] '${this.config.name}' closed - recovered`)
      }
    }
  }

  /**
   * Record failed execution
   */
  private recordFailure(): void {
    this.failureCount++
    this.lastFailureTime = Date.now()

    if (this.state === 'half-open') {
      this.state = 'open'
      console.log(`[CircuitBreaker] '${this.config.name}' re-opened after half-open failure`)
    } else if (this.failureCount >= this.config.failureThreshold) {
      this.state = 'open'
      console.log(`[CircuitBreaker] '${this.config.name}' opened after ${this.failureCount} failures`)
    }
  }

  /**
   * Get current state
   */
  getState(): { state: CircuitState; failures: number; lastFailure: number } {
    return {
      state: this.state,
      failures: this.failureCount,
      lastFailure: this.lastFailureTime,
    }
  }

  /**
   * Manually reset circuit breaker
   */
  reset(): void {
    this.state = 'closed'
    this.failureCount = 0
    this.successCount = 0
    this.lastFailureTime = 0
  }
}

// ============================================================================
// TIMEOUT WRAPPERS
// ============================================================================

/**
 * Options for timeout wrapper
 */
export interface TimeoutOptions {
  /** Timeout duration in milliseconds */
  timeoutMs: number
  /** Custom error message on timeout */
  message?: string
  /** Whether to abort the operation (if supported) */
  abortable?: boolean
}

/**
 * Execute function with timeout
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  options: TimeoutOptions,
): Promise<T> {
  const { timeoutMs, message } = options

  return new Promise<T>((resolve, reject) => {
    // Set up timeout
    const timer = setTimeout(() => {
      const timeoutError = new CFError(
        message || `Operation timed out after ${timeoutMs}ms`,
        {
          category: 'timeout',
          severity: 'error',
          retryable: true,
          context: { timeoutMs },
        },
      )
      reject(timeoutError)
    }, timeoutMs)

    // Execute function
    fn()
      .then((result) => {
        clearTimeout(timer)
        resolve(result)
      })
      .catch((error) => {
        clearTimeout(timer)
        reject(CFError.classify(error))
      })
  })
}

/**
 * Execute multiple operations with overall timeout
 */
export async function withOverallTimeout<T>(
  tasks: Array<() => Promise<T>>,
  timeoutMs: number,
): Promise<Array<{ result: T; index: number } | { error: CFError; index: number }>> {
  return withTimeout(
    () => Promise.allSettled(
      tasks.map(async (task, index) => {
        try {
          const result = await task()
          return { result, index }
        } catch (error) {
          return { error: CFError.classify(error), index }
        }
      }),
    ).then(settledResults =>
      settledResults.map(result =>
        result.status === 'fulfilled' ? result.value : { error: CFError.classify(result.reason), index: 0 },
      ),
    ),
    { timeoutMs, message: `Batch operations timed out after ${timeoutMs}ms` },
  )
}

// ============================================================================
// GRACEFUL DEGRADATION
// ============================================================================

/**
 * Fallback configuration for degradation
 */
export interface FallbackConfig<T> {
  /** Primary operation */
  primary: () => Promise<T>
  /** Fallback operations in order of preference */
  fallbacks: Array<() => Promise<T>>
  /** Whether to try all fallbacks or stop at first success */
  tryAll?: boolean
  /** Custom error handler for each attempt */
  onError?: (error: CFError, attempt: { type: 'primary' | 'fallback'; index: number }) => void
}

/**
 * Execute with graceful degradation - tries fallbacks on failure
 */
export async function withGracefulDegradation<T>(
  config: FallbackConfig<T>,
): Promise<{ result: T; source: 'primary' | 'fallback'; index: number }> {
  const attempts: Array<{ fn: () => Promise<T>; type: 'primary' | 'fallback'; index: number }> = [
    { fn: config.primary, type: 'primary', index: 0 },
    ...config.fallbacks.map((fn, i) => ({ fn, type: 'fallback' as const, index: i + 1 })),
  ]

  const errors: Array<CFError> = []

  for (const attempt of attempts) {
    try {
      const result = await attempt.fn()
      return { result, source: attempt.type, index: attempt.index }
    } catch (error) {
      const cfError = CFError.classify(error)
      errors.push(cfError)

      if (config.onError) {
        config.onError(cfError, { type: attempt.type, index: attempt.index })
      }
    }
  }

  // All failed - throw aggregated error
  throw new CFError(
    `All ${attempts.length} attempts failed (${errors.length} errors)`,
    {
      category: 'external',
      severity: 'error',
      retryable: false,
      context: {
        totalAttempts: attempts.length,
        errors: errors.map(e => ({ category: e.category, message: e.message })),
      },
    },
  )
}

// ============================================================================
// BULKHEAD PATTERN (Isolation)
// ============================================================================

/**
 * Bulkhead configuration for resource isolation
 */
export interface BulkheadConfig {
  /** Max concurrent executions (default: 10) */
  maxConcurrent: number
  /** Max waiting queue size (default: 100) */
  maxWaitQueue: number
  /** Name for identification */
  name: string
}

/**
 * Bulkhead isolates failures and prevents resource exhaustion
 */
export class Bulkhead {
  private runningCount: number = 0
  private waitQueue: Array<{
    resolve: () => void
    reject: (error: CFError) => void
    timestamp: number
  }> = []
  private readonly config: BulkheadConfig

  constructor(config: BulkheadConfig) {
    this.config = {
      maxConcurrent: 10,
      maxWaitQueue: 100,
      ...config,
    }
  }

  /**
   * Execute function within bulkhead constraints
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Wait for slot
    await this.acquireSlot()

    try {
      const result = await fn()
      return result
    } finally {
      this.releaseSlot()
    }
  }

  /**
   * Acquire execution slot
   */
  private async acquireSlot(): Promise<void> {
    if (this.runningCount < this.config.maxConcurrent) {
      this.runningCount++
      return
    }

    // Check queue capacity
    if (this.waitQueue.length >= this.config.maxWaitQueue) {
      throw new CFError(
        `Bulkhead '${this.config.name}' wait queue full`,
        {
          category: 'resource_exhausted',
          severity: 'error',
          retryable: true,
          context: {
            bulkheadName: this.config.name,
            runningCount: this.runningCount,
            queueLength: this.waitQueue.length,
          },
        },
      )
    }

    // Queue up
    return new Promise<void>((resolve, reject) => {
      const waiter = {
        resolve: () => {
          this.runningCount++
          resolve()
        },
        reject: (error: CFError) => reject(error),
        timestamp: Date.now(),
      }

      this.waitQueue.push(waiter)
    })
  }

  /**
   * Release execution slot
   */
  private releaseSlot(): void {
    this.runningCount = Math.max(0, this.runningCount - 1)

    // Allow next waiting execution
    if (this.waitQueue.length > 0 && this.runningCount < this.config.maxConcurrent) {
      const next = this.waitQueue.shift()
      if (next) {
        next.resolve()
      }
    }
  }

  /**
   * Get current bulkhead stats
   */
  getStats(): { running: number; waiting: number; available: number } {
    return {
      running: this.runningCount,
      waiting: this.waitQueue.length,
      available: Math.max(0, this.config.maxConcurrent - this.runningCount),
    }
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Retry with specific error category filtering
 */
export async function retryOnError<T>(
  fn: () => Promise<T>,
  categories: ErrorCategory[],
  maxRetries: number = 3,
): Promise<T> {
  return withRetry(fn, {
    maxRetries,
    retryOnCategories: categories,
  })
}

/**
 * Create a resilient wrapper around any async function
 */
export function makeResilient<TArgs extends any[], TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>,
  options?: {
    retry?: Partial<RetryConfig>
    timeout?: number
    circuitBreaker?: CircuitBreakerConfig
    bulkhead?: BulkheadConfig
  },
): (...args: TArgs) => Promise<TReturn> {
  // Create persistent instances of resilience patterns
  const circuitBreaker = options?.circuitBreaker
    ? new CircuitBreaker(options.circuitBreaker)
    : null

  const bulkhead = options?.bulkhead
    ? new Bulkhead(options.bulkhead)
    : null

  return async (...args: TArgs) => {
    const execute = async () => {
      // Apply bulkhead if configured
      const execFn = bulkhead
        ? () => bulkhead.execute(() => fn(...args))
        : () => fn(...args)

      // Apply circuit breaker if configured
      if (circuitBreaker) {
        return circuitBreaker.execute(execFn)
      }

      return execFn()
    }

    // Apply retry
    const result = await withRetry(execute, options?.retry)

    // Apply timeout if configured
    if (options?.timeout) {
      return withTimeout(() => result, { timeoutMs: options.timeout })
    }

    return result
  }
}

// ============================================================================
// ERROR AGGREGATION
// ============================================================================

/**
 * Aggregate multiple errors into a single report
 */
export interface ErrorAggregation {
  totalErrors: number
  byCategory: Record<ErrorCategory, number>
  bySeverity: Record<ErrorSeverity, number>
  criticalErrors: CFError[]
  retryableErrors: CFError[]
  nonRetryableErrors: CFError[]
  uniqueMessages: Set<string>
  timestamp: number
}

/**
 * Aggregate multiple errors for analysis
 */
export function aggregateErrors(errors: Array<unknown>): ErrorAggregation {
  const cfErrors = errors.map(e => CFError.classify(e))

  const aggregation: ErrorAggregation = {
    totalErrors: cfErrors.length,
    byCategory: {} as Record<ErrorCategory, number>,
    bySeverity: {} as Record<ErrorSeverity, number>,
    criticalErrors: [],
    retryableErrors: [],
    nonRetryableErrors: [],
    uniqueMessages: new Set(),
    timestamp: Date.now(),
  }

  for (const error of cfErrors) {
    // Count by category
    aggregation.byCategory[error.category] = (aggregation.byCategory[error.category] || 0) + 1

    // Count by severity
    aggregation.bySeverity[error.severity] = (aggregation.bySeverity[error.severity] || 0) + 1

    // Separate by properties
    if (error.severity === 'critical') {
      aggregation.criticalErrors.push(error)
    }

    if (error.retryable) {
      aggregation.retryableErrors.push(error)
    } else {
      aggregation.nonRetryableErrors.push(error)
    }

    // Track unique messages
    aggregation.uniqueMessages.add(error.message)
  }

  return aggregation
}

/**
 * Generate human-readable error summary
 */
export function generateErrorSummary(aggregation: ErrorAggregation): string {
  const lines: string[] = [
    `Error Summary (${aggregation.totalErrors} errors)`,
    '',
    'By Category:',
    ...Object.entries(aggregation.byCategory).map(([cat, count]) => `  ${cat}: ${count}`),
    '',
    'By Severity:',
    ...Object.entries(aggregation.bySeverity).map(([sev, count]) => `  ${sev}: ${count}`),
    '',
    `Critical Errors: ${aggregation.criticalErrors.length}`,
    `Retryable: ${aggregation.retryableErrors.length} / Non-retryable: ${aggregation.nonRetryableErrors.length}`,
    `Unique Issues: ${aggregation.uniqueMessages.size}`,
  ]

  return lines.join('\n')
}
