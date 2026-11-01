import { clientLibrary } from '../../client/tsdown.client.ts'

export default clientLibrary(
  '@origin-ai/cf-client-test-runtime',
  ['lib/types/index.js', 'lib/types/invariant.js'],
)
