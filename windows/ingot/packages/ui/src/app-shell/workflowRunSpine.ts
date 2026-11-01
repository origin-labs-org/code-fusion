import type {
  TimelineInk,
  WorkflowTimelineModel,
} from "@/components/workflow-timeline/timeline-model.js";

export const SPINE_JOINT_PX = 16;

export const SPINE_TRACK_X = 21;

const WIDE_PITCH_BRANCHES = 4;

export interface SpineRailPiece {
  track: number;
  ink: TimelineInk;
  position: "above" | "below" | "full";
  stream?: true;
}

export interface SpineJoint {
  main: TimelineInk;
  branches: { track: number; ink: TimelineInk }[];
  
  open?: true;
}

export interface SpineSection {
  rails: SpineRailPiece[];
  
  fork?: SpineJoint;
  
  merge?: SpineJoint;
}

export interface SpineLayout {
  
  pitch: number;
  
  gutter: number;
  sections: SpineSection[];
}

export function spineLayout(model: WorkflowTimelineModel): SpineLayout {
  const { bands, rails, stations } = model;
  const widest = Math.max(1, ...bands.map((band) => band.tracks.length));
  const pitch = widest - 1 <= WIDE_PITCH_BRANCHES ? 12 : 8;
  const bandAt = (i: number) => bands.find((band) => band.from <= i && i <= band.to);
  const plain = rails.filter((rail) => rail.kind === undefined || rail.kind === "stream");
  const railOf = (from: number, to: number) =>
    plain.find((rail) => rail.from === from && rail.to === to);
  const plainInk = (from: number, to: number): TimelineInk => railOf(from, to)?.ink ?? "faint";
  const streamMark = (from: number, to: number) =>
    railOf(from, to)?.kind === "stream" ? { stream: true as const } : {};

  const sections: SpineSection[] = stations.map((_, i) => {
    const band = bandAt(i);
    if (band === undefined) {
      const pieces: SpineRailPiece[] = [];
      const above = plain.find((rail) => rail.to === i);
      const below = plain.find((rail) => rail.from === i);
      if (above !== undefined)
        pieces.push({ ink: above.ink, position: "above", ...streamMark(above.from, i), track: 0 });
      if (below !== undefined)
        pieces.push({ ink: below.ink, position: "below", ...streamMark(i, below.to), track: 0 });
      return { rails: pieces };
    }
    const pieces: SpineRailPiece[] = [];
    band.tracks.forEach((track, t) => {
      const members = track.stations;
      const at = members.indexOf(i);
      if (at >= 0) {
        const previous = members[at - 1];
        const next = members[at + 1];
        pieces.push({
          ink: previous === undefined ? track.entry : plainInk(previous, i),
          position: "above",
          ...(previous === undefined ? {} : streamMark(previous, i)),
          track: t,
        });
        pieces.push({
          ink: next === undefined ? track.exit : plainInk(i, next),
          position: "below",
          ...(next === undefined ? {} : streamMark(i, next)),
          track: t,
        });
        return;
      }
      const before = members.filter((member) => member < i).pop();
      const after = members.find((member) => member > i);
      const ink =
        before === undefined
          ? track.entry
          : after === undefined
            ? track.exit
            : plainInk(before, after);
      pieces.push({ ink, position: "full", track: t });
    });
    return { rails: pieces };
  });

  for (const band of bands) {
    const main = band.tracks[0]!;
    const branches = (end: "entry" | "exit") =>
      band.tracks.slice(1).map((track, k) => ({ ink: track[end], track: k + 1 }));
    sections[band.from]!.fork = {
      branches: branches("entry"),
      main: main.entry,
      ...(band.pred === undefined ? { open: true as const } : {}),
    };
    sections[band.to]!.merge = {
      branches: branches("exit"),
      main: main.exit,
      ...(band.join === undefined ? { open: true as const } : {}),
    };
  }
  return { gutter: pitch * (widest - 1), pitch, sections };
}
