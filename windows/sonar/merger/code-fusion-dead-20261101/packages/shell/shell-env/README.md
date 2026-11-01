# @origin-ai/cf-shell-env

The tool-independent shell environment plugin: owns the `ctx.shellEnv` registry of trusted, per-execution `CF_*` variables that the model-facing shell tools (`cf-tool-bash`, `cf-tool-pwsh`) collect into every shell call's environment. Built-in shell facts (`CF_HOME`, `CF_SHELL=1`, `CF_SESSION_ID`) are owned by the registry itself; other plugins register additional enumerable facts with effect-scoped disposal, and duplicate ownership or undeclared runtime keys fail loudly.

The package root exports the Cordis plugin contract (`name`, `inject`, `Config`, `apply`) plus the `ShellEnvRegistry` service class and its contributor types; consumers use `ctx.shellEnv` after loading this plugin.

## Config

```yaml
- id: shell-env
  name: '@origin-ai/cf-shell-env'
  config:
    cfHome: C:\Users\me\.cf   # default: $CF_HOME, then ~/.cf
```

## Managed environment

Every foreground and background model shell call receives a newly collected trusted `CF_*` environment. `CF_HOME` is the absolute Harness home resolved by [`@origin-ai/cf-home-paths`](../../util/home-paths/README.md) (`cfHome` config, then ambient `$CF_HOME`, then `~/.cf`) and `CF_SHELL=1` identifies the managed child. Agent calls additionally receive `CF_SESSION_ID=agent.session.header.id`; when the active persistence seam locates a JSONL artifact they also receive `CF_SESSION_JSONL=<absolute target path>`. The JSONL path is a location hint: it may not exist before the first flush or contain the current buffered turn, and it is not an authorization credential.

`ctx.shellEnv` owns collection. Other plugins can register an effect-scoped contributor with a stable name, declared keys/descriptions, and `resolve(execution: ToolExecution)`; duplicate ownership and undeclared runtime keys fail loudly, while `list()` enumerates declarations without executing providers. Harness built-ins reserve `CF_HOME`, `CF_SHELL`, and `CF_SESSION_ID`; this plugin's persistence translator owns `CF_SESSION_JSONL` by reading the backend-neutral `sessionPersistence.locate()` seam.

```ts
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@origin-ai/cf-shell-env'

export const inject = ['shellEnv']

export function apply(ctx: Context): void {
  ctx.shellEnv.register({
    name: 'deployment-region',
    variables: { CF_DEPLOYMENT_REGION: { description: 'Current deployment region.' } },
    resolve: execution => execution.agent === undefined ? {} : { CF_DEPLOYMENT_REGION: 'cn-north' },
  })
}
```

The overlay is computed from the current `ToolExecution` and passed through the dedicated `ShellExecRequest.cfEnv` channel. The local executors remove all inherited `CF_*` before merging that snapshot, so nested harnesses and concurrent parent/child agents cannot leak stale identities. `process.env` is never modified. The shell tools' descriptions teach the generic `$CF_*` convention rather than naming persistence-specific variables or adding a permanent system-prompt section.

## Model Experience

Indirectly, through the shell tools (`cf-tool-bash`, `cf-tool-pwsh`), which collect this registry's managed `CF_*` snapshot into every shell-tool call.

#### KV Cache effect

No direct invalidation; the named consumers own any request-prefix changes.

## Known Limitations and Deferred Work

- **`list()` enumerates contributor-declared variables only** — registry-owned built-ins (`CF_HOME`, `CF_SHELL`, `CF_SESSION_ID`) are not included, so diagnostics, prompt, or UI code must not treat `list()` as an exhaustive environment catalog.
