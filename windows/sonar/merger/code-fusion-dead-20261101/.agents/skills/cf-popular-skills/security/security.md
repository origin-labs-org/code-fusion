name: cf-security
description: Use when user wants to scan for vulnerabilities, perform security audits, or check code for security issues. Covers OWASP Top 10, dependency vulnerabilities, and CF-specific security patterns.
---

# Security Skill (`/security`, `/audit`)

**Comprehensive security scanning that catches vulnerabilities before they reach production.**

## When to Use

- User says "security scan" or "check for vulnerabilities"
- Before releasing/deploying
- Code review with security focus
- Dependency update time
- Handling user input/authentication code

## Security Check Categories

### 1. OWASP Top 10 Coverage

| # | Vulnerability | Detection Pattern | Example |
|---|---------------|-------------------|---------|
| A01 | **Broken Access Control** | Missing auth checks, IDOR patterns | `getUser(id)` without `req.user` check |
| A02 | **Cryptographic Failures** | Hardcoded secrets, weak hashing | `password: "123456"`, MD5 usage |
| A03 | **Injection** | String concatenation in queries | `"SELECT * FROM " + input` |
| A04 | **Insecure Design** | Missing rate limits, no validation | Open endpoints without throttling |
| A05 | **Security Misconfig** | Verbose errors, debug mode | `stacktrace: true` in prod |
| A06 | **Vulnerable Components** | Outdated deps, known CVEs | `lodash@4.17.15` (prototype pollution) |
| A07 | **Auth Failures** | Weak passwords, no MFA | Password = "password" |
| A08 | **Data Integrity** | Unsigned deserialization, no HMAC | `JSON.parse(userInput)` |
| A09 | **Logging Failure** | Sensitive data in logs | Logging credit card numbers |
| A10 | **SSRF** | User-controlled URLs fetched | `fetch(userInput)` |

### 2. CF-Specific Security Patterns

#### Plugin Security
```typescript
// ❌ Insecure: Command injection via shell
const result = await ctx.shell.exec(`git ${userInput}`)

// ✅ Secure: Parameterized execution
const result = await ctx.shell.exec('git', ['log', '--oneline', '-n', userInput])
```

#### File System Security
```typescript
// ❌ Insecure: Path traversal
const filePath = path.join(baseDir, userPath)  // ../../etc/passwd

// ✅ Secure: Path resolution + validation
const resolved = path.resolve(baseDir, userPath)
if (!resolved.startsWith(baseDir)) {
  throw new Error('Path traversal detected')
}
```

#### Session/Event Security
```typescript
// ❌ Insecure: Exposing internals
sessionLog.append({ apiKey: secretKey })

// ✅ Secure: Redaction
sessionLog.append({ 
  apiKey: maskSecret(secretKey)  // ****1234
})
```

### 3. Dependency Vulnerability Scanning

```bash
# Check for known CVEs
npm audit
yarn audit

# Fix automatically
npm audit fix

# Check specific package
npm audit <package-name>
```

## Slash Commands

### /security
```bash
# Full security scan
/security

# Specific severity
/security --severity high,critical

# Target specific files
/security src/auth/ packages/credentials/

# OWASP category focus
/security --category injection,xss

# Include dependencies
/security --deps
```

**Output Format:**
```markdown
## Security Scan Report

### Summary
🔴 Critical: 2 | 🟠 High: 3 | 🟡 Medium: 5 | 🔵 Low: 8

### Critical Issues

| ID | File | Issue | CWE | Fix |
|----|------|-------|-----|-----|
| SEC-001 | src/shell/exec.ts:42 | Command Injection | CWE-78 | Use parameterized API |
| SEC-002 | packages/fs/local.ts:89 | Path Traversal | CWE-22 | Validate resolved path |

### Dependency Vulnerabilities

| Package | Version | Vulnerability | Severity | Fix |
|---------|---------|---------------|----------|-----|
| lodash | 4.17.15 | Prototype Pollution | 🟠 High | Upgrade to 4.17.21 |
| ws | 8.0.0 | DoS via memory | 🔴 Critical | Upgrade to 8.16.0 |

### Recommendations
1. [URGENT] Fix command injection in shell provider
2. Add input validation middleware
3. Update 2 critical dependencies
4. Implement security headers
5. Add rate limiting to API endpoints
```

### /audit (Security Mode)
```bash
# Full security audit
/audit --scope security

# Compliance focused
/audit --compliance soc2,gdpr

# With remediation steps
/audit --with-fixes
```

## Security Checklist

### Pre-Commit Checks
- [ ] No hardcoded secrets (keys, passwords, tokens)
- [ ] Input validation on all user inputs
- [ ] SQL/Command injection safe
- [ ] XSS prevention in web output
- [ ] CSRF protection on mutations
- [ ] Authentication checks on sensitive ops
- [ ] Rate limiting on public APIs
- [ ] Error messages don't leak info

### Pre-Release Checks
- [ ] Dependency audit clean (no high/critical)
- [ ] No debug/development code in build
- [ ] Environment variables documented
- [ ] CORS properly configured
- [ ] Security headers set
- [ ] HTTPS enforced
- [ ] Cookie flags secure (HttpOnly, SameSite)
- [ ] Logging doesn't include PII

### CF Plugin Security
- [ ] Shell commands use array syntax
- [ ] File paths validated against base dir
- [ ] Events don't contain secrets
- [ ] Effects disposed properly (no leaks)
- [ ] External requests validated
- [ ] Subagent prompts sanitized

## Common Vulnerability Patterns

### Pattern 1: Shell Injection
```typescript
// Vulnerable
async function gitCommand(branch: string) {
  return await exec(`git checkout ${branch}`)
}

// Safe
async function gitCommand(branch: string) {
  // Validate branch name format
  if (!/^[a-zA-Z0-9\/\-_.]+$/.test(branch)) {
    throw new Error('Invalid branch name')
  }
  return await exec('git', ['checkout', branch])
}
```

### Pattern 2: Prototype Pollution
```typescript
// Vulnerable
const merged = Object.assign({}, base, JSON.parse(userInput))

// Safe
import { mergeWithOptions } from 'deepmerge'
const merged = mergeWithOptions({
  // Prevent prototype pollution
  isMergeableObject: (obj) => obj && !Array.isArray(obj),
}, base, JSON.parse(userInput))
```

### Pattern 3: Regex DoS (ReDoS)
```typescript
// Vulnerable - catastrophic backtracking on evil input
const emailRegex = /^([a-z]+)+$/

// Safe - no backtracking
const emailRegex = /^[a-z]{1,64}$/
```

## Integration with CF Tools

This skill uses:
- `ctx.fs` for reading source files
- `ctx.shell` for running audit tools (npm audit, etc.)
- `ctx.web` for checking dependency databases
- Session events for logging findings

## Automated Fixes

When possible, suggest automated fixes:

```bash
# Auto-fix dependency vulns
npm audit fix --force  # Use carefully!

# Auto-add security lint rules
eslint --fix --rule "no-eval: error" .

# Auto-generate input validation
/generate-validation auth/routes.ts
```
