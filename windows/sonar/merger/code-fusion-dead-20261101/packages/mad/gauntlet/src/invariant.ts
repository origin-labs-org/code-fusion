/**
 * Package-owned invariant companion for `@origin-ai/cf-gauntlet`.
 * @module @origin-ai/cf-gauntlet/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@origin-ai/cf-invariants'

const PACKAGE_NAME = '@origin-ai/cf-gauntlet'

/** Cordis companion plugin name. */
export const name = 'gauntlet-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this legacy MAD package owns no durable package-local
 * event stream that the shared invariant service can observe; its behavior is
 * covered by the package tests.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
