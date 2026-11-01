/**
 * CF MAD GOD Runtime - Complete Usage Examples
 * 
 * This file demonstrates ALL features after 8 rounds of improvements:
 * - 12 Core Components
 * - I-WIN Protocol (Tool Use & Security)
 * - Streaming Support
 * - Intelligent Caching
 * - Error Recovery (Circuit Breaker + Retry)
 * - Plugin System
 * 
 * @version 3.0.0-ultimate
 */

import {
  GodRuntime,
  // Core Components
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
  // Advanced Systems
  GauntletLoop,
  ProductionReadinessSweep,
  IWINProtocol,
  IntelligentCache,
  CircuitBreaker,
  RetryHandler,
  ResilienceManager,
  PluginSystem,
  // Types
  type CFPlugin,
  type PluginHook,
  type PluginContext
} from '../core/god-runtime'

// ============================================================================
// EXAMPLE 1: Basic Runtime Initialization
// ============================================================================

async function exampleBasicInit(): Promise<void> {
  console.log('=== Example 1: Basic Runtime Initialization ===\n')
  
  const runtime = new GodRuntime({
    mode: 'PLAN',
    maxRounds: 10,
    verification: { enabled: true, level: 'general' },
    gauntlet: { enabled: true },
    productionSweep: { enabled: true },
    budget: {
      maxTotalCost: 100,
      maxCostPerTask: 10
    }
  })
  
  await runtime.initialize()
  
  console.log('Runtime initialized!')
  console.log('State:', runtime.getState())
  console.log('Components loaded:', runtime.getComponentCount?.() || 12)
}

// ============================================================================
// EXAMPLE 2: I-WIN Protocol (Tool Execution with Security)
// ============================================================================

async function exampleIWINProtocol(): Promise<void> {
  console.log('\n=== Example 2: I-WIN Protocol ===\n')
  
  const runtime = new GodRuntime()
  await runtime.initialize()
  
  const iwin = runtime.getIWINProtocol()
  
  // Register a custom tool
  iwin.registerTool(
    'web-search',
    async (input: { query: string }) => {
      return { results: [`Result for: ${input.query}`] }
    },
    { inputSchema: { query: 'string' } },
    ['auto-execute'] // Permission for auto-execution
  )
  
  // Execute tool securely
  const execution = await iwin.executeTool('web-search', { query: 'AI agents' })
  
  console.log('Tool executed:', execution.toolName)
  console.log('Status:', execution.status)
  console.log('Output:', execution.output)
  console.log('Sandboxed:', execution.sandboxed)
  
  // List all registered tools
  console.log('\nAvailable tools:', iwin.listTools().map(t => t.name))
}

// ============================================================================
// EXAMPLE 3: Intelligent Caching
// ============================================================================

async function exampleCaching(): Promise<void> {
  console.log('\n=== Example 3: Intelligent Caching ===\n')
  
  const runtime = new GodRuntime()
  await runtime.initialize()
  
  const cache = runtime.getCache()
  
  // Set cache entries with TTL and tags
  cache.set('user:123', { name: 'Alice', role: 'admin' }, {
    ttl: 3600000, // 1 hour
    tags: ['user', 'admin']
  })
  
  cache.set('config:theme', { darkMode: true }, {
    ttl: 86400000, // 24 hours
    tags: ['config']
  })
  
  // Get cached value
  const user = cache.get('user:123')
  console.log('Cached user:', user)
  
  // Get by tag
  const configs = cache.getByTag('config')
  console.log('Config entries:', configs)
  
  // Get cache statistics
  const stats = cache.getStats()
  console.log('\nCache Stats:')
  console.log('- Size:', stats.size, '/', stats.maxSize)
  console.log('- Memory Usage:', stats.memoryUsageMB.toFixed(2), 'MB /', stats.maxMemoryMB, 'MB')
  console.log('- Hit Rate:', (stats.hitRate * 100).toFixed(1) + '%')
  
  // Invalidate by pattern
  const invalidated = cache.invalidatePattern(/^user:/)
  console.log('\nInvalidated user entries:', invalidated)
}

// ============================================================================
// EXAMPLE 4: Error Recovery & Resilience
// ============================================================================

async function exampleResilience(): Promise<void> {
  console.log('\n=== Example 4: Error Recovery & Resilience ===\n')
  
  const runtime = new GodRuntime()
  await runtime.initialize()
  
  const resilience = runtime.getResilienceManager()
  
  // Simulate a flaky operation
  let attempt = 0
  const flakyOperation = () => {
    attempt++
    if (attempt < 3) {
      throw new Error(`Timeout - Attempt ${attempt}`)
    }
    return { success: true, data: 'Finally worked!' }
  }
  
  try {
    // Execute with automatic retry
    const result = await resilience.executeResilient(
      'flaky-api',
      flakyOperation,
      {
        retry: {
          maxRetries: 5,
          baseDelayMs: 100,
          retryableErrors: [/timeout/i]
        },
        circuitBreaker: {
          failureThreshold: 3,
          resetTimeoutMs: 30000
        }
      }
    )
    
    console.log('Operation succeeded after retries:', result)
  } catch (error) {
    console.error('Operation failed:', error)
  }
  
  // Check circuit breaker status
  const status = resilience.getStatus()
  console.log('\nCircuit Breaker Status:', status)
}

// ============================================================================
// EXAMPLE 5: Plugin System
// ============================================================================

async function examplePluginSystem(): Promise<void> {
  console.log('\n=== Example 5: Plugin System ===\n')
  
  const runtime = new GodRuntime()
  await runtime.initialize()
  
  const pluginSystem = runtime.getPluginSystem()
  
  // Define a custom plugin
  const loggingPlugin: CFPlugin = {
    manifest: {
      name: 'logging-plugin',
      version: '1.0.0',
      description: 'Logs all task executions',
      hooks: ['before-task', 'after-task', 'on-error'],
      permissions: ['read-tasks']
    },
    
    initialize(context: PluginContext): void {
      console.log('[Plugin] Logging plugin initialized!')
    },
    
    executeHook(hook: PluginHook, context: PluginContext, data: any): void {
      const timestamp = new Date().toISOString()
      switch (hook) {
        case 'before-task':
          console.log(`[${timestamp}] [Plugin] Task starting:`, data?.taskId)
          break
        case 'after-task':
          console.log(`[${timestamp}] [Plugin] Task completed:`, data?.taskId)
          break
        case 'on-error':
          console.error(`[${timestamp}] [Plugin] Error occurred:`, data?.error)
          break
      }
    },
    
    cleanup(): void {
      console.log('[Plugin] Logging plugin cleaned up!')
    }
  }
  
  // Define an analytics plugin
  const analyticsPlugin: CFPlugin = {
    manifest: {
      name: 'analytics-plugin',
      version: '2.0.0',
      description: 'Tracks performance metrics',
      hooks: ['after-task', 'after-discussion-round'],
      dependencies: ['logging-plugin'] // Depends on logging plugin
    },
    
    executeHook(hook: PluginHook): void {
      if (hook === 'after-task') {
        console.log('[Analytics] Task metrics recorded')
      }
    }
  }
  
  // Register plugins (order matters for dependencies!)
  pluginSystem.register(loggingPlugin)
  pluginSystem.register(analyticsPlugin)
  
  // List all plugins
  console.log('Registered plugins:')
  pluginSystem.listPlugins().forEach(p => {
    console.log(`- ${p.name} v${p.version}: ${p.description || 'No description'}`)
    console.log(`  Hooks: ${p.hooks.join(', ')}`)
  })
  
  // Execute hooks
  await pluginSystem.executeHook('before-task', { taskId: 'task-123' })
  await pluginSystem.executeHook('after-task', { taskId: 'task-123', duration: 1500 })
  
  // Check which plugins handle specific hooks
  console.log('\nPlugins for after-task hook:', pluginSystem.getPluginsForHook('after-task'))
}

// ============================================================================
// EXAMPLE 6: Streaming Responses
// ============================================================================

async function exampleStreaming(): Promise<void> {
  console.log('\n=== Example 6: Streaming Responses ===\n')
  
  // Note: StreamChunk and ResponseStreamController are exported from mad.ts
  // This demonstrates the streaming interface
  
  interface StreamChunk {
    id: string
    agentId: string
    content: string
    delta: string
    isFinal: boolean
    timestamp: number
  }
  
  class MockStreamController {
    private chunks: StreamChunk[] = []
    
    simulateStream(agentId: string): void {
      const words = ['Hello', 'World', 'from', 'CF', 'MAD', 'Runtime!']
      let content = ''
      
      words.forEach((word, index) => {
        setTimeout(() => {
          content += (index > 0 ? ' ' : '') + word
          const chunk: StreamChunk = {
            id: `chunk-${index}`,
            agentId,
            content,
            delta: word,
            isFinal: index === words.length - 1,
            timestamp: Date.now()
          }
          
          this.chunks.push(chunk)
          console.log(`[Stream] Delta: "${word}" | Full: "${content}"`)
          
          if (chunk.isFinal) {
            console.log('\n[Stream] Complete! Total chunks:', this.chunks.length)
          }
        }, index * 200) // Simulate delay
      })
    }
  }
  
  const streamController = new MockStreamController()
  streamController.simulateStream('agent-researcher')
  
  // Wait for stream to complete
  await new Promise(resolve => setTimeout(resolve, 1500))
}

// ============================================================================
// EXAMPLE 7: Cost Intelligence & Budget Management
// ============================================================================

async function exampleCostManagement(): Promise<void> {
  console.log('\n=== Example 7: Cost Intelligence & Budget ===\n')
  
  const runtime = new GodRuntime({
    budget: {
      maxTotalCost: 50,
      maxCostPerTask: 5,
      alertThreshold: 0.8
    }
  })
  
  await runtime.initialize()
  
  const costManager = runtime.getCostIntelligence()
  
  // Simulate task costs
  costManager.recordTaskCost('task-1', 'gpt-4', 0.50, 1000)
  costManager.recordTaskCost('task-2', 'claude-3', 0.75, 1200)
  costManager.recordTaskCost('task-3', 'gpt-3.5', 0.25, 800)
  
  // Get cost summary
  const summary = costManager.getCostSummary()
  console.log('Cost Summary:')
  console.log('- Total Cost:', summary.totalCost.toFixed(2), '$')
  console.log('- Tasks Completed:', summary.tasksCompleted)
  console.log('- Average Cost per Task:', summary.averageCostPerTask.toFixed(2), '$')
  console.log('- Budget Remaining:', summary.budgetRemaining.toFixed(2), '$')
  console.log('- Budget Utilization:', (summary.budgetUtilization * 100).toFixed(1) + '%')
  
  // Check if within budget
  console.log('\nWithin budget:', costManager.isWithinBudget())
}

// ============================================================================
// EXAMPLE 8: Production Readiness Sweep
// ============================================================================

async function exampleProductionSweep(): Promise<void> {
  console.log('\n=== Example 8: Production Readiness Sweep ===\n')
  
  const runtime = new GodRuntime({
    productionSweep: {
      enabled: true,
      checks: [
        'security',
        'performance',
        'reliability',
        'compliance'
      ]
    }
  })
  
  await runtime.initialize()
  
  const sweep = runtime.getProductionSweep()
  
  // Run production readiness check
  const result = await sweep.runSweep({
    taskId: 'deploy-001',
    artifact: {
      type: 'api-endpoint',
      name: '/api/v1/chat',
      version: '3.0.0'
    }
  })
  
  console.log('Production Gate Result:')
  console.log('- Passed:', result.passed)
  console.log('- Score:', result.score.toFixed(2), '%')
  console.log('- Findings:', result.findings.length)
  
  result.findings.forEach(finding => {
    console.log(`\n[${finding.severity.toUpperCase()}] ${finding.check}`)
    console.log(' Message:', finding.message)
  })
}

// ============================================================================
// RUN ALL EXAMPLES
// ============================================================================

async function main(): Promise<void> {
  console.log('🚀 CF MAD GOD Runtime - Complete Feature Demo')
  console.log('=' .repeat(50))
  console.log('Version: 3.0.0-ultimate (8 Rounds of Improvements)\n')
  
  try {
    await exampleBasicInit()
    await exampleIWINProtocol()
    await exampleCaching()
    await exampleResilience()
    await examplePluginSystem()
    await exampleStreaming()
    await exampleCostManagement()
    await exampleProductionSweep()
    
    console.log('\n' + '='.repeat(50))
    console.log('✅ All examples completed successfully!')
    console.log('\n📊 Summary of Features Demonstrated:')
    console.log('  • 12 Core Components ✓')
    console.log('  • I-WIN Protocol (Tool Security) ✓')
    console.log('  • Intelligent Cache (TTL + LRU) ✓')
    console.log('  • Resilience System (Circuit Breaker + Retry) ✓')
    console.log('  • Plugin System (Extensible Hooks) ✓')
    console.log('  • Streaming Support ✓')
    console.log('  • Cost Intelligence & Budgeting ✓')
    console.log('  • Production Readiness Sweep ✓')
    
  } catch (error) {
    console.error('❌ Example failed:', error)
  }
}

// Export for external use
export { main }

// Run if executed directly
if (require.main === module) {
  main()
}
