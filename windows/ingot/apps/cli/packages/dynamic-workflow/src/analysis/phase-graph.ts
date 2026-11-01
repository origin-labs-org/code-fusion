import { UNPHASED_ID } from "./constants.js";
import type { OrderEvent, PhaseInfo } from "./causality-order.js";
import { KIND_RANK, reduceOrdering, type OrderKind } from "./causality-reduce.js";
import type { CausalityGraph, Certainty, OrderEdge, Phase, Step } from "./causality-graph.js";

const COPY_SEPARATOR = "~";

interface PhaseClaims {
  
  bySite: Map<string, string[]>;
  
  certainty: Map<string, Certainty>;
  
  position: Map<string, number>;
  
  firstIssue: Map<string, number>;
  lastIssue: Map<string, number>;
}

export interface PhaseSourceFact {
  from: string;
  to: string;
  kind: OrderKind;
  certainty: Certainty;
  
  carryOf?: Exclude<OrderKind, "carry">;
  
  toPhases?: ReadonlySet<string>;
}

function headPhasesOf(claiming: readonly string[], toPhases: ReadonlySet<string> | undefined): string[] {
  if (toPhases === undefined) return [...claiming];
  const narrowed = claiming.filter((phase) => toPhases.has(phase));
  return narrowed.length > 0 ? narrowed : [...claiming];
}

export function collectPhaseClaims(
  events: readonly OrderEvent[],
  steps: ReadonlySet<string>,
  certainChain: (chain: readonly string[]) => boolean,
  controlled: ReadonlySet<string>,
): PhaseClaims {
  const bySite = new Map<string, string[]>();
  const position = new Map<string, number>();
  const firstIssue = new Map<string, number>();
  const lastIssue = new Map<string, number>();
  const certainSeen = new Set<string>();
  let clock = 0;
  for (const event of events) {
    if (event.at !== "issue") continue;
    const at = clock;
    clock += 1;
    if (!steps.has(event.step)) continue;
    const claiming = bySite.get(event.step);
    if (claiming === undefined) bySite.set(event.step, [event.phase]);
    else if (!claiming.includes(event.phase)) claiming.push(event.phase);
    if (!position.has(event.phase)) position.set(event.phase, at);
    const key = `${event.step}|${event.phase}`;
    if (!firstIssue.has(key)) firstIssue.set(key, at);
    lastIssue.set(key, at);
    if (certainChain(event.regions)) certainSeen.add(key);
  }

  const certainty = new Map<string, Certainty>();
  for (const [site, claiming] of bySite) {
    for (const phase of claiming) {
      const key = `${site}|${phase}`;
      certainty.set(key, certainSeen.has(key) && !controlled.has(site) ? "always" : "maybe");
    }
  }
  return { bySite, certainty, firstIssue, lastIssue, position };
}

export function projectPhaseGraph(
  graph: CausalityGraph,
  phases: readonly PhaseInfo[],
  claims: PhaseClaims,
  facts: readonly PhaseSourceFact[],
  sharesIteration: (a: string, b: string) => boolean,
): CausalityGraph {
  if (phases.length === 0) return graph;

  const claimsOf = (siteId: string): string[] => claims.bySite.get(siteId) ?? [UNPHASED_ID];
  const certaintyOfClaim = (siteId: string, phase: string): Certainty =>
    claims.certainty.get(`${siteId}|${phase}`) ?? "maybe";

  
  const admits = (from: string, fromPhase: string, to: string, toPhase: string): boolean => {
    const firstFrom = claims.firstIssue.get(`${from}|${fromPhase}`);
    const lastTo = claims.lastIssue.get(`${to}|${toPhase}`);
    if (firstFrom === undefined || lastTo === undefined) return true;
    return lastTo > firstFrom || sharesIteration(from, to);
  };
  
  const ADMITTED_KINDS = new Set<OrderKind>(["data", "control", "seq"]);

  //
  const copiesOf = new Map<string, (Step & { phase: string })[]>();
  for (const step of graph.steps) {
    const siteId = step.source ?? step.id;
    const claiming = claimsOf(siteId);
    if (claiming.length < 2) continue;
    copiesOf.set(
      step.id,
      claiming.map((phase) => ({
        ...step,
        certainty: weakest([step.certainty, certaintyOfClaim(siteId, phase)]),
        id: `${step.id}${COPY_SEPARATOR}${phase}`,
        phase,
        source: siteId,
      })),
    );
  }

  const steps: Step[] = graph.steps.flatMap((step) => {
    const copies = copiesOf.get(step.id);
    if (copies !== undefined) return copies;
    return [{ ...step, phase: claimsOf(step.source ?? step.id)[0] as string }];
  });

  const stepById = new Map(graph.steps.map((step) => [step.id, step]));
  const siteOf = (id: string): string => {
    const step = stepById.get(id);
    return step === undefined ? id : (step.source ?? step.id);
  };
  const provenance = new Map<string, ReadonlySet<string>>();
  for (const fact of facts) {
    if (fact.toPhases !== undefined) provenance.set(`${fact.from}|${fact.to}`, fact.toPhases);
  }

  const endpointsOf = (
    id: string,
    toPhases?: ReadonlySet<string>,
  ): { certainty: Certainty; id: string; lane?: string; phase: string }[] => {
    const copies = copiesOf.get(id);
    if (copies !== undefined) {
      const heads = new Set(headPhasesOf(claimsOf(siteOf(id)), toPhases));
      return copies
        .filter((copy) => heads.has(copy.phase))
        .map((copy) => ({
          certainty: copy.certainty,
          id: copy.id,
          lane: copy.lane,
          phase: copy.phase,
        }));
    }
    const step = stepById.get(id);
    return [
      {
        certainty: step?.certainty ?? "maybe",
        id,
        lane: step?.lane,
        phase: claimsOf(siteOf(id))[0] as string,
      },
    ];
  };

  const edges: OrderEdge[] = [];
  for (const edge of graph.edges) {
    if (!copiesOf.has(edge.from) && !copiesOf.has(edge.to)) {
      edges.push(edge);
      continue;
    }
    const fromSite = siteOf(edge.from);
    const toSite = siteOf(edge.to);
    const pairs: { certainty: Certainty; from: string; to: string }[] = [];
    const admitted: typeof pairs = [];
    for (const tail of endpointsOf(edge.from)) {
      for (const head of endpointsOf(edge.to, provenance.get(`${fromSite}|${toSite}`))) {
        if (edge.kind === "fifo" && tail.lane !== head.lane) continue;
        if (tail.id === head.id && edge.from !== edge.to) continue;
        const pair = {
          certainty: weakest([edge.certainty, tail.certainty, head.certainty]),
          from: tail.id,
          to: head.id,
        };
        pairs.push(pair);
        if (!ADMITTED_KINDS.has(edge.kind) || admits(fromSite, tail.phase, toSite, head.phase)) {
          admitted.push(pair);
        }
      }
    }
    for (const pair of admitted.length > 0 ? admitted : pairs) {
      edges.push({ ...edge, ...pair });
    }
  }

  const members = new Set<string>(steps.map((step) => step.phase as string));
  const phaseList: Phase[] = [];
  if (members.has(UNPHASED_ID)) phaseList.push({ id: UNPHASED_ID });
  for (const phase of phases) {
    if (!members.has(phase.id)) continue;
    phaseList.push({
      id: phase.id,
      loc: phase.loc,
      name: phase.name,
      ...(phase.fill === undefined ? {} : { fill: phase.fill }),
    });
  }
  const live = new Set(phaseList.map((phase) => phase.id));

  const quotient: PhaseSourceFact[] = [];
  for (const fact of facts) {
    const tails = claimsOf(fact.from);
    const heads = headPhasesOf(claimsOf(fact.to), fact.toPhases);
    const copied = tails.length > 1 || claimsOf(fact.to).length > 1;
    const gated = copied && ADMITTED_KINDS.has(fact.kind);
    const pairs: { from: string; to: string }[] = [];
    const admitted: typeof pairs = [];
    for (const from of tails) {
      for (const to of heads) {
        pairs.push({ from, to });
        if (!gated || admits(fact.from, from, fact.to, to)) admitted.push({ from, to });
      }
    }
    for (const { from, to } of admitted.length > 0 ? admitted : pairs) {
      if (!live.has(from) || !live.has(to)) continue;
      if (from === to && fact.kind !== "carry") continue;
      quotient.push({
        certainty: fact.certainty,
        from,
        kind: fact.kind,
        to,
        ...(fact.carryOf === undefined ? {} : { carryOf: fact.carryOf }),
      });
    }
  }

  const position = (id: string): number => claims.position.get(id) ?? 0;
  const deduped = dedupePhaseFacts(quotient).sort(
    (a, b) =>
      position(a.from) - position(b.from) ||
      position(a.to) - position(b.to) ||
      a.kind.localeCompare(b.kind),
  );
  const phaseEdges: OrderEdge[] = reduceOrdering(deduped).map((fact) => ({
    certainty: fact.certainty,
    from: fact.from,
    kind: fact.kind,
    to: fact.to,
  }));

  const sink = graph.sink;
  return {
    edges,
    lanes: graph.lanes,
    phaseEdges,
    phases: phaseList,
    regions: graph.regions,
    steps,
    ...(sink === undefined
      ? {}
      : { sink: { fedBy: sink.fedBy.flatMap((id) => endpointsOf(id).map((end) => end.id)) } }),
  };
}

function dedupePhaseFacts(facts: readonly PhaseSourceFact[]): PhaseSourceFact[] {
  const byPair = new Map<string, PhaseSourceFact>();
  for (const fact of facts) {
    const key = `${fact.from}|${fact.to}`;
    const existing = byPair.get(key);
    if (existing === undefined) {
      byPair.set(key, { ...fact });
      continue;
    }
    if (KIND_RANK[fact.kind] > KIND_RANK[existing.kind]) existing.kind = fact.kind;
    if (existing.carryOf === undefined && fact.carryOf !== undefined) existing.carryOf = fact.carryOf;
    if (fact.certainty === "maybe") existing.certainty = "maybe";
  }
  return [...byPair.values()];
}

function weakest(values: readonly Certainty[]): Certainty {
  return values.includes("maybe") ? "maybe" : "always";
}
