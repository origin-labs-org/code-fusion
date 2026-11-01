# MAD runtime

Multi-agent deliberation for CodeFusion. The runtime, the packages and the `/mad` skill are
wired into the tree (2026-10-28); nothing here is a stub.

```
mad/
  brand/              @origin-ai/cf-brand         Branded<B> nominal ids (no runtime cost)
  invariants/         @origin-ai/cf-invariants    cordis service: ctx.invariants.register/list
  discussion-bus/     @origin-ai/cf-discussion-bus  ordered bus + UNTIL_CONTEXT_CLEAR
  gauntlet/           @origin-ai/cf-gauntlet      quality loop + frozen bars
  god-runtime/        @origin-ai/cf-god-runtime   control plane (router, scheduler, claims,
                                                  arbiter, snapshot/restore, verification)
  memory-fabric/      @origin-ai/cf-memory-fabric sha256 content addressing, HOT/WARM/COLD
  production-sweep/   @origin-ai/cf-production-sweep  4-agent sweep + READY gates
  skill-discovery/    @origin-ai/cf-skill-discovery   search → rank → vet → fetch → activate
  verification/       @origin-ai/cf-verification  proof gate + 6-way adversarial cross-check
```

## Wiring

- Workspaces: root `pnpm-workspace.yaml` lists `apps/cli/packages/mad/*` and
  `apps/cli/vendor/*`; `apps/cli/pnpm-workspace.yaml` lists the same globs.
- Vendors: `apps/cli/vendor/cordis` (`@deepseek-ai/cordis`, prebuilt) and
  `apps/cli/vendor/cosmokit` (`@deepseek-ai/cosmokit`, prebuilt, cordis dependency).
- Every package exports TypeScript source (`main`/`types`/`exports` → `src/*.ts`), so the
  CLI esbuild bundle compiles them directly and there is no build order to maintain.
- Cross-package dependencies are `workspace:*` (`cf-brand`, `cf-invariants`, `cordis`).

## Entry points

- CLI: `cf mad status|run|list|show|discuss|claim|resolve|arbiter|complete|cancel|finalize`
  — `apps/cli/packages/cli/src/mad-command.ts`, dispatched from `run.ts`.
- Skill: `apps/cli/packages/bundled-skills/skills/mad/SKILL.md` (`/mad`), including the
  bidirectional handoff with `/workflow`.
- State: `<workspace>/.cf/mad/runs/<runId>.json`, `latest.json`, `<runId>.orders.md`.

## Tests

```bash
node --import tsx --test apps/cli/packages/mad/god-runtime/test/*.test.ts   # 13/13
```

## Model calls

The control plane is model-agnostic: it routes, budgets, records claims and arbitrates.
Work orders name the models to use; the agent (via `/mad` + `/workflow`) performs the calls
with whatever providers are configured — there is no free/paid gate and no BYOK layer.
