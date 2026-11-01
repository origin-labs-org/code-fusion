name: cf-debug
description: Use when user wants to debug issues, analyze errors, or fix bugs. Provides intelligent debugging workflow with root cause analysis.
---

# Debugging Skill (`/debug`, `/error-analyze`, `/fix`)

**Systematic debugging that finds root causes, not just symptoms.**

## When to Use

- User reports a bug or error
- "Debug this" or "fix this" requests
- Error logs provided
- Unexpected behavior observed
- Tests failing

## Debugging Methodology: The 5 Whys + Evidence

### Phase 1: Error Triage
```bash
# Capture error context
1. What is the exact error message?
2. When does it occur? (always? intermittent?)
3. What changed recently?
4. Who/what is affected?
5. Reproduction steps?
```

### Phase 2: Root Cause Analysis (5 Whys)
```
Problem: Session not persisting to disk

Why 1? → Write operation fails
Why 2? → File system returns EACCES  
Why 3? → Process lacks write permissions
Why 4? → Sandbox restricts to read-only dir
Why 5? → Config sets workspace as /tmp which is cleaned up

ROOT CAUSE: Sandbox config points to ephemeral directory
FIX: Configure persistent workspace path
```

### Phase 3: Evidence Gathering
```typescript
// Types of evidence to collect
interface DebugEvidence {
  // Direct evidence
  errorLogs: string[]           // Stack traces, messages
  consoleOutput: string         // stdout/stderr
  networkRequests: RequestLog[] // Failed API calls
  
  // Contextual evidence
  gitDiff: string               // Recent changes
  environment: EnvInfo          // Node version, OS, etc.
  stateSnapshots: object[]      // Variable states at crash
  
  // Corroborating evidence
  similarIssues: IssueLink[]    // GitHub issues, StackOverflow
  reproductionScript: string    // Minimal repro case
}
```

## Slash Commands

### /debug
```bash
# Start debug session for current issue
/debug

# With error log
/debug --error "TypeError: Cannot read property 'x' of undefined"

# With file context
/debug --file src/core/session.ts --line 142

# Verbose mode (more analysis)
/debug --verbose
```

### /error-analyze
```bash
# Analyze specific error
/error-analyze "Error: EACCES: permission denied, open '/data/session.db'"

# From log file
/error-analyze --file logs/error.log

# Multiple errors
/error-analyze --errors error1 error2 error3
```

**Analysis Output Format:**
```markdown
## Error Analysis Report

### Error Classification
- **Type**: PermissionError
- **Severity**: 🔴 Critical (blocks functionality)
- **Category**: I/O Error
- **Frequency**: 100% (consistent)

### Technical Breakdown
```
Error: EACCES: permission denied, open '/data/session.db'
       ^^^^^                  ^^^                 ^^^^^^^^^^^^
       |                      |                   |
    Error Code            Operation           Target Path
```

### Root Cause (5 Whys Deep)
1. **Direct Cause**: File system denied write access
2. **Why?**: Process UID lacks permissions on /data/
3. **Why?**: Running as non-root user in container
4. **Why?**: Dockerfile drops privileges (good!)
5. **Why?**: /data volume mounted as root-owned (bug!)

**ROOT CAUSE**: Volume mount has wrong ownership

### Fix Options
| Option | Risk | Effort | Recommendation |
|--------|------|--------|----------------|
| A. Fix volume mount | Low | 5 min | ✅ **DO THIS** |
| B. Change data dir | Medium | 15 min | Workaround |
| C. Run as root | High | 1 min | ❌ Security risk |

### Prevention
- [ ] Add startup permission check
- [ ] Document required permissions
- [ ] Add health check for data dir
```

### /fix
```bash
# Auto-fix identified issue
/fix

# With specific fix strategy
/fix --strategy safe  # Only non-breaking fixes

# Dry run first (show what would change)
/fix --dry-run

# Create fix commit directly
/fix --commit
```

## Debugging Patterns by Category

### Pattern 1: Async Race Condition
```typescript
// Symptom: Intermittent failure, "sometimes works"
// Diagnosis:
async function raceCondition() {
  const data = await fetchData()  // ← May resolve out of order
  processData(data)               // ← Uses stale/wrong data
}

// Detection:
// 1. Add logging with timestamps
// 2. Check Promise ordering
// 3. Look for missing await

// Fix:
async function fixedVersion() {
  const [data1, data2] = await Promise.all([
    fetchData1(),
    fetchData2()  // Parallel but ordered
  ])
  processData(data1, data2)  // Correct order guaranteed
}
```

### Pattern 2: Memory Leak
```typescript
// Symptom: Memory grows over time, eventual OOM
// Diagnosis:
// Check for:
// - Event listeners never removed
// - Caches without size limits
// - Closures capturing large objects
// - Timers/intervals never cleared

// Fix:
class LeakFree {
  private listeners: Map<string, Function[]> = new Map()
  
  on(event: string, fn: Function): () => {
    // ... register
    
    // Return disposal function
    return () => this.off(event, fn)  // ✅ Cleanup handle
  }
  
  dispose() {
    this.listeners.clear()  // ✅ Full cleanup
    clearInterval(this.interval)  // ✅ Clear timers
  }
}
```

### Pattern 3: Null/Undefined Access
```typescript
// Symptom: "Cannot read X of undefined/null"
// TypeScript strict mode catches these!

// Bad:
function bad(user: User) {
  return user.address.city.toUpperCase()  // 💥 if address undefined
}

// Good (defensive):
function good(user: User) {
  return user?.address?.city?.toUpperCase() ?? 'UNKNOWN'  // ✅ Safe
}

// Best (with validation):
function best(user: User) {
  if (!user.address) {
    throw new ValidationError('User must have address')
  }
  return user.address.city.toUpperCase()  // ✅ Explicit fail fast
}
```

### Pattern 4: Plugin Disposal Bug (CF Specific)
```typescript
// Symptom: "Service already registered" or memory leaks after reload
// Common in CF plugins:

// Bad Plugin:
export class BadPlugin {
  apply(ctx: Context) {
    ctx.effects.push(() => {
      // Missing cleanup!
    })
    
    ctx.on('event', handler)  // Never removed!
  }
}

// Good Plugin:
export class GoodPlugin implements Disposable {
  private disposers: Array<() => void> = []
  
  apply(ctx: Context) {
    // Register effect with cleanup
    this.disposers.push(
      ctx.effect(() => ({ /* service */ }), () => {
        // Proper disposal
      })
    )
    
    // Register event with removal
    const handler = () => { /* ... */ }
    ctx.on('event', handler)
    this.disposers.push(() => ctx.off('event', handler))
  }
  
  dispose() {
    // Run all cleanup in reverse order
    this.disposers.reverse().forEach(fn => fn())
    this.disposers = []
  }
}
```

## Debug Checklist

Before declaring "fixed", verify:

### Immediate Verification
- [ ] Error no longer occurs
- [ ] No new errors introduced
- [ ] Related functionality still works

### Regression Testing
- [ ] Unit tests pass (including new ones for this bug)
- [ ] Integration tests pass
- [ ] Manual test in dev environment

### Long-term Prevention
- [ ] Root cause addressed (not just symptom)
- [ ] Test added to prevent recurrence
- [ ] Documentation updated if needed
- [ ] Similar code audited for same pattern

### CF-Specific Checks
- [ ] Session events properly emitted
- [ ] Effects properly disposed
- [ ] No type errors introduced
- [ ] Conventions followed (AGENTS.md)

## Integration with CF Tools

This skill uses:
- `ctx.fs` for reading source files and logs
- `ctx.shell` for running diagnostic commands
- `ctx.session` for logging debug findings
- Subagent capability for parallel investigation

## Example Full Debug Session

```bash
User: /debug --error "SessionEventMap member is required-on-read"

CF: 🐛 Starting debug session...
     Analyzing error: SessionEventMap member is required-on-read
     
     Phase 1: Locating Error
     └── Found at packages/core/session/src/events.ts:45
     
     Phase 2: Understanding Context
     ├── This event is emitted but not in SessionEventMap type
     ├── Event was added in PR #123 but types not updated
     └── Type check should have caught this!
     
     Phase 3: Root Cause
     └── Developer added event emission without updating type union
     
     Phase 4: Proposed Fix
     ├── Add event to SessionEventMap interface
     ├── Add corresponding render function
     └── Add snapshot test for new event type
     
     Ready to apply fix? [Y/n]
     
User: Y

CF: ✅ Fix applied!
     - Updated packages/core/session/src/types.ts
     - Added render function in packages/core/session/src/render.ts
     - Added snapshot test
     - All checks passing
     
     Want me to commit this? /commit
```
