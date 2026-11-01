

export interface StreamSpec {
  from: number;
  to: number;
}

export interface PhaseBand {
  from: number;
  to: number;
  tracks: number[][];
}

export function foldPhaseBands(
  count: number,
  alongside: readonly (readonly number[])[],
  streams: readonly StreamSpec[] = [],
): PhaseBand[] {
  const near = Array.from({ length: Math.max(0, count) }, () => new Set<number>());
  for (let i = 0; i < near.length; i += 1) {
    for (const j of alongside[i] ?? []) {
      if (!Number.isInteger(j) || j < 0 || j >= near.length || j === i) continue;
      near[i]!.add(j);
      near[j]!.add(i);
    }
  }

  const seen = Array.from({ length: near.length }, () => false);
  const spans: { from: number; to: number }[] = [];
  for (let root = 0; root < near.length; root += 1) {
    if (seen[root] === true || near[root]!.size === 0) continue;
    let from = root;
    let to = root;
    const stack = [root];
    seen[root] = true;
    while (stack.length > 0) {
      const i = stack.pop()!;
      if (i < from) from = i;
      if (i > to) to = i;
      for (const j of near[i]!) {
        if (seen[j] === true) continue;
        seen[j] = true;
        stack.push(j);
      }
    }
    spans.push({ from, to });
  }

  spans.sort((left, right) => left.from - right.from);
  const merged: { from: number; to: number }[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last !== undefined && span.from <= last.to) last.to = Math.max(last.to, span.to);
    else merged.push({ ...span });
  }

  const reach = streamReach(near.length, streams);
  const apart = (i: number, j: number): boolean =>
    near[i]!.has(j) && !reach[i]!.has(j) && !reach[j]!.has(i);
  return merged.flatMap((span) => {
    const tracks: number[][] = [];
    for (let i = span.from; i <= span.to; i += 1) {
      const free = tracks.find((members) => !members.some((member) => apart(i, member)));
      if (free === undefined) tracks.push([i]);
      else free.push(i);
    }
    return tracks.length > 1 ? [{ from: span.from, to: span.to, tracks }] : [];
  });
}

function streamReach(count: number, streams: readonly StreamSpec[]): Set<number>[] {
  const next = Array.from({ length: count }, () => [] as number[]);
  for (const stream of streams) {
    if (!inRange(stream.from, count) || !inRange(stream.to, count)) continue;
    if (stream.from !== stream.to) next[stream.from]!.push(stream.to);
  }
  return next.map((_, start) => {
    const reached = new Set<number>();
    const stack = [...next[start]!];
    while (stack.length > 0) {
      const i = stack.pop()!;
      if (reached.has(i)) continue;
      reached.add(i);
      stack.push(...next[i]!);
    }
    return reached;
  });
}

const inRange = (i: number, count: number): boolean => Number.isInteger(i) && i >= 0 && i < count;

export function bandOf<T extends PhaseBand>(bands: readonly T[], i: number): T | undefined {
  return bands.find((band) => band.from <= i && i <= band.to);
}

export function trackOf(bands: readonly PhaseBand[], i: number): number {
  const track = bandOf(bands, i)?.tracks.findIndex((members) => members.includes(i));
  return track === undefined || track < 0 ? 0 : track;
}

export type TimelineRailKind = "fork" | "merge" | "twin" | "stream";

export interface RailSpec {
  from: number;
  to: number;
  kind?: TimelineRailKind;
}

export interface ArcSpec {
  from: number;
  to: number;
  
  air: number;
  
  stream?: true;
}

export interface BoundBand extends PhaseBand {
  pred?: number;
  join?: number;
}

export interface PhaseEdgeFold {
  bands: BoundBand[];
  rails: RailSpec[];
  arcs: ArcSpec[];
}

function bindBands(
  count: number,
  bands: readonly PhaseBand[],
  edges: readonly { from: number; to: number }[],
): BoundBand[] {
  const outside = (i: number): boolean => i >= 0 && i < count && bandOf(bands, i) === undefined;
  return bands.map((band) => {
    const before = band.from - 1;
    const after = band.to + 1;
    const pred =
      outside(before) &&
      edges.some((edge) => edge.from === before && bandOf(bands, edge.to) === band);
    const join =
      outside(after) &&
      edges.some((edge) => edge.to === after && bandOf(bands, edge.from) === band);
    return {
      ...band,
      ...(join ? { join: after } : {}),
      ...(pred ? { pred: before } : {}),
    };
  });
}

function bandRails(bands: readonly BoundBand[], streamed: ReadonlySet<string>): RailSpec[] {
  const rails: RailSpec[] = [];
  for (const band of bands) {
    band.tracks.forEach((members, track) => {
      for (let k = 1; k < members.length; k += 1) {
        const from = members[k - 1]!;
        const to = members[k]!;
        rails.push({
          from,
          ...(streamed.has(`${from}>${to}`) ? { kind: "stream" as const } : {}),
          to,
        });
      }
      if (band.pred !== undefined) {
        rails.push({
          from: band.pred,
          ...(track === 0 ? {} : { kind: "fork" as const }),
          to: members[0]!,
        });
      }
      if (band.join !== undefined) {
        rails.push({
          from: members[members.length - 1]!,
          ...(track === 0 ? {} : { kind: "merge" as const }),
          to: band.join,
        });
      }
    });
    for (let i = band.from; i < band.to; i += 1) {
      if (trackOf(bands, i) !== trackOf(bands, i + 1))
        rails.push({ from: i, kind: "twin", to: i + 1 });
    }
  }
  return rails;
}

export function foldPhaseEdges(
  count: number,
  folded: readonly PhaseBand[],
  edges: readonly { from: number; to: number }[],
  streams: readonly StreamSpec[] = [],
): PhaseEdgeFold {
  const bands = bindBands(count, folded, edges);
  const top = Math.max(1, ...bands.map((band) => band.tracks.length)) - 1;
  const streamed = new Set(
    streams
      .filter((stream) => inRange(stream.from, count) && inRange(stream.to, count))
      .map((stream) => `${stream.from}>${stream.to}`),
  );
  const rails = bandRails(bands, streamed);
  const arcs: ArcSpec[] = [];
  for (const key of streamed) {
    const [from, to] = key.split(">").map(Number) as [number, number];
    if (from === to) continue;
    const source = bandOf(bands, from);
    const target = bandOf(bands, to);
    if (source === undefined && target === undefined) {
      if (to === from + 1) rails.push({ from, kind: "stream", to });
      else arcs.push({ air: top, from, stream: true, to });
      continue;
    }
    if (source === undefined || source !== target) continue;
    const track = trackOf(bands, from);
    if (track !== trackOf(bands, to)) continue;
    const members = source.tracks[track]!;
    if (members[members.indexOf(from) + 1] !== to)
      arcs.push({ air: track, from, stream: true, to });
  }
  for (const edge of edges) {
    const source = bandOf(bands, edge.from);
    const target = bandOf(bands, edge.to);
    if (source === undefined && target === undefined) {
      if (edge.to === edge.from + 1) rails.push({ from: edge.from, to: edge.to });
      else arcs.push({ air: top, from: edge.from, to: edge.to });
      continue;
    }
    if (source !== undefined && source === target) {
      const track = trackOf(bands, edge.from);
      if (track !== trackOf(bands, edge.to)) {
        if (edge.to < edge.from) arcs.push({ air: top, from: source.to, to: source.from });
        continue;
      }
      const members = source.tracks[track]!;
      if (members[members.indexOf(edge.from) + 1] !== edge.to) {
        arcs.push({ air: track, from: edge.from, to: edge.to });
      }
      continue;
    }
    if (source !== undefined && target === undefined && edge.to === source.to + 1) continue;
    if (source === undefined && target !== undefined && edge.from === target.from - 1) continue;
    const from = source === undefined ? edge.from : source.to;
    const to = target === undefined ? edge.to : target.from;
    if (source !== undefined && target !== undefined && source.to + 1 === target.from) {
      rails.push({ from, to });
      continue;
    }
    arcs.push({ air: top, from, to });
  }
  const streamRails = new Set(
    rails.filter((rail) => rail.kind === "stream").map((rail) => `${rail.from}>${rail.to}`),
  );
  return {
    arcs: dedupe(arcs, (arc) => `${arc.air}:${arc.from}>${arc.to}:${arc.stream ? "s" : ""}`),
    bands,
    rails: order(
      rails.filter(
        (rail) => rail.kind !== undefined || !streamRails.has(`${rail.from}>${rail.to}`),
      ),
    ),
  };
}

function dedupe<T extends { from: number; to: number }>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (item.from === item.to || seen.has(key(item))) return false;
    seen.add(key(item));
    return true;
  });
}

function order(rails: RailSpec[]): RailSpec[] {
  return dedupe(rails, (rail) => `${rail.from}>${rail.to}:${rail.kind ?? ""}`).sort(
    (left, right) => left.from - right.from || left.to - right.to,
  );
}

export function arcLaneCount(arcs: readonly { lane: number }[]): number {
  return arcs.reduce((max, arc) => Math.max(max, arc.lane + 1), 0);
}

export function assignArcLanes(
  pairs: readonly { from: number; to: number }[],
): { from: number; to: number; lane: number }[] {
  const placed: { lo: number; hi: number; lane: number }[] = [];
  return pairs.map((pair) => {
    const lo = Math.min(pair.from, pair.to);
    const hi = Math.max(pair.from, pair.to);
    const taken = new Set(
      placed
        .filter((other) => Math.max(lo, other.lo) <= Math.min(hi, other.hi))
        .map((other) => other.lane),
    );
    let lane = 0;
    while (taken.has(lane)) lane += 1;
    placed.push({ hi, lane, lo });
    return { from: pair.from, lane, to: pair.to };
  });
}

export function assignAirLanes(arcs: readonly ArcSpec[]): number[] {
  const lanes = Array.from({ length: arcs.length }, () => 0);
  for (const air of new Set(arcs.map((arc) => arc.air))) {
    const group = arcs.flatMap((arc, at) => (arc.air === air ? [{ ...arc, at }] : []));
    assignArcLanes(group).forEach((placed, k) => {
      lanes[group[k]!.at] = placed.lane;
    });
  }
  return lanes;
}
