# CodeFusion Security

CodeFusion Security is a CodeFusion plugin for automated security review. It provides pattern-based warnings during edits, cloud-backed diff review on stop, and deeper commit-range review before push, PR, release, or deployment handoff.

## Install

```sh
tnpm install @ali/security-scan
```

The package installs the CodeFusion plugin files and runs a postinstall step that makes the bundled launcher scripts executable on Unix-like systems.

## Contents

- `.qoder-plugin/` contains the plugin manifest and hook configuration.
- `bin/` contains cross-platform launcher and bootstrap scripts.
- `skills/` contains CodeFusion security review workflows.
- `config.yaml.example` and `security-patterns.yaml.example` provide local configuration templates.

## Requirements

- Node.js 14 or newer for npm package installation.
- CodeFusion or qodercli with plugin support.
- Network access to the configured CodeFusion Security backend when cloud-backed review commands run.

## Security scan entry point and settings

Use `/security-scan` for full-repository scans, exact file/directory scans, lightweight L2 reviews, and deep L3 reviews. A bare invocation opens a state-aware picker; explicit mode or scope requests route directly.

L2 and L3 are opt-in product switches. CLI hosts read `securityScan.l2LightweightScan` and `securityScan.l3DeepScan` from the host-specific `settings.json`. IDE hosts read the same properties from `SharedClientCache/cache/app-config.json`:

| Host | Windows | macOS | Linux/Unix |
|---|---|---|---|
| CodeFusion CLI | `%USERPROFILE%\\.qoder\\settings.json` | `$HOME/.cf/settings.json` | `$HOME/.cf/settings.json` |
| CodeFusion CN CLI | `%USERPROFILE%\\.qoder-cn\\settings.json` | `$HOME/.qoder-cn/settings.json` | `$HOME/.qoder-cn/settings.json` |
| CodeFusion IDE | `%APPDATA%\\CodeFusion\\SharedClientCache\\cache\\app-config.json` | `$HOME/Library/Application Support/Qoder/SharedClientCache/cache/app-config.json` | `${XDG_CONFIG_HOME:-$HOME/.config}/Qoder/SharedClientCache/cache/app-config.json` |
| CodeFusion CN IDE | `%APPDATA%\\QoderCN\\SharedClientCache\\cache\\app-config.json` | `$HOME/Library/Application Support/QoderCN/SharedClientCache/cache/app-config.json` | `${XDG_CONFIG_HOME:-$HOME/.config}/QoderCN/SharedClientCache/cache/app-config.json` |

Only literal JSON `true` enables a layer. Missing, malformed, unreadable, ambiguous, or unknown-host settings fail closed to disabled. An explicit disabled L2/L3 request points IDE hosts to CodeFusion Settings > Security and CLI hosts to `/security-settings`; an implicit disabled L3 handoff remains silent. The picker keeps disabled choices visible in relevance order and falls back to project/file, L2, L3 when review state is unavailable.

## Publish

Publishing goes through the three-stage release pipeline (run from `cli/`;
see `cli/deploy/README.md` for the standalone uv environment setup):

```sh
make release-build   VERSION=X.Y.Z TARGET=qoder   # plugin zip in cli/deploy/.tmp/dist/ + binaries
make release-test    VERSION=X.Y.Z TARGET=qoder   # OSS {version}/ + tnpm publish --tag beta as X.Y.Z-beta.N (internal-only)
make release-publish VERSION=X.Y.Z TARGET=qoder   # promote latest + tnpm publish of the final X.Y.Z (default latest)
```

The version is injected at packaging time; `plugin.json` / `package.json` in
the repo stay untouched.
