# @origin-ai/cf-dynamic-workflow-runtime

沙箱 harness（dynamic workflow execute引擎的 phase 1.4）。把One份 workflow 脚本在受控子进程里RunFrom来，
用 NDJSON 把子进程的 `__host.*` 调用桥接到 `@origin-ai/cf-dynamic-workflow` 的纯引擎核心。

规范：`@origin-ai/cf-dynamic-workflow/docs/execution-engine.md`（"The sandbox" 与 "The shape of a run:
three boundaries" 里点名本包）。

**仅**依赖 `@origin-ai/cf-dynamic-workflow`（workspace）与 node inner建。**绝不** import `@origin-ai/cf-core` /
`@origin-ai/cf-contracts` / `@origin-ai/cf-bootstrap` / `@origin-ai/cf-adapters`——本包Yes phase 1 "整条 sandbox↔engine
管线 app-free 可Run"的证明。

```ts
import { runWorkflowScript } from "@origin-ai/cf-dynamic-workflow-runtime";

const settlement = await runWorkflowScript({
  scriptText,
  caps: { maxConcurrency: 16 },
  askSpecs,
  validate,
  makeDriver: (sink) => driver,
  signal,
  timeoutMs,
});
// settlement: { status: "completed", artifact } | { status: "failed", error } | { status: "cancelled" }
```

```
┌─ parent (harness) ──────────────┐  NDJSON  ┌─ child (vm.createContext) ──────┐
│ runWorkflowScript               │  stdio   │ 只含 ES intrinsics + __host       │
│  - lower(scriptText)            │◀────────▶│  createActor 同步Back local 句柄  │
│  - WorkflowEngine(driver,...)   │          │  ask/worldRead → Request父进程       │
│  - 桥接 __host.* ↔ engine       │          │  args 冻结全局（spawn 时过BoundaryOne次）  │
│  - spawn/kill/timeout/abort     │          │  Date.now/Math.random Run期禁令  │
└─────────────────────────────────┘          └──────────────────────────────────┘
```

见 `src/protocol.ts`（唯One真源）。child→parent：`create-actor`（即发即忘）/ `request`（ask、
world-read）/ `event`（log）/ `complete`；parent→child：`response`。

Tests与 typecheck Passed `@origin-ai/cf-dynamic-workflow` 的**已构建 dist** 解析依赖，故 `pretest` /
`pretypecheck` 会先 `pnpm --filter @origin-ai/cf-dynamic-workflow build`。全New检出直接 `pnpm test` 即可，
不会踩到 stale-dist。

- run 的Adjudication归引擎所有。End结Failed（脚本Throw error / 子进程崩溃 / 超时 / Protocol损坏）都调
  `engine.fail(error)`——结算 `failed`、driver 侧Cancel在飞 ask、journal 记 `dwf_run.status =
  "failed"` + `failure_json`，journal 与调用方看到的ResultOne致。abort LetterNumberYes唯One的"Canceled"，
  调 `engine.cancel()`（结算 `cancelled`，可 resume）。harness 侧的 first-wins finalize 只管
  子进程清理（清 timer、关 stdin、kill child），不自造结算。
