import { defineConfig } from 'tsdown'

export default defineConfig({
  // Entry points matching root XHE build expectations
  entry: [
    'src/index.ts',
    'src/invariant.ts',
    'src/startup.ts'
  ],
  outDir: 'lib/types',  // Output to lib/types/ for main build compatibility
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  dts: true,
  clean: true,
  // Ensure all dependencies are properly resolved
  resolve: {
    conditions: ['node', 'import']
  }
})
