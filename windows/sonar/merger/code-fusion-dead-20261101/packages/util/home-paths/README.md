# cf-home-paths

Shared filesystem path helpers for CodeFusion user data.

## CF home

`resolveCfHome()` resolves the single-root CodeFusion home. Precedence, highest first: an explicit configured path, `$CF_HOME`, then `~/.cf`. The harness keeps all user data under one root. A legacy `~/.cf` home is migrated one-way into `~/.cf` on first boot; existing `~/.cf` data is never overwritten.

`cfHomePath(...segments)` joins child segments onto that resolved home with Node's platform path rules. With no segments it returns the home itself.

`cfHomeDisplay()` names an active root symbolically for user-facing paths: `~/.cf` for the default home, `$CF_HOME` for any configured home. It never leaks an absolute machine path.

`CF_HOME_DIR_NAME` owns the default user-data directory name: `.cf`. `LEGACY_CF_HOME_DIR_NAME` owns the pre-CodeFusion name (`.dsh`), kept for one-way migration only.

`defaultCfHome()` returns the default CodeFusion home by joining the operating-system home directory with `.cf`, using Node's platform path rules. `legacyCfHome()` returns the legacy `~/.dsh` path. `migrateLegacyCfHome()` synchronously copies legacy data into the CodeFusion home when the legacy directory exists and the CodeFusion home does not yet exist.

`expandHomePath()` expands `~`, `~/...`, and Windows-style `~\...` prefixes against the operating-system home directory. It leaves non-tilde paths and `~user/...` untouched.

## Watch paths

`canonicalizeWatchPath()` gives a native filesystem watcher one stable spelling of its target. It resolves the deepest existing ancestor through `fs.realpath()` and restores any missing suffix, so a file or directory may still be watched before it is created. In particular, Windows 8.3 aliases cannot be mixed with the long paths emitted by the native watcher backend.

This package is intentionally small and harness-dep-free so product packages can share user-data path conventions without depending on one another.

## Known Limitations and Deferred Work

- **Expansion is deliberately narrow** — only bare `~`, `~/...`, and `~\...` use the current operating-system home; named-user forms such as `~alice/...`, environment variables, and shell expressions remain unchanged.
- **Canonicalization reads but never mutates** — `canonicalizeWatchPath()` performs `realpath` probes and propagates errors other than absence; callers still own directory creation, permissions, and trust policy for the resulting path.
