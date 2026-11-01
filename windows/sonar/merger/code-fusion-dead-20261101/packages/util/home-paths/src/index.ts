/**
 * Shared filesystem path helpers for CodeFusion user data.
 *
 * @module @origin-ai/cf-home-paths
 */

import { cpSync, statSync } from 'node:fs'
import { opendir, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

/** Directory name for the default CodeFusion home under the OS home. */
export const CF_HOME_DIR_NAME = '.cf'

/** Directory name of the pre-CodeFusion home, kept for one-way migration. */
export const LEGACY_CF_HOME_DIR_NAME = '.dsh'

/** Stable user-facing display form for the default CodeFusion home. */
export const DEFAULT_CF_HOME_DISPLAY = `~/${CF_HOME_DIR_NAME}`

/** User-facing display form of the legacy pre-CodeFusion home. */
export const LEGACY_CF_HOME_DISPLAY = `~/${LEGACY_CF_HOME_DIR_NAME}`

/** Environment variable that overrides the default CodeFusion home. */
export const CF_HOME_ENV = 'CF_HOME'

/**
 * Give a native filesystem watcher one canonical spelling of a path, even
 * when its final components do not exist yet. The deepest existing ancestor
 * is resolved through {@link realpath}; when a suffix is missing, that
 * ancestor is also proved to be an enumerable directory before the suffix is
 * restored. This prevents Windows from treating a regular-file ancestor as
 * ordinary absence, and prevents short-name aliases from being mixed with
 * long paths emitted by the native watcher backend.
 * @param path - Watch target or root, resolved against the current directory.
 * @returns the target with its existing ancestor canonicalized.
 * @throws when ancestor traversal encounters an error other than absence, or
 * the existing ancestor of a missing suffix is not an enumerable directory.
 */
export async function canonicalizeWatchPath(path: string): Promise<string> {
  let current = resolve(path)
  const missing: string[] = []
  while (true) {
    try {
      const canonical = await realpath(current)
      if (missing.length > 0) {
        // A Windows file-as-parent probe reports ENOENT. Opening the resolved
        // ancestor preserves the cross-platform directory requirement.
        const directory = await opendir(canonical)
        await directory.close()
      }
      return join(canonical, ...missing.reverse())
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const parent = dirname(current)
      /* v8 ignore next -- a filesystem root exists, so traversal resolves before this guard */
      if (parent === current) throw error
      missing.push(basename(current))
      current = parent
    }
  }
}

/**
 * Resolve the default CodeFusion home using Node's platform path rules.
 * @returns the absolute default harness home path.
 */
export function defaultCfHome(): string {
  return join(homedir(), CF_HOME_DIR_NAME)
}

/**
 * Resolve the legacy pre-CodeFusion home (`~/.dsh`).
 * @returns the absolute legacy harness home path.
 */
export function legacyCfHome(): string {
  return join(homedir(), LEGACY_CF_HOME_DIR_NAME)
}

/**
 * One-way migrate a legacy `~/.dsh` home into the CodeFusion `~/.cf` home.
 *
 * Synchronous so early boot (bin entry, before any async runtime) can run it.
 * Copies only when the legacy directory exists and the CodeFusion home does
 * not yet exist; never overwrites existing CodeFusion data.
 * @param home - optional explicit/CodeFusion home override root.
 * @param osHome - operating-system home override (tests only).
 * @returns `'migrated'` when legacy data was copied, `'fresh'` when the
 * CodeFusion home already existed or there was nothing to migrate,
 * `'legacy-only'` when migration was skipped (copy failed) and only the
 * legacy home holds data.
 */
export function migrateLegacyCfHome(home: string = defaultCfHome(), osHome: string = homedir()): 'migrated' | 'fresh' | 'legacy-only' {
  const legacy = join(osHome, LEGACY_CF_HOME_DIR_NAME)
  const exists = (path: string): boolean => {
    try {
      return statSync(path).isDirectory()
    } catch {
      return false
    }
  }
  if (exists(home)) return 'fresh'
  if (!exists(legacy)) return 'fresh'
  try {
    cpSync(legacy, home, { recursive: true, errorOnExist: false, force: false })
    return 'migrated'
  } catch {
    return 'legacy-only'
  }
}

/**
 * Expand supported tilde prefixes against the operating-system home.
 * @param path - configured path that may begin with `~`, `~/`, or `~\`.
 * @returns the expanded path, or the original value when no supported prefix is present.
 */
export function expandHomePath(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

/**
 * Resolve the single-root CodeFusion home.
 *
 * Precedence, highest first: an explicit configured path, `$CF_HOME`, then
 * `~/.cf`. The harness keeps all user data under one root. An empty or
 * whitespace-only `$CF_HOME` is treated as unset, so a blank override never
 * resolves the home to the current working directory.
 * @param configured - explicit harness-home override, which has highest precedence.
 * @param env - environment mapping used to read `CF_HOME`.
 * @returns the normalized absolute harness home path.
 */
export function resolveCfHome(configured?: string, env: Record<string, string | undefined> = process.env): string {
  const fromEnv = env[CF_HOME_ENV]
  const selected = configured ?? (fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : defaultCfHome())
  return resolve(expandHomePath(selected))
}

/**
 * Join path segments onto the resolved CodeFusion home.
 * @param segments - path segments appended to the Harness home; an empty list returns the home itself.
 * @returns the normalized absolute joined path.
 */
export function cfHomePath(...segments: string[]): string {
  return join(resolveCfHome(), ...segments)
}

/**
 * Describe a resolved harness home symbolically for user-facing display.
 *
 * It never returns an absolute machine path: the default home is labelled
 * `~/.cf`, and any configured home is labelled `$CF_HOME`.
 * @param resolvedHome - the absolute path returned by {@link resolveCfHome}.
 * @returns `~/.cf` for the default home, otherwise `$CF_HOME`.
 */
export function cfHomeDisplay(resolvedHome: string): string {
  return resolvedHome === resolve(defaultCfHome()) ? DEFAULT_CF_HOME_DISPLAY : `$${CF_HOME_ENV}`
}
