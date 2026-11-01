name: cf-gauntlet-loop
description: Use when user wants highest quality output with Builder-Critic pattern. Runs iterative quality loops until output passes quality bar. Inspired by Matt Shumer's Gauntlet-Loop for AI agents.
---

# Gauntlet-Loop Skill (`/gauntlet`)

**Turn any goal into a self-improving quality loop. Builder creates, Critic judges (blindly), Loop until it wins.**

## What is Gauntlet-Loop?

Gauntlet-Loop is an **AI agent quality assurance pattern** that uses **Builder-Critic pairs** with **blind evaluation** to produce high-quality outputs.

### Core Philosophy
> "The agent that builds should NEVER be the same agent that judges. Critics must be blind - they see only output vs criteria, not builder's intent."

### The 6-Step Pattern

```
┌─────────────────────────────────────────────────────────────┐
│                    GAUNTLET LOOP FLOW                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────┐                                               │
│  │ 1. GOAL  │ ← Define concrete, measurable goal            │
│  └────┬─────┘                                               │
│       ▼                                                       │
│  ┌──────────┐                                               │
│  │ 2. SPLIT │ ← Break into testable pieces                  │
│  └────┬─────┘                                               │
│       ▼                                                       │
│  ┌──────────┐     ┌───────────┐                             │
│  │ 3.BUILD  │────▶│ 4.CRITIC  │  (Blind Evaluation)        │
│  │(Builder) │     │(Critic)   │                             │
│  └──────────┘     └─────┬─────┘                             │
│                         ▼                                    │
│                   ┌───────────┐                              │
│                   │ 5.COMPARE │ ← Against Quality Bar        │
│                   └─────┬─────┘                              │
│                         ▼                                    │
│                    ┌─────┴─────┐                             │
│                    ▼           ▼                             │
│               [PASS?]    [FAIL?]                             │
│                  │           │                               │
│                  ▼           ▼                               │
│             ┌──────────┐   Return to Step 3                  │
│             │ 6. WIN   │   (Max iterations: 5)              │
│             └──────────┘                                     │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## When to Use Gauntlet-Loop

### Perfect For:
- ✅ Code generation requiring high quality
- ✅ Test suite creation
- ✅ Documentation writing
- ✅ Security audits
- ✅ Refactoring complex code
- ✅ Bug fix verification
- ✅ PR review generation
- ✅ Architecture decisions

### Not Needed For:
- ❌ Simple one-liner changes
- ❌ Quick questions
- ❌ Formatting fixes
- ❌ Obvious bug fixes

## Configuration Options

### Basic Usage
```bash
# Run gauntlet on current task
/gauntlet

# With specific quality bar
/gauntlet --quality "production-ready"

# With max iterations
/gauntlet --max-iterations 3

# Specific goal type
/gauntlet --type code-review
```

### Quality Levels
| Level | Criteria | Use Case |
|-------|----------|----------|
| `quick` | 1 iteration, basic checks | Prototyping |
| `standard` | 3 iterations, standard checks | Daily development |
| `strict` | 5 iterations, comprehensive | Production code |
| `paranoid` | 10 iterations, exhaustive | Security-critical |

## Implementation in CF

### Builder Agent Prompt
```
You are a BUILDER agent. Your job is to create the best possible {output_type} for this goal:

GOAL: {user_goal}

QUALITY BAR: {quality_criteria}

CONTEXT:
{relevant_context}

RULES:
1. Create complete, working output
2. Follow all conventions and patterns
3. Include error handling
4. Add comments where needed
5. Output ONLY the final result

OUTPUT YOUR WORK BELOW:
```

### Critic Agent Prompt (BLIND)
```
You are a BLIND CRITIC agent. Your job is to evaluate output against criteria.

IMPORTANT: You do NOT know who created this or how. Judge ONLY on merit.

QUALITY CRITERIA:
{quality_criteria}

EVALUATION DIMENSIONS:
1. Correctness: Does it work? Is logic sound?
2. Completeness: Are all cases handled?
3. Quality: Is it well-written, maintainable?
4. Conventions: Does it follow patterns?
5. Edge Cases: Are unusual inputs handled?

OUTPUT TO EVALUATE:
{builder_output}

SCORE EACH DIMENSION 1-10 AND PROVIDE:
- Overall Score: X/10
- Pass/Fail: [yes/no]
- Specific Issues: [list]
- Suggestions: [list]
```

### Loop Controller Logic
```typescript
interface GauntletConfig {
  goal: string
  qualityBar: string
  maxIterations: number
  currentIteration: number
  builderOutput: string
  criticScores: number[]
  passThreshold: number // Default: 8/10
}

async function runGauntletLoop(config: GauntletConfig): Promise<{
  output: string
  scores: number[]
  iterations: number
  passed: boolean
}> {
  const results = []
  
  for (let i = 0; i < config.maxIterations; i++) {
    // Phase 1: Build
    const builderOutput = await runBuilder(config.goal, config.qualityBar)
    
    // Phase 2: Blind Critique
    const critique = await runBlindCritic(builderOutput, config.qualityBar)
    
    results.push(critique.score)
    
    // Phase 3: Check Quality Bar
    if (critique.score >= config.passThreshold) {
      return {
        output: builderOutput,
        scores: results,
        iterations: i + 1,
        passed: true
      }
    }
    
    // Phase 4: Feed criticism back to builder (if not last iteration)
    if (i < config.maxIterations - 1) {
      config.goal = `${config.goal}\n\nPREVIOUS ATTEMPT ISSUES:\n${critique.issues}`
    }
  }
  
  return {
    output: builderOutput, // Best effort
    scores: results,
    iterations: config.maxIterations,
    passed: false
  }
}
```

## Example: Code Review Gauntlet

### Input
```bash
/gauntlet --goal "Review src/core/agent.ts for bugs" --type code-review --quality strict
```

### Iteration 1
**Builder Output:**
```markdown
## Review of agent.ts

Found 3 issues:
1. Line 42: Missing null check
2. Line 156: Potential race condition  
3. No disposal cleanup in error path
```

**Blind Critic Score:** 6/10 ❌ FAIL
- Issues found are real but incomplete
- Missing security analysis
- No suggestions provided

### Iteration 2 (with feedback)
**Builder Output:**
```markdown
## Comprehensive Review of agent.ts

### Critical Issues (3)
1. **Line 42 - Null Pointer**: `session` can be undefined when...
   - Suggestion: Add guard clause
   
2. **Line 156 - Race Condition**: Async callback may execute after...
   - Suggestion: Use AbortController pattern
   
3. **Line 203 - Memory Leak**: Event listeners not removed on error
   - Suggestion: Wrap in try/finally with cleanup

### Security Concerns (2)
1. User input not sanitized before prompt assembly
2. Tool names not validated against allowlist

### Performance (1)
1. Unnecessary deep clone in event loop

### Suggestions
- Consider using branded types for session IDs
- Add JSDoc contracts to public methods
```

**Blind Critic Score:** 9/10 ✅ PASS

### Final Result
```
🏆 GAUNTLET COMPLETE!
Iterations: 2/5
Final Score: 9/10
Quality Bar: STRICT ✅ PASSED
```

## CF Integration Points

### Session Events Emitted
```typescript
// During gauntlet execution
{
  type: 'gauntlet/start',
  goal: string,
  qualityLevel: string,
  maxIterations: number
}

{
  type: 'gauntlet/iteration',
  iteration: number,
  builderOutput: string,
  criticScore: number,
  passed: boolean
}

{
  type: 'gauntlet/complete',
  totalIterations: number,
  finalScore: number,
  passed: boolean,
  output: string
}
```

### Subagent Usage
Gauntlet-Loop uses CF's subagent capability:
- **Builder** = Fresh subagent with goal context
- **Critic** = Fresh subagent with ONLY output + criteria
- **Controller** = Main agent orchestrating loop

### Resource Management
- Each iteration spawns new subagents (clean state)
- Abort signal respected throughout
- Max iterations prevent infinite loops
- Token usage tracked per iteration

## Custom Gauntlet Templates

### Create Your Own Template
```yaml
# .gauntlet/templates/code-generation.yml
name: Code Generation
quality_bar: |
  Output must:
  - Compile without errors
  - Pass existing tests
  - Follow project patterns
  - Handle edge cases
  - Include appropriate tests
  
builder_context:
  - Project structure
  - Similar examples
  - Style guide
  - Test framework setup
  
critic_dimensions:
  - name: Correctness
    weight: 3
  - name: Patterns
    weight: 2
  - name: Tests
    weight: 2
  - name: Documentation
    weight: 1
  - name: Edge Cases
    weight: 2
    
pass_threshold: 8
max_iterations: 5
```

### Available Templates
| Template | Use Case | Strictness |
|----------|----------|------------|
| `code-generation` | New feature code | Standard |
| `code-review` | PR review | Strict |
| `test-generation` | Test suites | Standard |
| `documentation` | Docs/writing | Moderate |
| `security-audit` | Security review | Paranoid |
| `refactoring` | Code changes | Strict |
| `debugging` | Bug fixing | Standard |

## Tips for Best Results

### Do's ✅
1. Be specific about quality criteria
2. Provide context files/examples
3. Set realistic iteration limits
4. Use appropriate strictness level
5. Review final output yourself

### Don'ts ❌
1. Don't use for trivial tasks (wasteful)
2. Don't set threshold too low (accepts mediocrity)
3. Don't skip blind evaluation (introduces bias)
4. Don't ignore critic feedback (diminishing returns)
5. Don't forget to verify output manually

## Cost Considerations

| Iterations | Est. Token Cost | Time | Quality Gain |
|------------|-----------------|------|--------------|
| 1 (no loop) | 1x | ~30s | Baseline |
| 2 | 2x | ~60s | +40% |
| 3 | 3x | ~90s | +25% |
| 5 | 5x | ~150s | +15% |
| 10 | 10x | ~300s | +5% |

**Recommendation:** 3 iterations gives best ROI for most tasks.

## Integration with Other Skills

Gauntlet-Loop enhances other skills:
- `/review` → Run review through gauntlet for thoroughness
- `/test` → Generate tests then validate with gauntlet
- `/refactor` → Verify refactored code quality
- `/docs` → Ensure documentation completeness

Example chain:
```bash
/test src/core/agent.ts | /gauntlet --type test-quality
```
