# CONFLICT.md — skill/component name conflicts

Recorded while merging the claude-code-templates catalog
(github.com/davila7/claude-code-templates, MIT) on 2026-11-01.

Rules applied:
- A pre-existing payloads/skills entry wins; the incoming cct entry is
  skipped (not overwritten, not renamed).
- The cct catalog has the same skill name under two categories in a few
  cases; the first in category order wins and the rest are skipped.

## Existing payloads/skills vs incoming cct catalog

| Existing skill (kept) | Incoming cct entry (skipped) |
| --- | --- |
| `frontend-design` | `creative-design/frontend-design` (cct) |
| `web-design-guidelines` | `creative-design/web-design-guidelines` (cct) |
| `skill-creator` | `development/skill-creator` (cct) |
| `exa-search` | `web-development/exa-search` (cct) |

## Internal duplicates within the cct catalog

Same skill name appears under two categories in the source catalog.
First (alphabetical by category) wins; the rest are listed here.

| Kept (first category) | Skipped (later category) |
| --- | --- |

| `dispatching-parallel-agents` | `development/dispatching-parallel-agents` (later category, skipped) |
| `subagent-driven-development` | `development/subagent-driven-development` (later category, skipped) |
| `slack-gif-creator` | `enterprise-communication/slack-gif-creator` (later category, skipped) |
| `telegram-bot-builder` | `enterprise-communication/telegram-bot-builder` (later category, skipped) |
| `x-twitter-scraper` | `marketing/x-twitter-scraper` (later category, skipped) |
| `brainstorming` | `productivity/brainstorming` (later category, skipped) |
| `executing-plans` | `productivity/executing-plans` (later category, skipped) |
| `skill-creator` | `productivity/skill-creator` (later category, skipped) |
| `writing-plans` | `productivity/writing-plans` (later category, skipped) |
| `writing-skills` | `productivity/writing-skills` (later category, skipped) |
| `webapp-testing` | `security/webapp-testing` (later category, skipped) |
| `using-superpowers` | `utilities/using-superpowers` (later category, skipped) |
| `web-artifacts-builder` | `utilities/web-artifacts-builder` (later category, skipped) |
| `react-best-practices` | `web-development/react-best-practices` (later category, skipped) |
| `github-workflow-automation` | `workflow-automation/github-workflow-automation` (later category, skipped) |
| `planning-with-files` | `workflow-automation/planning-with-files` (later category, skipped) |

## Summary

- copied: 873
- skipped (existing wins): 4
- skipped (internal dupe): 16
