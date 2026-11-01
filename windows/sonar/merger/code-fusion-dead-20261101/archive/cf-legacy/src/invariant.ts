/**
 * Invariant checks for XHE Popular Skills
 * Ensures system integrity and validates states
 */

export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`[DSH-Popular-Skills] Invariant violation: ${message}`)
  }
}

export function assertCommandName(name: unknown): asserts name is string {
  invariant(typeof name === 'string', `Command name must be string, got ${typeof name}`)
  invariant(name.length > 0, 'Command name cannot be empty')
  invariant(name.startsWith('/'), `Command must start with /, got: ${name}`)
}

export function assertContext(ctx: unknown): asserts ctx is object {
  invariant(ctx !== null && typeof ctx === 'object', 'Context must be non-null object')
  invariant('commands' in ctx, 'Context must have commands property')
}

// Model behavior invariants - prevents excuse-making
export function assertModelAccountability(
  modelResponse: string,
  errorOccurred: boolean
): { isValid: boolean; issues: string[] } {
  const issues: string[] = []
  
  // Check for excuse patterns
  const excusePatterns = [
    /not my fault/i,
    /wasn't me/i,
    /the error (is|was) not caused by me/i,
    /i didn't do anything wrong/i,
    /this isn't (my|the) problem/i
  ]
  
  if (errorOccurred) {
    for (const pattern of excusePatterns) {
      if (pattern.test(modelResponse)) {
        issues.push(`❌ EXCUSE DETECTED: "${modelResponse.match(pattern)?.[0]}"`)
      }
    }
    
    // Check if model accepts responsibility
    const responsibilityPatterns = [
      /i (will |can )?fix this/i,
      /my mistake/i,
      /i'll correct/i,
      /let me resolve/i,
      /taking ownership/i
    ]
    
    const takesResponsibility = responsibilityPatterns.some(p => p.test(modelResponse))
    
    if (!takesResponsibility && issues.length === 0) {
      issues.push('⚠️ WARNING: Model should acknowledge and fix the error directly')
    }
  }
  
  return {
    isValid: issues.length === 0,
    issues
  }
}

// Aggression balance check
export function assertBalancedAggression(response: string): {
  level: 'too_polite' | 'balanced' | 'too_aggressive'
  suggestions: string[]
} {
  const politeIndicators = ['perhaps', 'maybe', 'might', 'could consider', "if you don't mind"]
  const aggressiveIndicators = ['stupid', 'idiot', 'terrible', 'awful', 'worst ever']
  
  let politenessScore = 0
  let aggressionScore = 0
  
  politeIndicators.forEach(indicator => {
    if (response.toLowerCase().includes(indicator)) politenessScore++
  })
  
  aggressiveIndicators.forEach(indicator => {
    if (response.toLowerCase().includes(indicator)) aggressionScore++
  })
  
  if (politenessScore > 3) {
    return {
      level: 'too_polite',
      suggestions: ['Be more direct', 'State opinions confidently', 'Reduce hedging language']
    }
  }
  
  if (aggressionScore > 2) {
    return {
      level: 'too_aggressive',
      suggestions: ['Tone down personal attacks', 'Focus on constructive criticism', 'Keep it professional but firm']
    }
  }
  
  return {
    level: 'balanced',
    suggestions: []
  }
}
