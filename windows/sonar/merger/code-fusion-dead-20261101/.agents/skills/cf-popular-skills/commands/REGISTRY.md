# CF Popular Skills - Slash Commands Registry

This document defines all slash commands for the `cf-popular-skills` collection.
Commands are registered via `ctx.commands.register()` in CF's interaction system.

## Command Registration Format

Each command follows this structure:

```typescript
// In your plugin's apply()
ctx.commands.register({
  name: 'command-name',           // lowercase, no slashes
  description: 'Human-readable summary',
  input: {
    hint: 'Optional usage hint',
    images: false                 // accepts image attachments?
  },
  handler: async (invocation) => {
    const { agent, rawInput, signal } = invocation
    
    // Your command logic here
    return {
      kind: 'success',
      text: 'Result text shown to user'
    }
  }
})
```

## Available Commands

### 🎯 Quality & Review Commands

#### /review
```typescript
{
  name: 'review',
  description: 'Run comprehensive code review on changes or files',
  input: { 
    hint: '[--files path...] [--pr-url url] [--strict]',
    images: false 
  },
  handler: reviewHandler
}
```
**Usage Examples:**
```bash
/review                          # Review staged changes
/review --files src/core/        # Review specific files
/review --pr-url https://...     # Review PR
/review --strict                 # Strict mode
```

#### /verify
```typescript
{
  name: 'verify',
  description: 'Verify code quality and conventions compliance',
  input: { 
    hint: '[--target file|directory]',
    images: false 
  },
  handler: verifyHandler
}
```

#### /audit
```typescript
{
  name: 'audit',
  description: 'Full codebase audit for issues and improvements',
  input: { 
    hint: '[--scope security|performance|all]',
    images: false 
  },
  handler: auditHandler
}
```

---

### 🧪 Testing Commands

#### /test
```typescript
{
  name: 'test',
  description: 'Generate tests for specified code or files',
  input: { 
    hint: '<file-or-directory> [--type unit|integration|e2e] [--coverage]',
    images: false 
  },
  handler: testHandler
}
```
**Usage Examples:**
```bash
/test src/core/agent.ts                    # Unit tests
/test packages/api/ --type integration     # Integration tests
/test examples/ --type e2e                # E2E tests
/test src/llm/ --coverage                 # Coverage focused
```

#### /test-integration
```typescript
{
  name: 'test-integration',
  description: 'Generate integration tests with real dependencies mocked',
  input: { 
    hint: '<target>',
    images: false 
  },
  handler: testIntegrationHandler
}
```

#### /test-e2e
```typescript
{
  name: 'test-e2e',
  description: 'Generate end-to-end test scenarios',
  input: { 
    hint: '<feature-or-flow>',
    images: false 
  },
  handler: testE2EHandler
}
```

#### /test-coverage
```typescript
{
  name: 'test-coverage',
  description: 'Analyze and improve test coverage',
  input: { 
    hint: '[--target dir] [--threshold 80]',
    images: false 
  },
  handler: testCoverageHandler
}
```

---

### 🔀 Git Workflow Commands

#### /commit
```typescript
{
  name: 'commit',
  description: 'Generate conventional commit message from changes',
  input: { 
    hint: '[--style conventional] [--coauthor email] [--all]',
    images: false 
  },
  handler: commitHandler
}
```
**Usage Examples:**
```bash
/commit                          # Staged changes only
/commit --all                   # Include unstaged
/commit --coauthor "dev@example.com"
```

#### /pr
```typescript
{
  name: 'pr',
  description: 'Generate pull request description from branch changes',
  input: { 
    hint: '[--target branch] [--template name] [--with-demo]',
    images: true 
  },
  handler: prHandler
}
```

#### /changelog
```typescript
{
  name: 'changelog',
  description: 'Generate changelog from git history',
  input: { 
    hint: '[--since-tag tag] [--version ver] [--format keepachangelog]',
    images: false 
  },
  handler: changelogHandler
}
```

---

### 📝 Documentation Commands

#### /docs
```typescript
{
  name: 'docs',
  description: 'Generate documentation from source code',
  input: { 
    hint: '<file-or-directory> [--format markdown|jSDoc]',
    images: false 
  },
  handler: docsHandler
}
```

#### /api-docs
```typescript
{
  name: 'api-docs',
  description: 'Generate API documentation from type definitions',
  input: { 
    hint: '<package-or-file>',
    images: false 
  },
  handler: apiDocsHandler
}
```

#### /readme
```typescript
{
  name: 'readme',
  description: 'Update or generate README.md for project/package',
  input: { 
    hint: '[--path dir] [--section install|usage|api]',
    images: false 
  },
  handler: readmeHandler
}
```

---

### 🔧 Refactoring Commands

#### /refactor
```typescript
{
  name: 'refactor',
  description: 'Safe refactoring with automatic test generation',
  input: { 
    hint: '<file> [--pattern extract|rename|simplify]',
    images: false 
  },
  handler: refactorHandler
}
```
**Usage Examples:**
```bash
/refactor src/utils.ts --pattern extract   # Extract functions
/refactor src/types.ts --pattern rename    # Rename types
/refactor src/old.ts --pattern simplify    # Simplify logic
```

#### /migrate
```typescript
{
  name: 'migrate',
  description: 'Assist with code migration between versions/frameworks',
  input: { 
    hint: '--from <source> --to <target> <files...>',
    images: false 
  },
  handler: migrateHandler
}
```
**Example:** `/migrate --from commonjs --to esm src/`

#### /optimize
```typescript
{
  name: 'optimize',
  description: 'Performance optimization analysis and suggestions',
  input: { 
    hint: '<file-or-profile>',
    images: false 
  },
  handler: optimizeHandler
}
```

---

### 🐛 Debugging Commands

#### /debug
```typescript
{
  name: 'debug',
  description: 'Start intelligent debugging session',
  input: { 
    hint: '[--error "message"] [--file path:line] [--verbose]',
    images: false 
  },
  handler: debugHandler
}
```
**Usage Examples:**
```bash
/debug                                           # Interactive mode
/debug --error "TypeError: Cannot read..."       # With error
/debug --file src/session.ts:142                # With location
/debug --verbose                                # Detailed analysis
```

#### /error-analyze
```typescript
{
  name: 'error-analyze',
  description: 'Deep analysis of error message or log',
  input: { 
    hint: '"<error>" | --file <log-file>',
    images: false 
  },
  handler: errorAnalyzeHandler
}
```

#### /fix
```typescript
{
  name: 'fix',
  description: 'Auto-fix identified issues safely',
  input: { 
    hint: '[--strategy safe|aggressive] [--dry-run] [--commit]',
    images: false 
  },
  handler: fixHandler
}
```

---

### 🔒 Security Commands

#### /security
```typescript
{
  name: 'security',
  description: 'Security vulnerability scan and analysis',
  input: { 
    hint: '[--target file|dir] [--severity low|medium|high|critical]',
    images: false 
  },
  handler: securityHandler
}
```

---

### 🔄 Gauntlet Loop Commands

#### /gauntlet
```typescript
{
  name: 'gauntlet',
  description: 'Run Builder-Critic quality loop for highest quality output',
  input: { 
    hint: '<goal> [--quality quick|standard|strict|paranoid] [--max-iterations N] [--type code|review|test|docs]',
    images: false 
  },
  handler: gauntletHandler
}
```
**Usage Examples:**
```bash
/gauntlet                                         # Current task
/gauntlet "Review auth system" --quality strict   # Specific goal
/gauntlet --type test --quality paranoid          # Test generation
/gauntlet --max-iterations 3                      # Limit iterations
```

---

## Utility Commands

#### /help
```typescript
{
  name: 'help',
  description: 'Show available commands and skills',
  input: { 
    hint: '[command-name]',
    images: false 
  },
  handler: helpHandler
}
```

#### /clear
```typescript
{
  name: 'clear',
  description: 'Clear conversation context',
  input: undefined,
  handler: clearHandler
}
```

#### /compact
```typescript
{
  name: 'compact',
  description: 'Compress context to save tokens while preserving key info',
  input: { 
    hint: '[--keep N]  Keep last N messages uncompressed',
    images: false 
  },
  handler: compactHandler
}
```

#### /cost
```typescript
{
  name: 'cost',
  description: 'Show token usage and estimated cost for session',
  input: undefined,
  handler: costHandler
}
```

#### /status
```typescript
{
  name: 'status',
  description: 'Show current session status and agent state',
  input: undefined,
  handler: statusHandler
}
```

## Implementation Notes

### Handler Best Practices

1. **Always handle abort signal**
```typescript
handler: async ({ signal, ... }) => {
  const result = await longOperation({ signal })
  if (signal.aborted) return { kind: 'error', text: 'Cancelled' }
  return { kind: 'success', text: result }
}
```

2. **Return structured results**
```typescript
return {
  kind: 'success',       // or 'error'
  text: 'Human readable output',
  // Optional:
  sourceEventSeq: 123    // Reference to logged event
}
```

3. **Log to session for complex commands**
```typescript
handler: async ({ agent }) => {
  // Log command start
  await agent.session.append({
    type: 'custom-command/start',
    command: 'my-command',
    timestamp: Date.now()
  })
  
  // ... do work ...
  
  return { kind: 'success', text: 'Done!' }
}
```

### Command Discovery

Users can discover all commands by:
- Typing `/` in Web UI (shows autocomplete)
- Running `/help` for full list
- Checking command registry via API

### Extending Commands

To add custom commands:
1. Create new skill in `.agents/skills/`
2. Add SKILL.md with documentation
3. Register command in plugin
4. Add handler implementation

## Quick Reference Card

```
┌─────────────────────────────────────────────────────────────┐
│                  CF COMMANDS QUICK REF                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  QUALITY          TESTING         GIT                        │
│  ─────────        ────────        ───                        │
│  /review          /test           /commit                    │
│  /verify          /test-integ     /pr                        │
│  /audit           /test-e2e       /changelog                 │
│                   /test-cov                                  │
│  DOCS             REFACTOR       DEBUG                       │
│  ────             ────────        ─────                      │
│  /docs            /refactor       /debug                     │
│  /api-docs        /migrate        /error-analyze             │
│  /readme          /optimize       /fix                       │
│                                                              │
│  SECURITY         GAUNTLET        UTILS                      │
│  ────────         ────────        ─────                      │
│  /security        /gauntlet       /help                      │
│                                   /clear                     │
│                                   /compact                   │
│                                   /cost                      │
│                                   /status                    │
│                                                              │
│  Total: 25+ commands                                       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```
