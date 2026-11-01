name: cf-popular-skills
description: Collection of 20+ popular Claude Code-style skills and slash commands for CF (CodeFusion). Includes code review, testing, git workflow, debugging, Gauntlet-Loop pattern, and more. Use when user wants powerful AI coding agent capabilities.
---

# CF Popular Skills Collection

**Supercharge your CF experience with 20+ battle-tested skills inspired by Claude Code, Cursor, and Gauntlet-Loop patterns.**

## Available Skills & Commands

### 🎯 Quality & Review
| Command/Skill | Description |
|--------------|-------------|
| `/review` | Full PR-style code review |
| `/verify` | Automated code verification |
| `/audit` | Complete codebase audit |

### 🧪 Testing
| Command/Skill | Description |
|--------------|-------------|
| `/test` | Generate unit tests |
| `/test-integration` | Integration test creation |
| `/test-e2e` | End-to-end test generation |
| `/test-coverage` | Improve test coverage |

### 🔀 Git Workflow
| Command/Skill | Description |
|--------------|-------------|
| `/commit` | Auto-generate commit messages |
| `/pr` | Create PR descriptions |
| `/changelog` | Generate changelogs |

### 📝 Documentation
| Command/Skill | Description |
|--------------|-------------|
| `/docs` | Generate documentation |
| `/api-docs` | API documentation |
| `/readme` | Update README files |

### 🔧 Refactoring
| Command/Skill | Description |
|--------------|-------------|
| `/refactor` | Safe refactoring with tests |
| `/migrate` | Code migration assistance |
| `/optimize` | Performance optimization |

### 🐛 Debugging
| Command/Skill | Description |
|--------------|-------------|
| `/debug` | Intelligent debugging workflow |
| `/error-analyze` | Error log analysis |
| `/fix` | Auto-fix identified issues |

### 🔒 Security
| Command/Skill | Description |
|--------------|-------------|
| `/security` | Security vulnerability scan |
| `/audit` | Full security audit |

### 🔄 Gauntlet Loop
| Command/Skill | Description |
|--------------|-------------|
| `/gauntlet` | Run Builder-Critic quality loop |

---

## Quick Start

```bash
# In CF Web UI or CLI, use:
/review          # Review current changes
/test            # Generate tests for selected file
/commit          # Auto-generate commit message
/gauntlet        # Run quality loop on current task
/debug           # Debug the current issue
```

## Individual Skill Documentation

Each skill has its own detailed documentation:
- See `commands/` for slash command implementations
- See `gauntlet-loop/` for the Builder-Critic pattern
- See `testing/` for testing workflows
- See `git-workflow/` for Git automation
- See `documentation/` for doc generation
- See `refactoring/` for safe code changes
- See `debugging/` for issue resolution
- See `security/` for vulnerability scanning
- See `optimization/` for performance tuning

## Integration Notes

These skills work with CF's native:
- **Skill System**: Auto-discovered via `.agents/skills/`
- **Command Registry**: Registered as slash commands via `ctx.commands`
- **Tool Pipeline**: Uses existing shell/fs/web tools
- **Session Log**: All actions logged for replay

## Quality Guarantees

Every skill follows CF conventions:
- ✅ Defensive patterns applied
- ✅ Session events emitted
- ✅ Model-visible = logged invariant
- ✅ Abort signal handling
- ✅ Error boundaries respected

## Credits

Inspired by:
- [Claude Code](https://claude.ai/code) command patterns
- [Gauntlet-Loop](https://github.com/robonuggets/gauntlet-loop) by Matt Shumer
- Community best practices from awesome-claude-code
