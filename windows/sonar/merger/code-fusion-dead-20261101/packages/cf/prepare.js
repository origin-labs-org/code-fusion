#!/usr/bin/env node

/**
 * CodeFusion - Prepare Script
 * Generates required entry points for workspace build compatibility
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const libTypesDir = join(__dirname, 'lib', 'types')

// Ensure directory exists
mkdirSync(libTypesDir, { recursive: true })

// Entry point files that tsdown workspace build expects
const entries = {
  'index.js': `/**
 * CodeFusion - Main Entry (auto-generated)
 * @origin-labs-ai/cf-enhanced
 */
export { name, VERSION, DESCRIPTION } from '../../src/index.ts'
export * from '../../src/index.ts'
`,
  
  'invariant.js': `/**
 * CodeFusion - Invariant Entry (auto-generated)
 */
export { invariant, assertModelAccountability, assertBalancedAggression } from '../../src/invariant.ts'
`,
  
  'startup.js': `/**
 * CodeFusion - Startup Entry (auto-generated)
 */
export { startup, DEFAULT_BEHAVIOR } from '../../src/startup.ts`
}

// Write all entry files
for (const [filename, content] of Object.entries(entries)) {
  const filepath = join(libTypesDir, filename)
  writeFileSync(filepath, content, 'utf-8')
  console.log(`✅ Created ${filepath}`)
}

console.log('📦 CodeFusion: Workspace entry points ready!')
