/** Experimental-package publication and dependency constraints. */

import { describe, expect, it } from 'vitest'
import {
  checkExperimentalDependencyIsolation,
  checkExperimentalManifest,
  type WorkspaceManifest,
} from './check-workspace-constraints.ts'

const experimental: WorkspaceManifest = {
  dir: 'packages/experimental/prototype',
  manifest: { name: '@origin-ai/cf-experimental-prototype', private: true },
}

describe('experimental workspace constraints', () => {
  it('requires the experimental package-name prefix', () => {
    expect(checkExperimentalManifest({
      ...experimental,
      manifest: { ...experimental.manifest, name: '@origin-ai/cf-prototype' },
    })).toEqual([
      '@origin-ai/cf-prototype: experimental package name must start with "@origin-ai/cf-experimental-"',
    ])
  })

  it('requires private manifests without publication metadata', () => {
    expect(checkExperimentalManifest(experimental)).toEqual([])
    expect(checkExperimentalManifest({
      ...experimental,
      manifest: { ...experimental.manifest, private: false, publishConfig: { access: 'public' } },
    })).toEqual([
      '@origin-ai/cf-experimental-prototype: experimental package must set "private": true',
      '@origin-ai/cf-experimental-prototype: experimental package must omit publishConfig',
    ])
  })

  it.each(['dependencies', 'optionalDependencies', 'peerDependencies'] as const)(
    'rejects release %s on an experimental package',
    (section) => {
      expect(checkExperimentalDependencyIsolation([experimental, {
        dir: 'packages/core/consumer',
        manifest: {
          name: '@origin-ai/cf-consumer',
          [section]: { '@origin-ai/cf-experimental-prototype': 'workspace:^' },
        },
      }])).toEqual([
        `@origin-ai/cf-consumer: ${section}.@origin-ai/cf-experimental-prototype must not reference an experimental package`,
      ])
    },
  )

  it('allows development and experimental consumers but rejects the Python release runtime', () => {
    const manifests: WorkspaceManifest[] = [experimental, {
      dir: 'packages/core/test-only',
      manifest: {
        name: '@origin-ai/cf-test-only',
        devDependencies: { '@origin-ai/cf-experimental-prototype': 'workspace:^' },
      },
    }, {
      dir: 'packages/experimental/consumer',
      manifest: {
        name: '@origin-ai/cf-experimental-consumer',
        dependencies: { '@origin-ai/cf-experimental-prototype': 'workspace:^' },
      },
    }, {
      dir: 'python/sdk-runtime',
      manifest: {
        name: '@origin-ai/cf-python-runtime',
        dependencies: { '@origin-ai/cf-experimental-prototype': 'workspace:^' },
      },
    }]

    expect(checkExperimentalDependencyIsolation(manifests)).toEqual([
      '@origin-ai/cf-python-runtime: dependencies.@origin-ai/cf-experimental-prototype must not reference an experimental package',
    ])
  })
})
