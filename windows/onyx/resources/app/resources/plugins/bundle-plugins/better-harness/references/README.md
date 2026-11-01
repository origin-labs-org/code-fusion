# References

Human-readable guidance lives here when it does not need fixtures, schemas, or
runtime binding.

## Switchboard

- `coding-agent-practices/`: agent instruction, host asset, Skill shaping,
  session diagnostic, observability, and agent-hook guidance. Start with
  `coding-agent-practices/routing.md`.
- `loop-engineering/`: repeated-work and schedule-ready owner selection. Load
  this when a task may become a Skill, automation, hook, command, script,
  custom agent, MCP-backed loop, or rule.
- `reliable-delivery/`: acceptance evidence, change-review triggers,
  sensitive-code handling, and delivery recovery safeguards.
- `tool-runtimes/`: support contracts for runtime discovery and execution
  boundaries. These are not practice domains.

Detector and signal guidance stays with its owning model, executable
capability, or skill-local contract. Promote shared prose only when two visible
workflow consumers need the same owner; do not recreate a generic detector
bucket.

## Historical Paths

- `references/coding-agent-practices/` is the canonical coding-agent guidance
  path.
- `references/coding-agent-practises/` was the historical misspelled path. Do
  not recreate it; update references to the canonical path.
- `references/harness-practises/` was the historical misspelled harness path.
  Do not recreate it; use `references/reliable-delivery/`.
- `references/harness-engineering/` was the former broad name for the narrower
  Reliable Delivery domain. Do not recreate it; use
  `references/reliable-delivery/`.
