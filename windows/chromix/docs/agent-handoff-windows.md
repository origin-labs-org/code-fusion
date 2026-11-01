# Work sign-in and check handoff qualification on Windows

This milestone uses the shared retained-page path on macOS and Windows. Native
WebView2 qualification must run on the Windows machine; macOS and Chromium
component checks do not establish native Windows behavior.

Use an isolated checkout and target directory. Do not touch the person's browser
profile or stop their running dev app. Keep provider credentials in Credential
Manager, and never print them. The probe uses synthetic sites and GPT-6 Luna.

From PowerShell in the reviewed checkout:

```powershell
$env:CARGO_INCREMENTAL = "0"
$env:CARGO_TARGET_DIR = Join-Path $env:TEMP "zephium-handoff-target"
cargo test -p zephium-agentic --lib work_browser_human
cargo test -p zephium-engine --features agentic-browser wall_proof_tests
cargo test -p zephium-app --features work-runtime,work-execution --lib work_
cargo test -p zephium-work-composition --features durable-runtime --lib
cargo build -p zephium-terra-macos-probe --features durable-runtime --bin windows-work-probe

$handoffEvidence = Join-Path $env:TEMP "zephium-handoff-evidence"
New-Item -ItemType Directory -Force $handoffEvidence | Out-Null
$handoffProbe = Join-Path $handoffEvidence "windows-work-probe.exe"
Copy-Item (Join-Path $env:CARGO_TARGET_DIR "debug/windows-work-probe.exe") $handoffProbe
& $handoffProbe --check-provider-keychain
& $handoffProbe --loopback-site human 2>&1 | Tee-Object (Join-Path $handoffEvidence "human.log")
```

The probe is intentionally a debug build. Run only one native probe at a time.
The `human` selector runs six individually addressable cases:

| Selector | Required behavior |
| --- | --- |
| `human-signin` | Same-document sign-in clears, then the original page resumes without a Continue command; source-backed result and sign-in receipt. |
| `human-check` | Same-document human check clears and the original page resumes automatically with its check receipt. |
| `human-unresolved` | A still-visible wall stays held; the fixture eventually cancels it. |
| `human-cancel` | Stop retires the run; a later fixture DOM change cannot revive it. |
| `human-stale-document` | A new unresolved document does not inherit clearance from the old document. |
| `human-long-wait` | A 30-second admission survives a 35-second presented sign-in wait, then resumes the same page with its original limits and authorization unchanged. |

Retain the scenario summaries, executable hash, tested commit, Windows and
WebView2 versions, and any failures. A nonzero exit or missing expected receipt
is a failure, even if an answer appeared. Do not replace failed checks with
weaker assertions.

Also verify the real UI in an isolated test profile: open a sign-in/check ask,
complete it in the takeover pane, and observe automatic return to the same task.
Exercise SSO navigation, a workspace chooser, MFA, dismissal, timeout, Stop, and
switching Work while an expired-page retry is queued. Verify that approval for
send/post/payment remains separate from signing in. Use accounts and effects
explicitly authorized for testing; never send a real message merely to test
handoff.

The additive public contracts are `WorkPartNeedV1::Check { host }` and optional
`WorkStepMeasurementsV1.resolved_handoff`: `sign_in`, `check`, or
`sign_in_and_check`. A resolution receipt attests verified native continuation,
not merely a click or a URL change. Old stored measurements omit this field.
Measurements also carry optional `settled_revision`, assigned by Store rather
than the adapter. It orders concurrent page outcomes; legacy records omit it.

The existing `SignInCard.svelte`, `AskCard.svelte`, and `asks.ts` render sign-in
and check asks, hand-back progress, and durable success/failure receipts.
`WorkEnvironmentWorkspace.svelte` opens the matching retained page and queues a
fresh execution when that page has already closed. `canvas-model.ts`,
`project-environment.ts`, and `run/need.ts` project the additive check need.
`domain/work/work.svelte.ts` and `work-operations.svelte.ts` keep queued retries
on their original Work and operation, including refused and uncertain admission.
The generated bindings carry the Rust contracts; object kinds are unchanged.

Fix Windows-specific findings in the Windows worktree, regenerate bindings with
`cargo test -p zephium-desktop export_typescript_bindings` when contracts change,
and report the exact validation evidence with the follow-up commits. The person
has reserved final Windows verification and any required adaptations for that
Windows session.
