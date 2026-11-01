/**
 * M.A.D (Multi-Agent Discussion) System
 * 
 * GOD AGENT coordinates multiple sub-agents from different API providers/models.
 * Each agent brings unique perspective, leading to better solutions through discussion.
 * 
 * Features:
 * - Multi-model coordination (OpenCode Ox Alpha, Muse Spark 1.2, DeepSeek V4 Flash, etc.)
 * - Plan/Build/Debug modes
 * - Balanced turn-taking
 * - Devil's advocate role
 * - Consensus building
 * - Multiple API key support via BYOK
 */

import type { MADConfig, MAgentConfig, AgentRole } from './types'
import { invariant } from './invariant'
import { assertModelAccountability, assertBalancedAggression } from './invariant'

// ============================================================================
// Agent Discussion Types
// ============================================================================

interface AgentMessage {
  agentId: string
  content: string
  timestamp: number
  round: number
  type: 'opinion' | 'critique' | 'question' | 'consensus' | 'fact'
}

interface DiscussionRound {
  roundNumber: number
  messages: AgentMessage[]
  summary: string
  consensusLevel: number // 0-1
}

export interface MADResult {
  success: boolean
  consensus?: string
  discussions: DiscussionRound[]
  participatingAgents: string[]
  totalRounds: number
  duration: number
  finalDecision: string
}

// ============================================================================
// Pre-configured Agent Profiles
// ============================================================================

const AGENT_PROFILES: Record<string, Omit<MAgentConfig, 'apiKeyRef'>> = {
  'opencode-ox-alpha': {
    id: 'opencode-ox-alpha',
    name: 'OpenCode Ox Alpha',
    provider: 'OpenCode',
    model: 'ox-alpha',
    role: 'builder',
    specialization: ['code-generation', 'architecture', 'patterns']
  },
  'muse-spark-1.2': {
    id: 'muse-spark-1.2',
    name: 'Muse Spark 1.2',
    provider: 'Muse',
    model: 'spark-1.2',
    role: 'critic',
    specialization: ['code-review', 'optimization', 'best-practices']
  },
  'deepseek-v4-flash': {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    provider: 'DeepSeek',
    model: 'v4-flash',
    role: 'debugger',
    specialization: ['debugging', 'error-analysis', 'testing']
  },
  'generalist-agent': {
    id: 'generalist-agent',
    name: 'General AI',
    provider: 'OpenAI',
    model: 'gpt-4o',
    role: 'architect',
    specialization: ['system-design', 'planning', 'documentation']
  },
  'security-expert': {
    id: 'security-expert',
    name: 'Security Expert',
    provider: 'Anthropic',
    model: 'claude-3.5-sonnet',
    role: 'security',
    specialization: ['security', 'vulnerability-scanning', 'compliance']
  },
  'ux-specialist': {
    id: 'ux-specialist',
    name: 'UX Specialist',
    provider: 'Google',
    model: 'gemini-pro',
    role: 'ux',
    specialization: ['user-experience', 'accessibility', 'design-systems']
  }
}

// ============================================================================
// Mode Configurations
// ============================================================================

const MODE_CONFIGS = {
  plan: {
    name: 'Planning Mode',
    description: 'Agents collaborate to create detailed implementation plans',
    focus: ['architecture', 'feasibility', 'timeline', 'risks'],
    maxRounds: 5,
    consensusThreshold: 0.7
  },
  build: {
    name: 'Build Mode',
    description: 'Agents work together to implement and refine code',
    focus: ['implementation', 'code-quality', 'testing', 'integration'],
    maxRounds: 8,
    consensusThreshold: 0.6
  },
  debug: {
    name: 'Debug Mode',
    description: 'Agents analyze issues and find root causes',
    focus: ['error-analysis', 'root-cause', 'fixes', 'prevention'],
    maxRounds: 6,
    consensusThreshold: 0.8
  }
}

// ============================================================================
// M.A.D Engine Class
// ============================================================================

export class MADEngine {
  private config: Required<MADConfig>
  private agents: Map<string, ActiveAgent>
  private discussions: DiscussionRound[] = []
  private startTime: number = 0

  constructor(config: MADConfig) {
    this.config = {
      mode: config.mode ?? 'plan',
      agents: config.agents ?? [],
      timeout: config.timeout ?? 300000, // 5 minutes default
      maxRounds: config.maxRounds ?? MODE_CONFIGS[config.mode ?? 'plan'].maxRounds,
      balanceLevel: config.balanceLevel ?? 'balanced'
    }

    this.agents = new Map()
    this.initializeAgents()
  }

  // ============================================================================
  // Agent Initialization
  // ============================================================================

  private initializeAgents(): void {
    console.log('╔══════════════════════════════════════════════╗')
    console.log('║     🏛️  M.A.D. SYSTEM INITIALIZING           ║')
    console.log('║     MULTI-AGENT DISCUSSION                   ║')
    console.log('╚══════════════════════════════════════════════╝')

    if (this.config.agents.length === 0) {
      console.log('\n📋 Using default agent configuration...')
      this.setupDefaultAgents()
    } else {
      console.log(`\n📋 Configuring ${this.config.agents.length} custom agents...`)
      this.config.agents.forEach(agentConfig => this.addAgent(agentConfig))
    }

    console.log(`\n✅ ${this.agents.size} agents ready for discussion`)
    this.logAgentSummary()
  }

  private setupDefaultAgents(): void {
    // Default setup uses 3 diverse agents for balanced discussion
    const defaultAgents = [
      { ...AGENT_PROFILES['opencode-ox-alpha'], apiKeyRef: 'default' },
      { ...AGENT_PROFILES['muse-spark-1.2'], apiKeyRef: 'default' },
      { ...AGENT_PROFILES['deepseek-v4-flash'], apiKeyRef: 'default' }
    ]

    defaultAgents.forEach(agent => this.addAgent(agent))
  }

  private addAgent(config: MAgentConfig): void {
    invariant(config.id, 'Agent ID required')
    invariant(config.provider, 'Provider required')
    invariant(config.model, 'Model required')

    const activeAgent: ActiveAgent = {
      ...config,
      messageCount: 0,
      lastResponse: '',
      isActive: true,
      profile: AGENT_PROFILES[config.id] || {
        id: config.id,
        name: config.name || config.id,
        provider: config.provider,
        model: config.model,
        role: config.role,
        specialization: config.specialization
      }
    }

    this.agents.set(config.id, activeAgent)
  }

  private logAgentSummary(): void {
    console.log('\n👥 AGENT ROSTER:')
    console.log('─'.repeat(50))
    
    this.agents.forEach((agent, id) => {
      const roleEmoji = this.getRoleEmoji(agent.role)
      console.log(`${roleEmoji} ${agent.name} (${agent.provider}/${agent.model})`)
      console.log(`   Role: ${agent.role} | Specialization: ${agent.specialization.join(', ')}`)
    })
  }

  private getRoleEmoji(role: AgentRole): string {
    const emojis: Record<AgentRole, string> = {
      builder: '🔨',
      critic: '🔍',
      security: '🛡️',
      ux: '🎨',
      optimizer: '⚡',
      documentation: '📚',
      debugger: '🐛',
      tester: '🧪',
      architect: '🏗️',
      devils_advocate: '😈'
    }
    return emojis[role] || '🤖'
  }

  // ============================================================================
  // Main Discussion Loop
  // ============================================================================

  async discuss(task: string): Promise<MADResult> {
    this.startTime = Date.now()
    const modeConfig = MODE_CONFIGS[this.config.mode]

    console.log(`\n${'='.repeat(60)}`)
    console.log(`🎯 TASK: ${task}`)
    console.log(`📊 MODE: ${modeConfig.name}`)
    console.log(`🔄 MAX ROUNDS: ${this.config.maxRounds}`)
    console.log(`⚖️ BALANCE LEVEL: ${this.config.balanceLevel.toUpperCase()}`)
    console.log(`${'='.repeat(60)}\n`)

    let consensusReached = false
    let finalDecision = ''

    for (let round = 1; round <= this.config.maxRounds && !consensusReached; round++) {
      console.log(`\n${'─'.repeat(50)}`)
      console.log(`📢 ROUND ${round}/${this.config.maxRounds}`)
      console.log(`${'─'.repeat(50)}`)

      const roundResult = await this.conductRound(round, task)
      this.discussions.push(roundResult)

      // Check for consensus
      if (roundResult.consensusLevel >= modeConfig.consensusThreshold) {
        consensusReached = true
        finalDecision = roundResult.summary
        console.log(`\n✅ CONSENSUS REACHED at round ${round}!`)
        break
      }

      // Check timeout
      if (Date.now() - this.startTime > this.config.timeout) {
        console.log('\n⏰ Timeout reached, forcing conclusion...')
        break
      }
    }

    if (!finalDecision) {
      finalDecision = await this.generateFinalDecision(task)
    }

    const result: MADResult = {
      success: true,
      consensus: finalDecision,
      discussions: this.discussions,
      participatingAgents: Array.from(this.agents.keys()),
      totalRounds: this.discussions.length,
      duration: Date.now() - this.startTime,
      finalDecision
    }

    this.logFinalSummary(result)
    return result
  }

  // ============================================================================
  // Round Management
  // ============================================================================

  private async conductRound(roundNumber: number, task: string): Promise<DiscussionRound> {
    const messages: AgentMessage[] = []
    const modeConfig = MODE_CONFIGS[this.config.mode]

    console.log(`\n📋 Focus areas: ${modeConfig.focus.join(', ')}`)

    // Each agent contributes based on their role
    for (const [agentId, agent] of this.agents) {
      if (!agent.isActive) continue

      try {
        const message = await this.getAgentContribution(agent, task, roundNumber, messages)
        
        // Validate agent response (model behavior rules)
        const accountabilityCheck = assertModelAccountability(message.content, false)
        const aggressionCheck = assertBalancedAggression(message.content)

        if (!accountabilityCheck.isValid) {
          console.warn(`⚠️ Agent ${agentId} violated accountability rules`)
          // In real implementation, would request re-response
        }

        messages.push(message)
        agent.messageCount++
        agent.lastResponse = message.content

        console.log(`\n💬 ${agent.name}:`)
        console.log(`   ${this.truncate(message.content, 200)}`)

      } catch (error) {
        console.error(`❌ Error from agent ${agentId}:`, error)
        agent.isActive = false
        
        messages.push({
          agentId,
          content: `[Error: Agent unavailable]`,
          timestamp: Date.now(),
          round: roundNumber,
          type: 'fact'
        })
      }
    }

    // Generate round summary
    const summary = await this.generateRoundSummary(messages)
    const consensusLevel = this.calculateConsensusLevel(messages)

    console.log(`\n📝 Round ${roundNumber} Summary:`)
    console.log(`   ${this.truncate(summary, 150)}`)
    console.log(`   Consensus Level: ${(consensusLevel * 100).toFixed(1)}%`)

    return {
      roundNumber,
      messages,
      summary,
      consensusLevel
    }
  }

  private async getAgentContribution(
    agent: ActiveAgent,
    task: string,
    round: number,
    previousMessages: AgentMessage[]
  ): Promise<AgentMessage> {
    // Simulate agent response (in real implementation, would call actual LLM API)
    const context = this.buildAgentContext(agent, task, round, previousMessages)
    
    // This would be an actual API call in production
    const response = await this.simulateAgentResponse(agent, context)

    return {
      agentId: agent.id,
      content: response,
      timestamp: Date.now(),
      round,
      type: this.determineMessageType(agent.role, round)
    }
  }

  private buildAgentContext(
    agent: ActiveAgent,
    task: string,
    round: number,
    previousMessages: AgentMessage[]
  ): string {
    const modeConfig = MODE_CONFIGS[this.config.mode]
    
    let context = `You are ${agent.name}, a ${agent.role} agent.\n`
    context += `Your specializations: ${agent.specialization.join(', ')}.\n\n`
    context += `MODE: ${modeConfig.name}\n`
    context += `TASK: ${task}\n`
    context += `ROUND: ${round}\n\n`

    if (previousMessages.length > 0) {
      context += 'Previous discussion:\n'
      previousMessages.slice(-5).forEach(msg => {
        const sender = this.agents.get(msg.agentId)?.name || msg.agentId
        context += `- ${sender}: ${this.truncate(msg.content, 100)}\n`
      })
    }

    // Add role-specific instructions
    context += `\n${this.getRoleInstructions(agent.role, round)}`

    return context
  }

  private getRoleInstructions(role: AgentRole, round: number): string {
    const instructions: Record<AgentRole, string> = {
      builder: 'Provide constructive implementation suggestions. Be specific about code structure.',
      critic: 'Identify potential issues or improvements. Be firm but fair.',
      security: 'Highlight security concerns and suggest mitigations.',
      ux: 'Consider user experience implications.',
      optimizer: 'Suggest performance optimizations.',
      documentation: 'Note what needs to be documented.',
      debugger: 'Focus on identifying root causes of potential issues.',
      tester: 'Suggest test cases and validation approaches.',
      architect: 'Ensure overall system coherence and scalability.',
      devils_advocate: 'Challenge assumptions and propose alternatives. Play devil\'s advocate.'
    }

    const base = instructions[role] || 'Provide your expert opinion.'

    if (round > 1) {
      return base + '\nBuild upon or challenge previous suggestions. Move toward consensus.'
    }
    return base
  }

  private determineMessageType(role: AgentRole, round: number): AgentMessage['type'] {
    if (role === 'devils_advocate') return 'critique'
    if (role === 'tester') return round > 2 ? 'question' : 'opinion'
    if (round === 1) return 'opinion'
    if (round === this.config.maxRounds) return 'consensus'
    return 'critique'
  }

  // ============================================================================
  // Simulation & Analysis (Replace with real API calls in production)
  // ============================================================================

  private async simulateAgentResponse(agent: ActiveAgent, context: string): Promise<string> {
    // Simulated response - in production, this would call the actual LLM API
    // using the agent's apiKeyRef from BYOK system
    
    await new Promise(resolve => setTimeout(resolve, 100)) // Simulate network delay

    const responses = [
      `Based on my expertise in ${agent.specialization[0]}, I recommend focusing on modular architecture with clear separation of concerns.`,
      `I've analyzed the requirements from a ${agent.role} perspective. Key considerations include error handling, scalability, and maintainability.`,
      `From my experience with ${agent.model}, I suggest implementing this using modern patterns with comprehensive testing.`,
      `My analysis indicates we should prioritize code quality while ensuring performance isn't compromised.`
    ]

    return responses[Math.floor(Math.random() * responses.length)]
  }

  private async generateRoundSummary(messages: AgentMessage[]): Promise<string> {
    const contents = messages.map(m => m.content).join(' ')
    return `Discussion summary: ${this.truncate(contents, 300)}`
  }

  private calculateConsensusLevel(messages: AgentMessage[]): number {
    if (messages.length < 2) return 0

    // Simple heuristic: check if agents are aligned
    // In production, would use semantic similarity or LLM judgment
    const activeMessages = messages.filter(m => !m.content.includes('[Error]'))
    
    if (activeMessages.length <= 1) return 0.3
    
    // Base consensus increases with more rounds
    const baseConsensus = Math.min(0.9, 0.3 + (this.discussions.length * 0.1))
    
    return baseConsensus
  }

  private async generateFinalDecision(task: string): Promise<string> {
    const allMessages = this.discussions.flatMap(d => d.messages)
    const summary = allMessages.map(m => {
      const agent = this.agents.get(m.agentId)
      return `${agent?.name || m.agentId}: ${m.content}`
    }).join('\n')

    return `FINAL DECISION for "${task}":\n\nBased on multi-agent discussion across ${this.discussions.length} rounds, the recommended approach incorporates insights from ${this.agents.size} specialized agents. Key points:\n\n${this.truncate(summary, 500)}`
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  private truncate(text: string, maxLength: number): string {
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text
  }

  private logFinalSummary(result: MADResult): void {
    console.log(`\n${'='.repeat(60)}`)
    console.log('📊 M.A.D. DISCUSSION COMPLETE')
    console.log(`${'='.repeat(60)}`)
    console.log(`✅ Success: ${result.success}`)
    console.log(`⏱️ Duration: ${(result.duration / 1000).toFixed(1)}s`)
    console.log(`🔄 Total Rounds: ${result.totalRounds}`)
    console.log(`👥 Participating Agents: result.participatingAgents.length}`)
    console.log(`\n📋 FINAL DECISION:`)
    console.log('─'.repeat(60))
    console.log(result.finalDecision)
    console.log(`${'='.repeat(60)}`)
  }

  // ============================================================================
  // Public API
  // ============================================================================

  getAgentCount(): number {
    return this.agents.size
  }

  getActiveAgents(): string[] {
    return Array.from(this.agents.entries())
      .filter(([, agent]) => agent.isActive)
      .map(([id]) => id)
  }

  addAgentDynamically(config: MAgentConfig): void {
    this.addAgent(config)
    console.log(`➕ Added agent: ${config.name || config.id}`)
  }

  removeAgent(agentId: string): boolean {
    return this.agents.delete(agentId)
  }

  setBalanceLevel(level: MADConfig['balanceLevel']): void {
    this.config.balanceLevel = level
    console.log(`⚖️ Balance level set to: ${level}`)
  }
}

// ============================================================================
// Internal Types
// ============================================================================

interface ActiveAgent extends MAgentConfig {
  messageCount: number
  lastResponse: string
  isActive: boolean
  profile: Omit<MAgentConfig, 'apiKeyRef'>
}

// ============================================================================
// Factory Function
// ============================================================================

export function createMAD(config?: Partial<MADConfig>): MADEngine {
  return new MADEngine({
    mode: 'plan',
    agents: [],
    balanceLevel: 'balanced',
    ...config
  })
}

// ============================================================================
// Quick Execute Helper
// ============================================================================

export async function madDiscuss(
  task: string,
  mode: MADConfig['mode'] = 'plan',
  options?: Partial<MADConfig>
): Promise<MADResult> {
  const engine = createMAD({ mode, ...options })
  return engine.discuss(task)
}
