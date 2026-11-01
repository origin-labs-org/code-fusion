name: cf-review
description: Use when user wants to review code, PR, or changes. Performs comprehensive code review with quality checks, security analysis, and best practices validation.
---

# Code Review Skill (`/review`)

**Professional-grade code review that catches what linters miss.**

## When to Use

- User asks to "review" any code
- Before committing changes
- PR review requests
- Quality gate checks
- After refactoring

## Review Process

### Phase 1: Context Gathering
```bash
# Get changed files
git diff --name-only HEAD~1

# Get the actual diff
git diff HEAD~1

# Check for staged changes
git diff --cached --name-only
```

### Phase 2: Multi-Dimensional Analysis

#### 1. **Correctness Review**
- [ ] Logic errors and edge cases
- [ ] Off-by-one errors
- [ ] Null/undefined handling
- [ ] Race conditions in async code
- [ ] Error handling completeness

#### 2. **Security Review**  
- [ ] Injection vulnerabilities (SQL, XSS, command)
- [ ] Authentication/authorization gaps
- [ ] Sensitive data exposure
- [ ] Dependency vulnerabilities
- [ ] Input validation

#### 3. **Performance Review**
- [ ] N+1 query patterns
- [ ] Unnecessary computations in loops
- [ ] Memory leaks
- [ ] Missing caching opportunities
- [ ] Algorithm complexity issues

#### 4. **Maintainability Review**
- [ ] Naming clarity
- [ ] Function length (< 50 lines ideal)
- [ ] Duplication detection
- [ ] Magic numbers/constants
- [ ] Comment necessity

#### 5. **CF-Specific Conventions**
- [ ] Plugin protocol compliance
- [ ] Session event emission
- [ ] Cordis effect registration/disposal
- [ ] Type safety (no unsafe `any`)
- [ ] JSDoc contract documentation

### Phase 3: Output Format

```markdown
## Code Review Report

### Summary
[One-line verdict: ✅ Approve / ⚠️ Request Changes / ❌ Reject]

### Critical Issues (Must Fix)
| # | File:Line | Issue | Severity | Suggestion |
|---|-----------|-------|----------|------------|
| 1 | src/foo.ts:42 | Null pointer dereference | 🔴 Critical | Add null check |

### Suggestions (Should Fix)
| # | File:Line | Issue | Severity | Suggestion |
|---|-----------|-------|----------|------------|

### Nitpicks (Nice to Have)
| # | File:Line | Issue | Suggestion |
|---|-----------|-------|-----------|

### Positive Aspects
- [What's done well]

### Metrics
- Files reviewed: X
- Total issues: Y (Z critical)
- Estimated fix time: ~X min
```

## Integration with CF

This skill uses:
- `ctx.fs` for file reading
- `ctx.shell` for git commands
- Session events for logging review results
- Tool schema for structured output

## Example Invocation

```bash
# Review last commit
/review --target HEAD~1

# Review specific files
/review --files src/core/agent.ts packages/llm/

# Full PR review mode
/review --pr-url https://github.com/org/repo/pull/123
```

## Quality Bar

A good review must:
1. Find at least 1 real issue (or explain why code is clean)
2. Provide actionable suggestions, not just criticism
3. Prioritize by severity (critical > warning > nitpick)
4. Consider the codebase context and conventions
5. Be respectful but thorough
