import type { ScriptLoc } from "../compiler/compile.js";
import type { TaintOcc } from "./domain.js";
import type { OrderTrace } from "./causality-order.js";
import type { NamePattern } from "./types.js";

/**
 * The analysis core: the single, self-contained artifact one interpretation of a
 * workflow script produces. It carries the
 * data-dependency half (the taint facts) AND the temporal half (the ordering trace) in
 * one value, and every graph the analyzer serves — site graph, causality graph, actor
 * graph — is a pure projection of it.
 *
 * The design principle is **no position dependence**: anything that needs raw source
 * offsets or the TypeScript checker is resolved when the core is minted
 * (interpret.ts), never by a projection. That is what "projections never look at the
 * code again" means mechanically, and it is checkable: a projection module must not
 * import `typescript`.
 *
 *  - `within` containment (site lexically inside a promoted fan-out body) is resolved
 *    onto each site entry here — the projection reads a string, not a span;
 *  - fan-out ids are FINAL (`fan-out#N`); the taint pass's provisional `fan-out@order`
 *    vocabulary dies at minting, including inside every occurrence and type key;
 *  - artifact types are materialized strings (the checker's answers), keyed by final id.
 *
 * `ScriptLoc` (line:column) fields remain — they are rendering data, not AST access.
 */

/** An `ask` site, AST-free. `within` is the enclosing promoted fan-out, when any. */
export interface CoreAskSite {
  id: string;
  order: number;
  label: string;
  labelPattern?: NamePattern;
  loc: ScriptLoc;
  within?: string;
}

/** A world-read or join site, AST-free. */
export interface CoreSimpleSite {
  id: string;
  order: number;
  label: string;
  loc: ScriptLoc;
  within?: string;
}

/** An `agent()` site, AST-free. */
export interface CoreActorSite {
  id: string;
  order: number;
  loc: ScriptLoc;
  name?: string;
  namePattern?: NamePattern;
  within?: string;
}

/**
 * A PROMOTED fan-out, under its final `fan-out#N` id (source order). Non-promoted
 * iteration candidates are not part of the core — they are graph nodes in nothing.
 */
export interface CoreFanoutSite {
  id: string;
  order: number;
  label: string;
  loc: ScriptLoc;
  within?: string;
  
  cardinality?: number;
}

/**
 * An OPEN `hole<T>()` site, AST-free (docs/analysis.md「Sites」). A filled hole is not a
 * step and is not listed here — it survives only as a phase in the trace.
 */
export interface CoreHoleSite {
  id: string;
  /** The filled hole whose body holds this hole (docs/analysis.md「Sites」); absent at the top level. */
  fill?: string;
  order: number;
  /** The hole's literal name (its phase name; unique by rule 9012). */
  name: string;
  /** The author's spelling of the type argument (`Plan`), the contract the fill is checked against. */
  type: string;
  loc: ScriptLoc;
  /** The call is the (awaited) operand of a top-level `return`: the script's end is open. */
  tail?: true;
  within?: string;
}

export interface CoreSites {
  asks: CoreAskSite[];
  worldReads: CoreSimpleSite[];
  joins: CoreSimpleSite[];
  actors: CoreActorSite[];
  fanouts: CoreFanoutSite[];
  /** Open holes, source order (see {@link CoreHoleSite}). */
  holes: CoreHoleSite[];
}

/**
 * The edge-bearing taint facts, exactly {@link TaintFacts} minus `promoted` (folded
 * into {@link CoreSites.fanouts}) — with every occurrence site and every `fanoutIn`
 * key already renamed to final ids.
 */
export interface CoreFacts {
  askData: Map<string, TaintOcc[]>;
  askActor: Map<string, TaintOcc[]>;
  worldReadData: Map<string, TaintOcc[]>;
  joinIn: Map<string, TaintOcc[]>;
  fanoutIn: Map<string, TaintOcc[]>;
  /** Artifact occurrences reaching each open hole's prompt. */
  holeData: Map<string, TaintOcc[]>;
  returnData: TaintOcc[];
}

/** The checker's answers, materialized. Keys are final site ids. */
export interface CoreTypes {
  /** Whole-value artifact type per producer site. */
  siteType: Map<string, string>;
  /** Per-element awaited types of a join over a static array literal. */
  joinPortTypes: Map<string, (string | undefined)[]>;
}

export interface AnalysisCore {
  sites: CoreSites;
  facts: CoreFacts;
  /** The raw temporal trace — issue/settle/spawn events, regions, controls, phases. */
  trace: OrderTrace;
  types: CoreTypes;
}

export function isActorSite(site: string): boolean {
  return /(^|\/)actor#/.test(site);
}

/** Quote a string field: embedded `"` escaped as `\"` (same rule as serialize.ts). */
function quote(text: string): string {
  return `"${text.replace(/"/g, '\\"')}"`;
}

function renderPattern(pattern: NamePattern | undefined): string {
  if (pattern === undefined) return "";
  let out = "";
  if (pattern.head !== undefined) out += ` head=${quote(pattern.head)}`;
  if (pattern.tail !== undefined) out += ` tail=${quote(pattern.tail)}`;
  return out;
}

function at(loc: ScriptLoc): string {
  return `@${loc.line}:${loc.column}`;
}

export function serializeCore(core: AnalysisCore): string {
  return `${[
    ...renderSites(core),
    ...renderFacts(core.facts),
    ...core.trace.regions.map(
      (region) =>
        `region ${region.id} ${region.kind}` +
        (region.parent === undefined ? "" : ` parent=${region.parent}`) +
        (region.loc === undefined ? "" : ` ${at(region.loc)}`) +
        (region.entered ? " entered" : "") +
        (region.exhaustive ? " exhaustive" : "") +
        (region.fallthrough ? " fallthrough" : "") +
        (region.recursive ? " recursive" : "") +
        (region.detached ? " detached" : "") +
        (region.bound === undefined ? "" : ` bound=${region.bound}`) +
        (region.label === undefined ? "" : ` label=${quote(region.label)}`) +
        (region.strand ? " strand" : ""),
    ),
    ...core.trace.events.map(renderEvent),
    ...core.trace.controls.map(
      (control) =>
        `control ${control.region}` +
        (control.controllers.length > 0 ? ` by=${control.controllers.join(",")}` : "") +
        (control.maybeControllers.length > 0 ? ` maybe=${control.maybeControllers.join(",")}` : ""),
    ),
    ...core.trace.phases.map(
      (phase) =>
        `phase ${phase.id} ${quote(phase.name)} ${at(phase.loc)}` +
        (phase.fill === undefined ? "" : ` fill=${phase.fill}`),
    ),
  ].join("\n")}\n`;
}

function renderSites(core: AnalysisCore): string[] {
  const typeOf = (id: string): string => {
    const type = core.types.siteType.get(id);
    return type === undefined ? "" : ` type=${quote(type)}`;
  };
  const withinOf = (within: string | undefined): string =>
    within === undefined ? "" : ` within=${within}`;

  const lines: { order: number; line: string }[] = [
    ...core.sites.asks.map((site) => ({
      line:
        `ask ${site.id} ${quote(site.label)}${renderPattern(site.labelPattern)} ${at(site.loc)}` +
        ` order=${site.order}${withinOf(site.within)}${typeOf(site.id)}`,
      order: site.order,
    })),
    ...core.sites.worldReads.map((site) => ({
      line:
        `world-read ${site.id} ${quote(site.label)} ${at(site.loc)}` +
        ` order=${site.order}${withinOf(site.within)}${typeOf(site.id)}`,
      order: site.order,
    })),
    ...core.sites.joins.map((site) => {
      const ports = core.types.joinPortTypes.get(site.id);
      const portsText =
        ports === undefined
          ? ""
          : ` ports=${ports.map((port) => (port === undefined ? "-" : quote(port))).join(",")}`;
      return {
        line:
          `join ${site.id} ${quote(site.label)} ${at(site.loc)}` +
          ` order=${site.order}${withinOf(site.within)}${typeOf(site.id)}${portsText}`,
        order: site.order,
      };
    }),
    ...core.sites.actors.map((site) => ({
      line:
        `actor ${site.id}${site.name === undefined ? "" : ` ${quote(site.name)}`}` +
        `${renderPattern(site.namePattern)} ${at(site.loc)} order=${site.order}${withinOf(site.within)}`,
      order: site.order,
    })),
    ...core.sites.fanouts.map((site) => ({
      line:
        `fan-out ${site.id} ${quote(site.label)} ${at(site.loc)}` +
        ` order=${site.order}${withinOf(site.within)}` +
        `${site.cardinality === undefined ? "" : ` count=${site.cardinality}`}${typeOf(site.id)}`,
      order: site.order,
    })),
    ...core.sites.holes.map((site) => ({
      line:
        `hole ${site.id} ${quote(site.name)} ${at(site.loc)} order=${site.order}` +
        `${withinOf(site.within)} type=${quote(site.type)}${site.tail ? " tail" : ""}`,
      order: site.order,
    })),
  ];
  return lines.sort((a, b) => a.order - b.order).map((entry) => entry.line);
}

function renderFacts(facts: CoreFacts): string[] {
  const occText = (occ: TaintOcc): string =>
    `${occ.site} ${occ.exact ? "exact" : "inexact"}${occ.port === undefined ? "" : ` port=${occ.port}`}`;
  const group = (kind: string, map: Map<string, TaintOcc[]>): string[] => {
    // Emission (state.ts) fills these maps in deterministic evaluation order; sorting
    // by sink id keeps the section readable and independent of that order.
    const entries = [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
    const lines: string[] = [];
    for (const [sink, occs] of entries) {
      for (const occ of occs) lines.push(`fact ${kind} ${sink} <- ${occText(occ)}`);
    }
    return lines;
  };
  return [
    ...group("ask-data", facts.askData),
    ...group("ask-actor", facts.askActor),
    ...group("world-read-data", facts.worldReadData),
    ...group("join-in", facts.joinIn),
    ...group("fan-out-in", facts.fanoutIn),
    ...group("hole-data", facts.holeData),
    ...facts.returnData.map((occ) => `fact return <- ${occText(occ)}`),
  ];
}

function renderEvent(event: OrderTrace["events"][number]): string {
  const chain = (regions: readonly string[]): string =>
    regions.length === 0 ? "" : ` in=${regions.join(">")}`;
  if (event.at === "issue") {
    return `issue ${event.step}${chain(event.regions)} phase=${event.phase}`;
  }
  if (event.at === "settle") {
    // A join-only barrier carries no steps; the token is omitted rather than written as an
    // empty string, so the line keeps single spaces throughout.
    return (
      "settle" +
      (event.maybe ? " maybe" : "") +
      (event.steps.length === 0 ? "" : ` ${event.steps.join(",")}`) +
      chain(event.regions) +
      (event.joins === undefined || event.joins.length === 0
        ? ""
        : ` joins=${event.joins.join(",")}`)
    );
  }
  if (event.at === "mark") return `mark ${event.phase}${chain(event.regions)}`;
  if (event.at === "jump") {
    return `jump ${event.kind} ${event.target}${chain(event.regions)} phase=${event.phase}`;
  }
  return `spawn ${event.actor}${chain(event.regions)}`;
}
