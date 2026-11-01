/** Restore the executable bit stripped from node-pty's prebuilt helper. */

import { chmodSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Best-effort repair: node-pty may not be linked yet when lifecycle scripts run
// in parallel (npm), or the helper may not exist on this platform (Windows).
// Skipping is safe — the runtime probe fails closed when no helper is usable.
let entry
try {
  entry = fileURLToPath(import.meta.resolve('node-pty'))
} catch {
  process.exit(0)
}
const packageRoot = dirname(dirname(entry))
const candidates = [
  join(packageRoot, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper'),
  join(packageRoot, 'build', 'Release', 'spawn-helper'),
]

for (const helper of candidates) {
  if (existsSync(helper)) chmodSync(helper, 0o755)
}
