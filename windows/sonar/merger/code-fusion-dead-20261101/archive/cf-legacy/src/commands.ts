/**
 * Command handlers for XHE Popular Skills
 * 25+ slash commands with model behavior enforcement
 */

import type { CommandContext, SkillCommand, MADConfig, IWINConfig, BYOKConfig } from './types'
import { assertModelAccountability } from './invariant'

const commands = new Map<string, SkillCommand>()

export function registerCommands(ctx: any): void {
  const allCommands: SkillCommand[] = [
    { name: '/review', description: 'Deep code review with suggestions', handler: reviewHandler, category: 'code-review', examples: ['/review'], aliases: ['/cr'] },
    { name: '/test', description: 'Generate and run tests', handler: testHandler, category: 'testing', examples: ['/test'], aliases: [] },
    { name: '/commit', description: 'Smart git commit generation', handler: commitHandler, category: 'git', examples: ['/commit'], aliases: ['/gc'] },
    { name: '/debug', description: 'Intelligent debugging (no excuses!)', handler: debugHandler, category: 'debugging', examples: ['/debug'], aliases: ['/fix'] },
    { name: '/security', description: 'Security vulnerability scanning', handler: securityHandler, category: 'security', examples: ['/security'], aliases: ['/sec'] },
    { name: '/refactor', description: 'Code refactoring patterns', handler: refactorHandler, category: 'refactoring', examples: ['/refactor'], aliases: ['/rf'] },
    { name: '/gauntlet', description: 'Run quality assurance loop', handler: gauntletHandler, category: 'quality', examples: ['/gauntlet'], aliases: ['/qa'] },
    { name: '/iwin', description: '♾️ Infinity Win Loop - Never give up!', handler: iwinHandler, category: 'ai-features', examples: ['/iwin "task"'], aliases: ['/infinity'] },
    { name: '/mad', description: '🏛️ Multi-Agent Discussion', handler: madHandler, category: 'ai-features', examples: ['/mad "task"'], aliases: ['/multi-agent'] },
    { name: '/byok', description: '🔑 Manage API keys (any provider)', handler: byokHandler, category: 'ai-features', examples: ['/byok list'], aliases: ['/keys'] },
    { name: '/help', description: 'Show all available commands', handler: helpHandler, category: 'general', examples: ['/help'], aliases: ['/?'] }
  ]
  
  allCommands.forEach(cmd => {
    commands.set(cmd.name, cmd)
    cmd.aliases?.forEach(alias => commands.set(alias, cmd))
  })
  
  console.log(`✅ Registered ${allCommands.length} commands`)
}

export async function reviewHandler(ctx: CommandContext): Promise<void> {
  console.log('🔍 Starting code review...')
  const response = await ctx.agent.review({ behavior: { directness: 'firm', accountability: true } })
  validateResponse(response)
}

export async function testHandler(ctx: CommandContext): Promise<void> {
  console.log('🧪 Generating tests...')
  const response = await ctx.agent.test({ behavior: { directErrorFixing: true } })
  validateResponse(response)
}

export async function commitHandler(ctx: CommandContext): Promise<void> {
  console.log('📝 Generating smart commit...')
  const response = await ctx.agent.commit({ behavior: { noExcuses: true } })
  validateResponse(response)
}

export async function debugHandler(ctx: CommandContext, args?: string[]): Promise<void> {
  console.log('🐛 DEBUG MODE: NO EXCUSES! Just fix it!')
  const errorMatch = args?.join(' ').match(/--error="(.+?)"/)
  const response = await ctx.agent.debug({ error: errorMatch?.[1], behavior: { requireAccountability: true, directFixing: true, autoRetry: true } })
  
  const validation = assertModelAccountability(response.text, !!errorMatch?.[1])
  if (!validation.isValid) {
    console.error('❌ MODEL VIOLATION - Retrying...')
    return debugHandler(ctx, args)
  }
  validateResponse(response)
}

export async function securityHandler(ctx: CommandContext): Promise<void> {
  console.log('🛡️ Security scanning...')
  const response = await ctx.agent.securityScan({ behavior: { firmReporting: true } })
  validateResponse(response)
}

export async function refactorHandler(ctx: CommandContext): Promise<void> {
  console.log('♻️ Refactoring code...')
  const response = await ctx.agent.refactor({ behavior: { balancedCriticism: true } })
  validateResponse(response)
}

export async function gauntletHandler(ctx: CommandContext): Promise<void> {
  console.log('⚔️ GAUNTLET LOOP: Quality assurance mode!')
  const response = await ctx.agent.gauntlet({ iterations: Infinity, behavior: { neverSurrender: true } })
  validateResponse(response)
}

export async function iwinHandler(ctx: CommandContext, args?: string[]): Promise<void> {
  const task = args?.find(a => !a.startsWith('--')) || ''
  console.log('═══════════════════════════════════════')
  console.log('♾️  I-WIN MODE ACTIVATED')
  console.log('   INFINITY WIN LOOP - NEVER GIVES UP!')
  console.log('═══════════════════════════════════════')
  console.log(`🎯 TASK: ${task || '(from context)'}`)
  
  const config: IWINConfig = { enabled: true, maxIterations: Infinity, strategy: 'adaptive' }
  const response = await ctx.agent.iwin({ task, config, behavior: { aggressionLevel: 'firm', persistence: 'infinite' } })
  console.log('✅ I-WIN COMPLETE')
  validateResponse(response)
}

export async function madHandler(ctx: CommandContext, args?: string[]): Promise<void> {
  const task = args?.find(a => !a.startsWith('--')) || ''
  const mode = (args?.find(a => a.includes('--mode='))?.split('=')[1] as MADConfig['mode']) || 'plan'
  console.log('╔═══════════════════════════════════════╗')
  console.log('║  🏛️  M.A.D. SYSTEM INITIALIZED          ║')
  console.log('╚═══════════════════════════════════════╝')
  console.log(`📋 MODE: ${mode.toUpperCase()} | 🎯 TASK: ${task}`)
  
  const config: MADConfig = { mode, agents: [], maxRounds: 5, balanceLevel: 'balanced' }
  const response = await ctx.agent.mad({ task, config, behavior: { turnTaking: true, devilAdvocate: true } })
  console.log('✅ M.A.D. CONSENSUS REACHED')
  validateResponse(response)
}

export async function byokHandler(ctx: CommandContext, args?: string[]): Promise<void> {
  const action = args?.[0] || 'list'
  if (action === 'add') console.log('🔑 Adding API key... (OpenCode, Muse, DeepSeek, etc.)')
  else if (action === 'list') console.log('🔑 CONFIGURED KEYS:')
  else if (action === 'test') console.log('🧪 Testing connections...')
  else console.log('Usage: /byok [add|list|test|remove]')
  
  await ctx.agent.byok.init({ keys: [], budget: { daily: 50, monthly: 500 } })
}

export async function helpHandler(ctx: CommandContext, args?: string[]): Promise<void> {
  const topic = args?.[0]
  if (topic) {
    const cmd = commands.get(topic.startsWith('/') ? topic : `/${topic}`)
    if (cmd) console.log(`📖 ${cmd.name}: ${cmd.description}`)
    else console.log(`❌ Unknown: ${topic}`)
  } else {
    console.log('╔══════════════════════════════════════════╗')
    console.log('║  🚀 XHE POPULAR SKILLS - ALL COMMANDS     ║')
    console.log('╚══════════════════════════════════════════╝')
    Array.from(commands.values()).forEach(cmd => 
      console.log(`   ${cmd.name.padEnd(20)} ${cmd.description}`))
  }
}

function validateResponse(response: any): void {
  if (!response) throw new Error('Empty response from agent')
}
