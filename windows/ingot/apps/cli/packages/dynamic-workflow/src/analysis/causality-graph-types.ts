import type { RegionKind } from "./constants.js";
import type { OrderKind } from "./causality-reduce.js";
import type { SiteLoc, NamePattern } from "./types.js";

/** `hole`: an OPEN `hole<T>()` — the script waits there for the main agent's fill. */
export type StepKind = "ask" | "world-read" | "hole";
export type Certainty = "always" | "maybe";

/** The single lane every `files.*` read runs in. */
export const WORKSPACE_LANE = "workspace";
/** The main agent's lane: where every open hole waits (docs/analysis.md「Sites」). */
export const MAIN_LANE = "main";
/** Lane of an ask whose receiver the analysis could not resolve to any actor site. */
export const UNKNOWN_LANE = "unknown";
/** The terminal marker: the artifact the script returns. */
export const SINK_ID = "sink";

export interface Step {
  /** A site id (`ask#3`, `world-read#1`); it is also the runtime instance's key. */
  id: string;
  kind: StepKind;
  label: string;
  
  labelPattern?: NamePattern;
  loc: SiteLoc;
  /** Actor site id, or `workspace` / `unknown`. For an unexpanded may-set, `lanes[0]`. */
  lane: string;
  /** Present only when the ask receiver is dynamically selected: the candidate lanes. */
  lanes?: string[];
  /**
   * The step this one was expanded from, emitted only on a may-set copy (see
   * `expandMaySetLanes` in causality-graph-lanes.ts). It is the site id a runtime instance
   * actually reports, which is what makes it the live overlay's join key (`source ?? id`
   * against `node.siteId`, narrowed by `node.actorSiteId === lane`).
   *
   * This composes with future per-callsite specialization rather than competing with it. Once
   * specialization lands, the expanded-from id IS the specialized site id —
   * `ask#3/2~actor#1` carries source `ask#3/2` — so the join stays stable under both
   * features. On a copy the field means "the site the runtime reports", NOT "the site
   * before specialization".
   */
  source?: string;
  /** Innermost enclosing region id. */
  region: string;
  certainty: Certainty;
  /**
   * The author-declared phase this step belongs to (`phase#2`, or the reserved
   * `unphased`). Present only when the script declares at least one `phase()` marker, in
   * which case EVERY step carries one — a step claimed by k>1 phases is expanded into k
   * copies to keep the partition total (see phase-graph.ts).
   */
  phase?: string;
  /**
   * How this step's instances relate when an enclosing region repeats:
   *   `stack`  — they coexist, which is the one multiplicity cue (stacked cards);
   *   `serial` — they follow one another, already visible as the cycle-closing arrow.
   * Absent when the step runs at most once. Finding: the cue splits on
   * CONCURRENCY, not cardinality — a step is `serial` exactly when a barrier inside
   * the repeating region settles it, or when a fixed actor's mailbox serializes it.
   */
  repeat?: "stack" | "serial";
  /**
   * The filled hole whose body wrote this step: the `hole#<hash>/` prefix of its site id, or,
   * for an open hole (whose id is a bare name key), the site table's `fill`. Absent outside
   * every fill.
   */
  fill?: string;
}

export interface Region {
  id: string;
  kind: RegionKind;
  parent?: string;
  loc?: SiteLoc;
  /** Derivable literal round count of a `for`; model-only, never displayed. */
  bound?: number;
  label?: string;
}

export interface OrderEdge {
  from: string;
  to: string;
  kind: OrderKind;
  certainty: Certainty;
  /** `data` edges only: the taint witness path's exactness bit. Model-only. */
  exact?: boolean;
}

export interface Lane {
  id: string;
  /** The author's verbatim word, when `agent()` was given a literal. Never a reconstruction. */
  name?: string;
  
  namePattern?: NamePattern;
  loc?: SiteLoc;
  /**
   * Enclosing iteration regions of the `agent()` call, outermost first. A non-empty
   * list makes the lane a family — one fresh actor per element — and nested iterations
   * MULTIPLY, so multiplicity is the product and a single id cannot express it.
   */
  families?: string[];
}

/**
 * An author-declared phase: a name for a group of steps, and the position of the marker
 * that opened it. The synthetic fallback `unphased` carries neither — the UI shows a
 * localized word for it, exactly as it does for the `workspace` / `unknown` lanes.
 */
export interface Phase {
  id: string;
  name?: string;
  loc?: SiteLoc;
  /** The filled hole whose body wrote this phase (a filled hole's own phase names itself). */
  fill?: string;
}

export interface CausalityGraph {
  steps: Step[];
  regions: Region[];
  lanes: Lane[];
  edges: OrderEdge[];
  /** Step ids whose artifacts reach the script's return; absent when it returns nothing. */
  sink?: { fedBy: string[] };
  /**
   * The phase vocabulary, present TOGETHER WITH `phaseEdges` and `Step.phase` or not at
   * all: a script with no `phase()` markers gets none of the three and its graph is
   * byte-identical to what it was before the feature. `unphased` first when it has
   * members, then the author's phases in first-reach order.
   */
  phases?: Phase[];
  /** The quotient of `edges` by the phase partition. Never carries `exact`. */
  phaseEdges?: OrderEdge[];
}

export interface Fact {
  from: string;
  to: string;
  kind: OrderKind;
  certainty: Certainty;
  exact?: boolean;
  
  carryOf?: Exclude<OrderKind, "carry">;
  
  toPhases?: Set<string>;
  
  viaJump?: true;
}
