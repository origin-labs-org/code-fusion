# Reliable Delivery

## Purpose

Use this domain for acceptance, change-review safeguards, and delivery
recovery boundaries.

## Load When

- Agent Work Loop Reliable Delivery needs acceptance, approval, or recovery
  evidence.
- A report, hook, or review flow needs sensitive-code handling.
- Git, CI, or local lifecycle checks need review-trigger guidance.
- Harness-analysis output needs to separate static presence, configured policy,
  and observed execution evidence.

## Owns

- `git-hooks.md`: Git hook lifecycle placement and evidence.
- `recovery-evidence.md`: rollback and recovery presence, wiring, safe exercise,
  applicability, and validation evidence.
- `review-trigger.md`: recommendation and review-trigger policy.
- `sensitive-code.md`: sensitive-code review and reporting boundaries.

## Does Not Own

- Agent instruction, host asset, or Qoder feature taxonomy; use
  `../coding-agent-practices/routing.md`.
- Combined Agent Work Loop evidence mapping; use
  `../../models/agent-work-loop.md#construct-task-episode-evidence`.
- Repeated-work owner selection; use `../loop-engineering/`.

## Read Next

- Use `review-trigger.md` for recommendation and review-trigger policy.
- Use `recovery-evidence.md` for rollback and recovery inspection.
- Use `sensitive-code.md` for sensitive-code review boundaries.
- Use `git-hooks.md` for Git hook lifecycle placement and evidence.
