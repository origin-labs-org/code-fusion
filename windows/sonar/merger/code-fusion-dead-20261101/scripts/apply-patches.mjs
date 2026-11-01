#!/usr/bin/env node
/**
 * Apply this repository's local dependency patches after `npm install`.
 *
 * pnpm applied `patches/*.patch` from its `patchedDependencies` config at
 * install time; npm has no equivalent hook, so the root `postinstall` replays
 * every patch file against the installed copy instead. A patch whose pre-image
 * is already absent but whose post-image is present counts as applied and is
 * skipped, which makes the hook idempotent across reinstalls.
 *
 * The applier is deliberately dependency-free and does not shell out to `git`:
 * installation must work on macOS, Linux, and Windows without a Git install,
 * and `git apply` refuses to touch paths its ignore rules cover — exactly the
 * `node_modules/**` targets every patch here edits. Each file is named
 * `<package>@<version>.patch`, matching pnpm's convention, so the target
 * package comes from the filename rather than from a manifest.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const patchesDirectory = join(root, 'patches')
const PATCH_SUFFIX = '.patch'

/** One parsed hunk: where it starts in the pre-image, and its raw lines. */
function parseHunks(lines, patchPath) {
  const hunks = []
  let index = 0
  while (index < lines.length) {
    const header = lines[index]
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(header)
    if (match === null) {
      index += 1
      continue
    }
    const oldCount = match[2] === undefined ? 1 : Number(match[2])
    const body = []
    index += 1
    while (index < lines.length) {
      const line = lines[index]
      if (line.startsWith('@@') || line.startsWith('diff --git ') || line.startsWith('--- ')) break
      if (line === '' && body.length === 0) break
      if (!line.startsWith(' ') && !line.startsWith('+') && !line.startsWith('-') && !line.startsWith('\\')) break
      body.push(line)
      index += 1
    }
    const oldLines = body.filter(line => line.startsWith(' ') || line.startsWith('-')).map(line => line.slice(1))
    const newLines = body.filter(line => line.startsWith(' ') || line.startsWith('+')).map(line => line.slice(1))
    if (oldLines.length !== oldCount) {
      throw new Error(`apply-patches: ${patchPath} hunk at -${match[1]} declares ${oldCount} pre-image lines but carries ${oldLines.length}`)
    }
    hunks.push({ oldStart: Number(match[1]), oldLines, newLines })
  }
  if (hunks.length === 0) throw new Error(`apply-patches: ${patchPath} carries no hunks`)
  return hunks
}

/** One file a patch edits: its repository-relative target and its hunks. */
function parsePatch(patchPath) {
  const lines = readFileSync(patchPath, 'utf8').split('\n')
  const files = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line.startsWith('+++ ')) continue
    const target = line.slice(4).trim()
    const nextIsHunk = (lines[index + 1] ?? '').startsWith('@@')
    if (!nextIsHunk) continue
    // `-p1` strips the `a/` or `b/` prefix every hunk header carries.
    const relative = target.replace(/^[ab]\//, '')
    if (relative === '/dev/null') continue
    files.push({ relative, hunks: parseHunks(lines.slice(index + 1), patchPath) })
  }
  if (files.length === 0) throw new Error(`apply-patches: ${patchPath} names no files`)
  return files
}

/** Split a file into lines plus the ending style to reproduce. */
function splitLines(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const endsWithEol = text.endsWith(eol)
  const body = text.split(/\r?\n/)
  if (endsWithEol) body.pop()
  return { eol, endsWithEol, body }
}

/**
 * Apply one file's hunks.
 * @param patchPath - the patch file, for diagnostics.
 * @param file - the parsed file entry.
 * @param packageDirectory - absolute installed-package directory.
 * @returns `applied`, `already-applied`, or throws when neither holds.
 */
function applyFile(patchPath, file, packageDirectory) {
  const absolute = join(packageDirectory, file.relative)
  if (!existsSync(absolute)) {
    throw new Error(`apply-patches: ${patchPath} targets ${file.relative}, which is not installed under ${packageDirectory}`)
  }
  const { eol, endsWithEol, body } = splitLines(readFileSync(absolute, 'utf8'))
  const matches = (actual, expected) => expected.every((line, offset) => actual[offset] === line)
  const applied = file.hunks.every(hunk => matches(body.slice(hunk.oldStart - 1), hunk.oldLines))
  if (applied) {
    let delta = 0
    for (const hunk of file.hunks) {
      const start = hunk.oldStart - 1 + delta
      body.splice(start, hunk.oldLines.length, ...hunk.newLines)
      delta += hunk.newLines.length - hunk.oldLines.length
    }
    writeFileSync(absolute, body.join(eol) + (endsWithEol ? eol : ''))
    return 'applied'
  }
  let alreadyApplied = 0
  let delta = 0
  for (const hunk of file.hunks) {
    const start = hunk.oldStart - 1 + delta
    if (matches(body.slice(start), hunk.newLines)) {
      alreadyApplied += 1
      delta += hunk.newLines.length - hunk.oldLines.length
      continue
    }
    delta += hunk.newLines.length - hunk.oldLines.length
  }
  if (alreadyApplied === file.hunks.length) return 'already-applied'
  throw new Error(`apply-patches: ${patchPath} hunk context does not match the installed ${file.relative}`)
}

/** Split `<package>@<version>` into the package name. */
function packageName(spec) {
  // A scoped name contains a slash but no `@` of its own, so the last `@`
  // separates the version.
  const at = spec.lastIndexOf('@')
  return at > 0 ? spec.slice(0, at) : spec
}

const patches = readdirSync(patchesDirectory)
  .filter(name => name.endsWith(PATCH_SUFFIX))
  .sort()
if (patches.length === 0) {
  throw new Error(`apply-patches: no ${PATCH_SUFFIX} files under ${patchesDirectory}; the patch set is unexpectedly empty.`)
}

for (const file of patches) {
  const spec = file.slice(0, -PATCH_SUFFIX.length)
  const name = packageName(spec)
  const packageDirectory = join(root, 'node_modules', ...name.split('/'))
  if (!existsSync(join(packageDirectory, 'package.json'))) {
    throw new Error(`apply-patches: ${spec}: ${name} is not installed at ${packageDirectory}`)
  }
  const patchPath = join(patchesDirectory, file)
  const results = parsePatch(patchPath).map(entry => applyFile(patchPath, entry, packageDirectory))
  if (results.includes('applied')) console.log(`apply-patches: applied ${file}`)
}
