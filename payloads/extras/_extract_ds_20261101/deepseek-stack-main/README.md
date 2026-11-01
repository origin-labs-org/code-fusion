# deepseek-stack

Skills that make DeepSeek models (V4.1 Flash, V4 Pro) work like a much more expensive model. Cheap models usually fail in the same few ways: they skip the plan, claim a fix works without running it, retry a broken idea over and over, and drift on long runs. Each skill here closes one of those gaps with a short loop, a hard stop condition and a demand for real evidence.

It works in any harness that reads `SKILL.md` files: Claude Code, Codex, Cline, OpenCode, PandaCode and others.

## Install

```bash
npx skills add aicodeking/deepseek-stack
```

Add `-g` to install for every project. To install one skill only:

```bash
npx skills add aicodeking/deepseek-stack --skill ds-verify-loop
```

Manual install: copy `skills/*` into `~/.claude/skills/`, `~/.codex/skills/` or your harness's skills folder.

Not sure where to start? Run `/ds-help`.

## Skills

### Core

| Skill | What it does |
|---|---|
| `ds-mode` | Always-on working style: restate, read first, small verified steps, evidence before "done". |
| `ds-principles` | 21 engineering rules of thumb, each with a trigger. |
| `ds-help` | Picks the right skill for a task. |

### Loops

| Skill | What it does |
|---|---|
| `ds-plan-loop` | Plan with a check per step, critique once in a fresh pass, then build one step at a time. |
| `ds-verify-loop` | Edit, run the real check, read the real error, fix the root cause. Max 5 rounds. |
| `ds-unstick` | Same failure twice: name the shared assumption, test it, pick a different approach. |
| `ds-context-reset` | Keep a `PROGRESS.md` and continue in a fresh context when the run gets long. |
| `ds-ledger` | One row per decision for long or unattended runs, re-read before each step. |
| `ds-review-loop` | Author plus fresh-context reviewer until both agree. Max 4 rounds. |
| `ds-jury` | Reviews from two or three different models until they agree. |
| `ds-best-of-n` | N parallel attempts, pick the best, graft in the strong parts of the rest. |
| `ds-swarm` | Fan out parallel workers and merge their results into one report. |

### Build

| Skill | What it does |
|---|---|
| `ds-sharpen` | Restate the goal, make the task deeper, rewrite the prompt. |
| `ds-blueprint` | Types, signatures and module layout first, then implement. |
| `ds-tdd` | A failing test first, then the smallest fix. |
| `ds-blast-radius` | Find what a change could break outside its diff and prove it is safe. |
| `ds-design` | Build a frontend with a clear visual direction, not the generic AI look. |
| `ds-design-audit` | Score an existing UI with evidence, fix the top problems, re-check. |

### Ship

| Skill | What it does |
|---|---|
| `ds-pr` | File a short PR that leads with the problem. |
| `ds-watch-pr` | Watch CI and review bots, fix real findings. |
| `ds-ship` | From change to merged PR, unattended. |
| `ds-ready` | Same as `ds-ship`, but stops before the merge. |
| `ds-adopt` | Finish someone else's PR or branch and keep their credit. |
| `ds-revive` | Rebase an old PR, or decide it should be closed. |
| `ds-pr-comments` | Format comments an agent posts for you. |

### Understand

| Skill | What it does |
|---|---|
| `ds-explain` | How code works and why it is built that way, in plain words. |
| `ds-catchup` | What changed while you were away, and what is waiting on you. |
| `ds-lessons` | Turn repeated agent mistakes into types, lints or tests. |
| `ds-unslop` | Remove AI tells from prose and comments. |

## Tips for DeepSeek

- Use thinking mode at max effort for planning and review. It matters more than any skill.
- Run big jobs at off-peak hours, when the API price is lower.
- DeepSeek is cheap, so spend tokens on quality: `ds-best-of-n`, `ds-review-loop` and `ds-jury` cost little and catch a lot.
- Pair a stronger planner with DeepSeek as the implementer if your harness supports separate plan and act models.

## Requirements

- `gh` (GitHub CLI), signed in, for the Ship skills.
- `python3` for `ds-watch-pr/scripts/watch_pr.py`.
- Subagents or a second model for `ds-jury`, `ds-best-of-n` and `ds-swarm`. Without them, the skills run attempts one after another in fresh contexts.

## License

MIT
