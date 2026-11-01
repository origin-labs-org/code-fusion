name: cf-test
description: Use when user wants to generate tests, improve test coverage, or create test suites. Supports unit, integration, and e2e testing patterns.
---

# Test Generation Skill (`/test`)

**Generate production-quality tests that actually catch bugs.**

## When to Use

- User says "write tests for this"
- New feature implementation needs test coverage
- Existing code lacks tests
- Bug fix needs regression test
- Coverage requirements not met

## Test Generation Philosophy

### Principles
1. **Test Behavior, Not Implementation**
   - ✅ `should return user when found`
   - ❌ `should call getUserById with 123`

2. **Arrange-Act-Assert Pattern**
   ```typescript
   it('should handle edge case', () => {
     // Arrange
     const input = { ... }
     
     // Act  
     const result = await functionUnderTest(input)
     
     // Assert
     expect(result).toEqual(expected)
   })
   ```

3. **Test Categories**
   - **Happy Path**: Normal operation
   - **Edge Cases**: Boundary values, empty inputs
   - **Error Cases**: Invalid inputs, failures
   - **Integration**: Real dependencies (mocked network)
   - **E2E**: Full system flow

## Supported Test Frameworks

### Vitest (CF Default)
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('ModuleName', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('functionName', () => {
    it('should handle normal case', async () => {
      // Arrange
      const mockDep = vi.fn().mockResolvedValue({ data: 'test' })
      
      // Act
      const result = await targetFunction(mockDep)
      
      // Assert
      expect(result).toBeDefined()
      expect(mockDep).toHaveBeenCalledOnce()
    })

    it('should throw on invalid input', async () => {
      await expect(targetFunction(invalidInput))
        .rejects.toThrow(ValidationError)
    })
  })
})
```

### Snapshot Testing (for CF)
```typescript
import { expect } from 'vitest'

it('should produce expected session event', () => {
  const event = produceSessionEvent(input)
  expect(event).toMatchSessionSnapshot()
})
```

## Test Templates by Category

### 1. Unit Tests for Pure Functions
```typescript
describe('pureFunction', () => {
  const testCases = [
    { input: 'normal', expected: 'result' },
    { input: '', expected: 'default' },
    { input: null, expected: fallback },
  ]

  testCases.forEach(({ input, expected }) => {
    it(`should handle ${JSON.stringify(input)}`, () => {
      expect(pureFunction(input)).toBe(expected)
    })
  })
})
```

### 2. Async Operation Tests
```typescript
describe('asyncOperation', () => {
  it('should resolve with data on success', async () => {
    const result = await asyncOperation(validParams)
    expect(result).toMatchObject({ success: true })
  })

  it('should reject with specific error', async () => {
    await expect(asyncOperation(invalidParams))
      .rejects.toThrow('Specific error message')
  })

  it('should timeout after duration', async () => {
    vi.useFakeTimers()
    const promise = slowOperation()
    vi.advanceTimersByTime(timeout + 1000)
    await expect(promise).rejects.toThrow('Timeout')
  })
})
```

### 3. Plugin/Service Tests (CF Specific)
```typescript
describe('MyPlugin', () => {
  let ctx: MockContext

  beforeEach(async () => {
    ctx = createMockContext()
    await plugin.apply(ctx)
  })

  afterEach(() => {
    // Verify disposal
    expect(ctx.effects.size).toBe(0)
  })

  it('should register service on ctx', () => {
    expect(ctx.myService).toBeDefined()
  })

  it('should emit registration event', () => {
    expect(ctx.emittedEvents).toContain('service/register')
  })

  it('should dispose cleanly', async () => {
    await plugin.dispose(ctx)
    expect(ctx.myService).toBeUndefined()
  })
})
```

### 4. Integration Tests
```typescript
describe('Agent Loop Integration', () => {
  it('should complete full turn for simple request', async () => {
    const session = createTestSession()
    const agent = createAgent(session)
    
    await agent.processMessage('Hello')
    
    const events = session.getEvents()
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'assistant/message',
        content: expect.any(String)
      })
    )
  })
})
```

## Coverage Targets

| Type | Minimum | Ideal | Notes |
|------|---------|-------|-------|
| Statements | 80% | 95%+ | Critical paths 100% |
| Branches | 75% | 90%+ | Error paths included |
| Functions | 80% | 95%+ | Public API 100% |
| Lines | 80% | 95%+ | Complex logic 100% |

## Slash Command Variants

```bash
# Basic test generation
/test src/core/agent.ts

# With coverage focus
/test --coverage src/llm/

# Generate integration tests
/test --type integration packages/api/

# E2e test generation  
/test --type e2e examples/

# Add regression test for bug
/test --bug "null pointer in session load"
```

## Quality Checks for Generated Tests

Before finalizing tests, verify:

1. ✅ Tests are independent (no shared state)
2. ✅ Each test has clear assertion
3. ✅ Edge cases covered
4. ✅ Mocks are minimal and realistic
5. ✅ Test names describe behavior
6. ✅ No implementation details leaked
7. ✅ Cleanup in afterEach if needed

## Anti-Patterns to Avoid

```typescript
// ❌ Testing implementation
it('should call function twice', () => {
  expect(mockFn).toHaveBeenCalledTimes(2)
})

// ✅ Testing behavior
it('should process all items in batch', () => {
  expect(result.items).toHaveLength(input.length)
})

// ❌ Fragile assertions
expect(JSON.stringify(result)).toBe('...')

// ✅ Meaningful assertions
expect(result).toMatchObject({ status: 'success' })
```

## CF-Specific Testing Notes

- Use `vitest.config.ts` from repo root
- Session replay tests use snapshot matching
- Plugin tests must verify disposal
- Event-driven code should assert event emission
- Type tests complement runtime tests
