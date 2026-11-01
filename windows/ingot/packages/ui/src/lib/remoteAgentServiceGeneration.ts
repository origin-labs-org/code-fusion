const generations = new WeakMap<object, number>();
let nextGeneration = 1;

export function remoteAgentServiceGeneration(agentService: object): number {
  const existing = generations.get(agentService);
  if (existing !== undefined) return existing;

  const generation = nextGeneration++;
  generations.set(agentService, generation);
  return generation;
}
