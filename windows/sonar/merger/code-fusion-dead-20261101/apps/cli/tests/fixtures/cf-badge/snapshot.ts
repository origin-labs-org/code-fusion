import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents, Inbox, type Agent } from '@origin-ai/cf-agent'
import { CallId } from '@origin-ai/cf-llm'
import { boot, loadOverlayPatches } from '@origin-ai/cf-app-boot'
import { SessionId } from '@origin-ai/cf-session'
import type {} from '@origin-ai/cf-skill'
import type {} from '@origin-ai/cf-tools'

const overlayPath = process.argv[2]
if (overlayPath === undefined) throw new Error('cf-badge snapshot requires an overlay path')
const rootConfigPath = fileURLToPath(new URL('../../../../../packages/bundle/base/tests/fixtures/root.cordis.yml', import.meta.url))
const basePatchPath = fileURLToPath(new URL('../../../../../packages/bundle/base/cordis.patch.yml', import.meta.url))
const ctx = await boot('cf-badge-snapshot', rootConfigPath, [
  ...loadOverlayPatches('cf-badge-snapshot', basePatchPath),
  ...loadOverlayPatches('cf-badge-snapshot', overlayPath),
])

try {
  const agentId = SessionId('cf-badge-snapshot')
  const session = ctx.sessions.create(agentId, { meta: { cwd: process.cwd() } })
  const agent: Agent = {
    ctx: new Context(),
    id: agentId,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => { throw new Error('cf-badge snapshot must receive the catalog at the step boundary') },
    cancel: () => {},
    runMaintenance: job => job(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  const decision = await agentEvents(ctx, agent).waterfall(
    'agent/pre-step',
    { messages: [], turn: 1, step: 1, signal: new AbortController().signal },
    () => Promise.resolve({ kind: 'enter' as const, messages: [] }),
  )
  const catalog = decision.kind === 'enter'
    ? decision.messages.find(message => message.role === 'user'
      && message.source.kind === 'skill-catalog')?.content
    : undefined
  const summary = (await ctx.skills.list()).find(skill => skill.name === 'cf-badge')
  const result = await ctx.tools.execute({
    callId: CallId('cf-badge-snapshot'),
    name: 'skill',
    arguments: { name: 'cf-badge' },
    signal: new AbortController().signal,
  })
  process.stdout.write(`${JSON.stringify({ catalog: catalog ?? null, summary: summary ?? null, result })}\n`)
} finally {
  await ctx.fiber.dispose()
}
