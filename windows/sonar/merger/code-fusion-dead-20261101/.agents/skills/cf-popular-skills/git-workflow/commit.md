name: cf-commit
description: Use when user wants to generate commit messages, create PRs, or manage git workflow. Analyzes changes and generates conventional commits.
---

# Git Workflow Skill (`/commit`, `/pr`, `/changelog`)

**Smart git automation that follows team conventions.**

## When to Use

- User says "commit this" or "generate commit message"
- After completing a feature/fix
- PR creation time
- Release preparation
- Changelog generation needed

## Conventional Commit Format

```
<type>(<scope>): <subject>

[optional body]

[optional footer(s)]
```

### Types
| Type | Description |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Formatting, no code change |
| `refactor` | Code change, no fix/feat |
| `perf` | Performance improvement |
| `test` | Adding/updating tests |
| `build` | Build system/dependencies |
| `ci` | CI configuration |
| `chore` | Maintenance tasks |
| `revert` | Revert previous commit |

### Scopes (CF-Specific)
- `core` - Core agent/session packages
- `llm` - LLM adapter changes
- `shell/fs/web` - Capability plugins
- `cli` - CLI application
- `web` - Web UI
- `skill` - Skill system
- `test` - Test infrastructure
- `docs` - Documentation

## Commit Message Generation Process

### 1. Analyze Changes
```bash
# Get staged changes
git diff --cached --stat

# Get diff content
git diff --cached

# Check branch context
git branch --show-current
git log --oneline -5
```

### 2. Categorize Changes
```javascript
// Analysis output structure
{
  type: 'feat',           // From types above
  scope: 'core',          // Affected package area
  subject: 'add session fork capability',
  body: 'Implements ctx.sessions.fork() for creating child sessions\nfrom a live parent session with boundary selection.',
  breaking: false,
  issues: ['123'],        // Related issue numbers
}
```

### 3. Generate Message
```
core(session): add session fork capability

Implements ctx.sessions.fork() for creating child sessions from 
a live parent session with boundary selection.

Closes #456
```

## Slash Commands

### /commit
```bash
# Auto-generate from staged changes
/commit

# With specific style
/commit --style conventional

# Include co-authors
/commit --coauthor "name <email>"

# Generate for unstaged too
/commit --all
```

### /pr (Pull Request)
```bash
# Generate PR from current branch
/pr

# With specific template
/pr --template CF_PR_TEMPLATE

# Target specific branch
/pr --target main

# Include screenshots/demos
/pr --with-demo
```

**PR Template:**
```markdown
## Description
[Clear summary of changes]

## Type of Change
- [ ] Bug fix (non-breaking)
- [ ] New feature (non-breaking)
- [ ] Breaking change (fix/feature)

## Testing
- [ ] Unit tests added/updated
- [ ] Integration tests pass
- [ ] Manual testing completed

## Checklist
- [ ] Follows CF conventions (AGENTS.md)
- [ ] No new warnings/errors
- [ ] Documentation updated
- [ ] Session events properly emitted
- [ ] Disposal patterns correct

## Screenshots (if applicable)
[Add demo GIFs/screenshots]
```

### /changelog
```bash
# Generate from git log
/changelog

# Since last tag
/changelog --since-tag v0.1.0

# For specific version
/changelog --version 0.2.0

# In specific format
/changelog --format keepachangelog
```

**Changelog Format (Keep a Changelog):**
```markdown
## [0.2.0] - 2026-08-22

### Added
- Session fork capability for multi-session workflows (#456)
- Blind evaluation mode for Gauntlet-Loop (#789)

### Changed
- Improved error messages in plugin loader (#123)
- Performance optimization in event dispatch (#456)

### Fixed
- Race condition in async disposal (#789)
- Memory leak in long-running sessions (#012)

### Security
- Added input validation to shell provider (#345)
```

## Integration with CF Hooks

This skill integrates with:
- **Pre-commit hooks**: Run quality checks before commit
- **Pre-push hooks**: Run tests before push
- **PR hooks**: Auto-review on PR open
- **Release hooks**: Auto-changelog on tag

## Quality Rules

1. ✅ Subject line < 72 characters
2. ✅ Imperative mood ("add" not "added")
3. ✅ No period at end of subject
4. ✅ Body wrapped at 80 characters
5. ✅ Explain WHAT and WHY, not HOW
6. ✅ Reference issues/PRs in footer

## Examples

### Good Commits
```
feat(core): add session fork capability

Allows agents to create child sessions for parallel task processing.
Implements boundary-based event selection for fork source.

Closes #456
```

```
fix(shell): resolve race condition in process cleanup

Process tree was being cleaned up before all child processes
terminated, causing zombie processes on Linux.

Fixes #789
```

### Bad Commits (Don't Do This)
```
# ❌ Too vague
fixed stuff

# ❌ Wrong format
Fixed the bug in session

# ❌ Too long subject
Add the ability to fork sessions so that we can do parallel processing of multiple tasks at the same time which is really cool

# ❌ Missing context
feat: new feature
```
