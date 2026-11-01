name: cf-refactor
description: Use when user wants to refactor code safely, optimize performance, or migrate between patterns. Ensures tests pass and behavior is preserved during refactoring.
---

# Refactoring Skill (`/refactor`, `/migrate`, `/optimize`)

**Safe refactoring with test verification and behavior preservation guarantees.**

## When to Use

- User says "refactor this" or "clean up code"
- Code complexity too high
- Duplications detected
- Performance issues identified
- Need to update patterns/dependencies
- Technical debt reduction

## Refactoring Principles

### The Golden Rules
1. **Behavior Never Changes** (tests prove it)
2. **Small Steps** (one logical change per commit)
3. **Test Coverage First** (if < 80%, add tests first)
4. **Commit After Each Step** (easy rollback)
5. **Run Tests Continuously** (catch regressions early)

## Refactoring Patterns

### Pattern 1: Extract Function/Module
```typescript
// Before: Monolithic function
async function processUser(req: Request, res: Response) {
  // 150 lines of mixed concerns...
  const user = await db.find(req.params.id)
  if (!user) return res.status(404).send('Not found')
  // validation logic (20 lines)
  // business logic (50 lines)
  // response formatting (30 lines)
  // logging (10 lines)
  // error handling (40 lines)
}

// After: Decomposed
async function processUser(req: Request, res: Response) {
  const user = await findUserOrThrow(req.params.id)
  const validated = validateUserInput(user, req.body)
  const result = await applyBusinessRules(validated)
  logProcessing(result)
  return formatResponse(res, result)
}
```

### Pattern 2: Extract Interface (for testing)
```typescript
// Before: Concrete dependency (hard to test)
class AgentService {
  private db = new DatabaseClient()  // ❌ Can't mock
  
  async getUser(id: string) {
    return this.db.query('SELECT * FROM users WHERE id = ?', [id])
  }
}

// After: Interface + DI (testable)
interface IUserRepository {
  findById(id: string): Promise<User | null>
}

class AgentService {
  constructor(private repo: IUserRepository) {}  // ✅ Injectable
  
  async getUser(id: string) {
    return this.repo.findById(id)
  }
}

// Test with mock
const service = new AgentService(mockRepo)
```

### Pattern 3: Replace Conditional with Polymorphism
```typescript
// Before: Complex conditionals
function executeTool(tool: Tool, input: any) {
  if (tool.type === 'shell') {
    return execShell(input.command)
  } else if (tool.type === 'fs') {
    return fsOperation(input.path, input.action)
  } else if (tool.type === 'web') {
    return fetchUrl(input.url)
  } else {
    throw new Error(`Unknown tool: ${tool.type}`)
  }
}

// After: Strategy pattern
interface ToolExecutor {
  type: string
  execute(input: any): Promise<any>
}

class ShellTool implements ToolExecutor {
  type = 'shell'
  execute(input: CommandInput) { return execShell(input.command) }
}

class FsTool implements ToolExecutor {
  type = 'fs'
  execute(input: FsInput) { return fsOperation(input.path, input.action) }
}

// Registry pattern
const executors = new Map<string, ToolExecutor>()
executors.set('shell', new ShellTool())
executors.set('fs', new FsTool())

async function executeTool(toolType: string, input: any) {
  const executor = executors.get(toolType)
  if (!executor) throw new Error(`Unknown tool: ${toolType}`)
  return executor.execute(input)
}
```

### Pattern 4: Simplify Conditional Logic
```typescript
// Before: Nested complexity
function canAccess(user: User, resource: Resource): boolean {
  if (user) {
    if (user.role === 'admin') {
      return true
    } else if (user.role === 'editor') {
      if (resource.ownerId === user.id) {
        return true
      } else if (resource.isPublic) {
        return true
      } else {
        return false
      }
    } else {
      return resource.isPublic && !resource.restricted
    }
  } else {
    return false
  }
}

// After: Early returns + clear conditions
function canAccess(user: User, resource: Resource): boolean {
  if (!user) return false
  
  // Admins have full access
  if (user.role === 'admin') return true
  
  // Editors can access own or public resources
  if (user.role === 'editor') {
    return resource.ownerId === user.id || resource.isPublic
  }
  
  // Others can only access public, non-restricted resources
  return resource.isPublic && !resource.restricted
}
```

## Slash Commands

### /refactor
```bash
# Analyze and suggest refactorings for file
/refactor src/core/agent-loop.ts

# Specific pattern
/refactor src/utils/helpers.ts --pattern extract

# With test generation
/refactor src/api/handlers.ts --with-tests

# Dry run (show what would change)
/refactor src/session/store.ts --dry-run

# Complexity focused
/refactor src/ --complexity-threshold 15
```

**Output Format:**
```markdown
## Refactoring Analysis

### Metrics Before
- Cyclomatic Complexity: 24 (🔴 High)
- Cognitive Load: High (18/20)
- Lines of Code: 450
- Duplication: 12% detected
- Test Coverage: 65%

### Suggested Refactorings

| # | Pattern | Location | Impact | Risk |
|---|---------|----------|--------|------|
| 1 | Extract Method | `agent-loop.ts:120-180` | -8 complexity | Low |
| 2 | Extract Interface | `session.ts:45` | +testability | Low |
| 3 | Replace Conditional | `tools.ts:89-145` | -5 complexity | Medium |

### Estimated Effort
- Total changes: 3 files
- New files: 1 (extracted module)
- Tests to update: 4
- Estimated time: ~45 min

### Safe Execution Plan
1. ✅ Add tests for current behavior (preserve correctness)
2. ⬜ Extract `processStep()` from agent-loop.ts
3. ⬜ Run tests (verify no regression)
4. ⬜ Commit: "refactor(core): extract processStep from agent loop"
5. ⬜ Continue with next refactoring...

Ready to proceed? [Start] [Skip] [Cancel]
```

### /migrate
```bash
# Migrate CommonJS to ESM
/migrate --from cjs --to esm src/

# Migrate callbacks to async/await
/migrate --from callbacks --to async packages/llm/

# Migrate from old API version
/migrate --from v1 --to v2 packages/api/

# Framework migration
/migrate --from express --to fastify apps/web/

# Dependency migration
/migrate --from lodash --from es-toolkit utils/
```

### /optimize
```bash
# Profile performance bottlenecks
/optimize src/core/agent.ts

# Memory optimization
/optimize --memory packages/session/

# Throughput optimization
/optimize --throughput packages/api/

# Bundle size optimization
/optimize --bundle apps/cli/
```

## Safety Checklist

Before declaring refactoring complete:

### Correctness
- [ ] All existing tests still pass
- [ ] No behavioral changes (compare inputs/outputs)
- [ ] Edge cases handled identically
- [ ] Error scenarios produce same results

### Quality
- [ ] Complexity reduced (or maintained)
- [ ] Naming improved
- [ ] Documentation updated
- [ ] Type safety maintained/improved

### CF-Specific
- [ ] Plugin protocol unchanged (or properly versioned)
- [ ] Session events still emitted correctly
- [ ] Effects disposed properly
- [ ] No new `any` types introduced
- [ ] JSDoc contracts updated

## Anti-Patterns to Avoid

```typescript
// ❌ Big Bang Refactoring (don't do this!)
// Changing everything at once without tests

// ✅ Incremental Refactoring
// Small steps, each tested and committed

// ❌ Refactoring Without Understanding
// Changing code you don't fully understand

// ✅ Refactor Only What You Know
// Focus on well-understood areas first

// ❌ Optimizing Prematurely
// Refactoring for performance that isn't a bottleneck

// ✅ Data-Driven Optimization
// Profile first, then optimize hot paths
```

## Integration with Other Skills

Refactoring works best combined with:
- `/test` → Verify behavior preserved
- `/review` → Check quality of refactored code
- `/gauntlet` → Ensure high-quality output
- `/commit` → Commit each safe step

Example workflow:
```bash
/test src/core/agent.ts          # Ensure coverage > 80%
/refactor src/core/agent.ts     # Apply refactorings
/test src/core/agent.ts         # Verify tests still pass
/review                         # Review changes
/gauntlet                      # Final quality check
/commit                         # Commit clean diff
```
