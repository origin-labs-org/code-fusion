import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@origin-ai/cf-api-remotes',
  ['lib/types/index.js', 'lib/types/invariant.js'],
  { hostPhase: true },
)
