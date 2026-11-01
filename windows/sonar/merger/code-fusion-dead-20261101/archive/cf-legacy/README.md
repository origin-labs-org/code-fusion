# @origin-ai/cf-popular-skells

**Supercharge your XHE (XEE Harness Enhanced) with 25+ battle-tested skills and slash commands inspired by Claude Code, Cursor, and Gauntlet-Loop patterns.**

## ✨ Features

### 🎯 Quality & Review
- `/review` - Comprehensive PR-style code review
- `/verify` - Convention compliance verification  
- `/audit` - Full codebase audit

### 🧪 Testing Suite
- `/test` - Generate unit/integration/e2e tests
- `/test-integration` - Integration test creation
- `/test-e2e` - End-to-end test scenarios
- `/test-coverage` - Coverage analysis & improvement

### 🔀 Git Workflow
- `/commit` - Smart conventional commit messages
- `/pr` - Pull request description generator
- `/changelog` - Automatic changelog generation

### 📝 Documentation
- `/docs` - Documentation from source code
- `/api-docs` - API documentation from types
- `/readme` - README generation/update

### 🔧 Code Improvement
- `/refactor` - Safe refactoring with tests
- `/migrate` - Code migration assistance
- `/optimize` - Performance optimization

### 🐛 Debugging
- `/debug` - Intelligent debug sessions
- `/error-analyze` - Deep error analysis
- `/fix` - Auto-fix with safety checks

### 🔒 Security
- `/security` - OWASP Top 10 + dependency scanning

### 🔄 Gauntlet Loop
- `/gauntlet` - Builder-Critic quality assurance loop

## 🚀 Quick Start

### Installation

This plugin is included in DSH's skill discovery system. Simply:

1. Clone XHE repository
2. Skills are auto-discovered from `.agents/skills/`
3. Commands registered via plugin system

```bash
cd /path/to/dsh
pnpm install && pnpm run build
pnpm xhe web  # Web UI with all commands available!
```

### Usage Examples

```bash
# In XHE CLI or Web UI:

/review                          # Review current changes
/test src/core/agent.ts          # Generate tests
/commit                          # Smart commit message
/debug --error "TypeError..."    # Debug error
/gauntlet --quality strict      # Run quality loop
/security --severity critical    # Security scan
/refactor src/utils.ts           # Safe refactoring
/pr                              # Generate PR description
```

## 🏗️ Architecture

```
cf-popular-skills/
├── src/
│   └── index.ts              # Plugin entry + command handlers
├── package.json              # Package manifest
└── README.md                 # This file

# Skills documentation lives in:
.agents/skills/cf-popular-skills/
├── SKILL.md                  # Main skill descriptor
├── commands/
│   ├── REGISTRY.md           # Full command reference
│   └── review.md             # Individual command docs
├── gauntlet-loop/
│   └── gauntlet-loop.md      # Gauntlet pattern docs
├── testing/
│   └── test-generation.md    # Testing workflow docs
├── git-workflow/
│   └── commit.md             # Git automation docs
├── debugging/
│   └── debug.md              # Debugging methodology
├── security/
│   └── security.md           # Security scanning docs
└── refactoring/
    └── refactor.md           # Refactoring patterns
```

## 🔄 Gauntlet-Loop Pattern

The crown jewel of this collection! Inspired by [Matt Shumer's Gauntlet-Loop](https://github.com/robonuggets/gauntlet-loop):

```
Goal → Split → BUILD → BLIND CRITIC → Compare → LOOP until WIN
```

**Key Innovation:** Critics are **blind** - they don't see builder's intent, only output vs criteria. This eliminates self-bias!

```bash
# Run gauntlet on any task
/gauntlet "Review auth system for vulnerabilities" --quality paranoid

# For test generation with quality guarantee
/gauntlet --type test --quality strict --max-iterations 5
```

## 🎯 Command Discovery

Type `/` in XHE Web UI to see autocomplete. Or run:

```bash
/help                    # Show all commands
/help testing            # Filter by category
/help review             # Find specific command
/status                  # Show session status
```

## 🔧 Integration Points

### Session Events
All commands emit structured session events for logging and replay:

```typescript
{
  type: 'skill/review/start',
  target: string,
  mode: 'strict' | 'standard',
  timestamp: number
}
```

### Tool Pipeline
Commands use existing XHE tools:
- `ctx.fs` for file operations
- `ctx.shell` for git/system commands
- `ctx.web` for external lookups
- Subagents for parallel processing

### Conventions Compliance
Every skill follows XHE conventions from AGENTS.md:
- Defensive patterns applied
- Effects properly disposed
- Type safety maintained
- JSDoc contracts documented

## 📊 Comparison: XHE Popular Skills vs Alternatives

| Feature | This Plugin | Claude Code | Cursor | Other |
|---------|-------------|-------------|--------|-------|
| Total Commands | 25+ | ~15 built-in | ~10 | Varies |
| Gauntlet Loop | ✅ Built-in | ❌ Manual | ❌ No | ❌ |
| Open Source | ✅ MIT | ❌ Proprietary | ❌ Proprietary | Mixed |
| Customizable | ✅ Fully | Limited | Limited | Varies |
| XHE Native | ✅ First-class | N/A | N/A | N/A |
| Skill Docs | ✅ Comprehensive | Basic | Minimal | Varies |

## 🛡️ Safety Features

1. **Dry Run Mode** - `/refactor --dry-run`, `/fix --dry-run`
2. **Abort Support** - All commands respect cancellation signal
3. **Session Logging** - Every action recorded for audit
4. **Test Verification** - Refactorings require passing tests
5. **Quality Gates** - Gauntlet enforces quality bars

## 🤝 Contributing

Want to add more skills? The pattern is simple:

1. Create SKILL.md in appropriate category
2. Add handler in `src/index.ts`
3. Register in commands array
4. Update this README

See existing implementations for examples.

## 📚 Related Resources

- [DSH Documentation](https://github.com/deepseek-ai/xhe)
- [Gauntlet-Loop Original](https://github.com/robonuggets/gauntlet-loop)
- [Claude Code Commands](https://docs.anthropic.com/en/docs/claude-code)
- [Conventional Commits](https://www.conventionalcommits.org)

## 📄 License

MIT © DeepSeek AI Community

---

**Built with ❤️ for the XHE community**
