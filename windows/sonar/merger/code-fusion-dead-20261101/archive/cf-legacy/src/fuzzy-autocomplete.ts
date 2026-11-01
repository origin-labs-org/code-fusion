/** Fuzzy Autocomplete for XHE Slash Commands */
import type { SkillCommand, FuzzyMatchResult } from './types'

export function initFuzzyAutocomplete(ctx: any): void {
  console.log('🔍 Fuzzy autocomplete initialized - Type "/" for suggestions')
}

export function findMatches(input: string, commands: Map<string, SkillCommand>, limit = 5): FuzzyMatchResult[] {
  const results: FuzzyMatchResult[] = []
  const query = input.replace(/^\//, '').toLowerCase()
  if (!query) return []
  
  for (const [name, cmd] of commands) {
    const cleanName = name.replace(/^\//, '')
    let score = 0
    if (cleanName.startsWith(query)) score = 100 - (cleanName.length - query.length)
    else if (cleanName.includes(query)) score = 50
    else if (isFuzzyMatch(query, cleanName)) score = 30
    else if (cmd.description.toLowerCase().includes(query)) score = 20
    
    if (score > 0) results.push({ command: cmd, score, matched: score >= 50 })
  }
  
  return results.sort((a, b) => b.score - a.score).slice(0, limit)
}

function isFuzzyMatch(query: string, target: string): boolean {
  let qi = 0, ti = 0
  while (qi < query.length && ti < target.length) {
    if (query[qi] === target[ti]) qi++
    ti++
  }
  return qi === query.length
}
