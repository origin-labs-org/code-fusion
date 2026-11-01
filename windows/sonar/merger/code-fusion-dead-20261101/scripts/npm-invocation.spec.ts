import { describe, expect, it } from 'vitest'
import { npmInvocation } from './npm-invocation.ts'

describe('npm invocation', () => {
  it.each([
    '/tools/npm.js',
    '/tools/npm.cjs',
    '/tools/npm.mjs',
    '/tools/NPM.CJS',
    '/tools/with spaces/工具/$npm;.mjs',
  ])('runs the JavaScript entrypoint %j through Node', (entrypoint) => {
    expect(npmInvocation(['run', 'build'], { npm_execpath: entrypoint })).toEqual({
      command: process.execPath,
      args: [entrypoint, 'run', 'build'],
    })
  })

  it.each([
    '/tools/npm',
    '/tools/with spaces/$npm;',
    String.raw`C:\Program Files\工具\$npm;\npm.exe`,
  ])('runs the executable entrypoint %j directly', (entrypoint) => {
    expect(npmInvocation(['run', 'build'], { npm_execpath: entrypoint })).toEqual({
      command: entrypoint,
      args: ['run', 'build'],
    })
  })

  it.each([undefined, ''])('rejects an unavailable lifecycle entrypoint', (entrypoint) => {
    expect(() => npmInvocation([], { npm_execpath: entrypoint }))
      .toThrow('npm_execpath is unavailable; invoke the script through npm run')
  })
})
