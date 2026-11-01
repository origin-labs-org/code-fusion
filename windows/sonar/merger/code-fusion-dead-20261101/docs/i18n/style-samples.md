# （style samples）

：，。****——，、。。、，（ [README.md](README.md) ）。

：；、。 PR 。

## ① 

> This document describes the architecture of the CodeFusion — the foundation of **DeepSeek Code**. The governing principle, from the microkernel design discussion: **everything is a plugin**. The core is deliberately tiny — a handful of abstract services plus one concrete loop plugin (`cf-agent-loop`) — and every product feature is a plugin against the extension API described here, without modifying the loop.

 CodeFusion ， **DeepSeek Code** 。：****。，， `cf-agent-loop`。，。

> Dependency rule: extension plugins depend on interfaces, never on `cf-agent-loop` (the loop is swappable); the sanctioned exception is the composition bundle `cf-agent-spine-demo`, whose job is assembling the concrete spine.

：， `cf-agent-loop`（）； `cf-agent-spine-demo`，。

> This document covers **behavior**; type definitions live in [subsystems/](../subsystems/core.md), the per-event/service reference lives in the generated regions of [subsystems/](../subsystems/core.md), and package contracts in the package READMEs state each package's required configuration and behavior ([map](../../packages/README.md)).

； [subsystems/](../subsystems/core.zh.md)；、 [subsystems/](../subsystems/core.zh.md) ； README （package）（[](../../packages/README.md)）。

## ② 

> Hard-won bug-class rules: each pattern below is a class of defect that actually shipped or nearly shipped here, stated as the rule that prevents its recurrence. Read this before writing lifecycle, concurrency, subprocess, or teardown code.

：、，。、、、，。

> **Dispose must reach quiescence, not just request it** — A teardown that issues kills/aborts but returns before the work stops leaves orphans. Make cleanup async and await the children's exit (kill → await `done`), and close listener/notification registries BEFORE killing so late completions stay silent. Tests prove disposal waited (pid gone right after `await fiber.dispose()`), not merely that the process eventually dies.

**dispose（），**：，，。，（，）；，。 dispose ： `await fiber.dispose()`  PID ，。

> **Async state is not synchronous state** — `agent.followup()` does not flip status before returning; a background job's completion races turn boundaries; `reader.close()` fires for both EOF and disposal. Never gate control flow on a status you only just requested — drive lifecycle off the events/promises that actually fire (`agent/status`, `task.done`), and observe the transition (saw `running` THEN `idle`) instead of treating status as a per-follow-up result: several queued follow-ups run as consecutive turns under one `running` interval, while cancellation or disposal can discard unstarted items.

****： `agent.followup()` ；；`reader.close()` ，。，； promise（`agent/status`、`task.done`），（ `running`， `idle`）， `followup()` ： `followup()` ， `running` ；。

## ③ 

> **Coverage gate** (`npm run test:coverage`): the gating run, per-file 100% on `packages/*/*/src`. An uncovered line is often dead code the gate is correctly flagging for deletion, not a missing test to bolt on. Line coverage is necessary, never sufficient — it proves lines ran, not that the feature works as shipped.

（`npm run test:coverage`）：， `packages/*/*/src`  100%。，，。，：，。

> We are DeepSeek — do not ration real-API tests. A no-key test proves the plumbing; only a with-key run proves the agent works against a real model. Write many: real prompts that write files, multi-turn conversations, tool use, cancellation mid-stream. Cheapest and highest-value are **smoke tests** that boot the real example, send one real prompt, and check the world — they catch the "green unit tests, broken product" class that mocks structurally cannot. The self-skip exists only so secretless CI and keyless contributors aren't blocked; it is not a cost signal.

 DeepSeek：。；， agent（）。：、、、。

、****：，，、。——，， mock 。

， CI 、，。

> **Prefer the real implementation over a mock** — Mock only genuinely expensive or non-deterministic dependencies (the LLM adapter, the network, the clock); keep everything downstream real. A hand-rolled stand-in proves the bridge moves bytes, not that the shipping tool behaves as asserted — the two drift while the test stays green.

**， mock **——、 mock（LLM（）、、），。 mock ，； mock ，。

## ④ 

> Blob hashes, not commit hashes, so the record is computable for files edited in the same PR (`git hash-object foo.md`) and consistency is a pure content comparison. The recorded hash also recovers the exact last-confirmed text of either side (`git cat-file -p <hash>`), so an out-of-sync pair is updated by diffing the edited side against its last-confirmed state and patching the counterpart minimally — never by re-translating whole files.

 blob hash  commit hash 。 PR ， `git hash-object foo.md`  blob hash，。 blob hash， `git cat-file -p <hash>` 。，，，。

## ⑤ 

> The gate's limit, stated plainly: a green gate means the pair was confirmed consistent at these exact contents, not that the confirmation was sound. It checks hashes and Markdown structure; it cannot judge whether the two sides actually say the same thing — that is the reviewer's half of the contract. A re-recorded pair with a sloppy counterpart passes the gate; it must not pass review.

： blob hash ， Markdown ，，；。。、，，。

## ⑥ Agent Note 

> Comparing git timestamps of the pair (no record) — rejected: formatting-only edits would false-positive, and a counterpart committed after an unrelated edit would false-negative; content identity is the only signal that means what the gate claims.

 git （）——：，。（ blob hash ），。

## ⑦ （）

> **Universal requirement**: every in-scope document merges as a complete bilingual pair. The manifest contains only explicit exclusions: it has no per-file rollout list, date cutoff, or README-specific policy class. […] Pairing is a continuing obligation: every later edit to either side updates the counterpart and consistency record in the same change.

****：。manifest（）：、 README 。（……）：，。

## 

- ：、；，。
- ：，「／／／」。
- ：false positive/negative→／、ratchet→、reviewable act→。
- ：bilingual from birth→；grandfathered→。
- ：（cookbook）、（postmortem）；。
- ，；。
- ：。
-  [terminology.md](terminology.md) ，：（ agent、mock、LLM ，cancellation 「」）。
- （ `agent/status`、 `running`、 `cf-bash-local` ） code span ，；Pass 2 。
