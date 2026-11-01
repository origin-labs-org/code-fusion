# CodeFusion CLI Usage Guide

The `cf` command bundles the terminal UI (TUI), the web client, and the Agent CLI behind a single entry point.

## Commands

```bash
cf                 # start the full-screen TUI (default with no arguments)
cf --web           # start the browser interface
cf install         # choose what to install: Desktop app, CLI / TUI, or both
cf login           # sign in through browser authorization (providers: zai, bigmodel)
cf logout          # remove stored login credentials
cf doctor          # inspect runtime and packaging assumptions
cf skills list     # list local skills
cf plugins list    # manage plugins and marketplaces
cf commands list   # list custom slash commands
cf app-server      # run the CodeFusion Protocol stdio app server
cf version         # print the CLI version
cf --help          # full option list
```

## Single prompts (non-interactive)

```bash
cf -p "Explain the repository structure"
cf -p "Run the tests" --cwd /path/to/project
cf -p "Review this file" --attach ./report.md
cf -p "..." --resume <session>      # continue a previous session
cf -p "..." --continue              # continue the most recent session
```

Useful options:

| Option | Purpose |
| --- | --- |
| `-p, --prompt <text>` | Run one prompt without opening the TUI |
| `--attach <path>` | Attach a local file to the prompt (repeatable) |
| `--cwd <path>` | Run from the given directory |
| `--mode <mode>` | Permission mode: `build`, `plan`, `edit`, `yolo`, or `guarded` |
| `--locale <locale>` | UI locale (`en-US` or `auto`) |
| `--json` / `--output-format` | Machine-readable output for scripting |
| `--no-browser` | Skip opening a browser during `login` |
| `--memory-bench` | With `--prompt`: enable automatic Memory extraction and wait before exiting |

## Web mode

```bash
cf --web
cf --web --workspace /path/to/project --port 3030 --no-open
cf --web --host 0.0.0.0 --token <token>
```

Web mode serves the browser client locally, prints the URL to open, and stops with `Ctrl+C`. Listening on a non-local address enables token authentication by default; use the token-bearing URL printed in the terminal.

## Model configuration

Providers are configured through the desktop/web settings or the built-in provider configuration. `CF_BUILTIN_PROVIDER_CONFIG_FILE` points the CLI at a local provider configuration file; when unset, the built-in configuration is used.

## Tools and extensions

- **Skills** — `cf skills list`; skills live in the bundled skill set and can be added per project.
- **Plugins** — `cf plugins list | install | uninstall | enable | disable | update | validate | marketplace`.
- **Custom slash commands** — `cf commands list`; define project commands as markdown files.

## Environment

| Variable | Purpose |
| --- | --- |
| `CF_DATA_BASE_DIR` | Base directory for application data (defaults to `~/.cf`) |
| `CF_SERVER_WORKSPACE` | Workspace path for the web backend |
| `CF_SERVER_AUTH_TOKEN` | API/WebSocket auth when starting the HTTP entry directly |

## Batch evaluation and trajectory capture

See `apps/cli/e2e` for end-to-end harnesses and `apps/cli/packages/debug` for trajectory tooling used in batch runs.
