import { measure } from "./diagram-text";
import { WORK_PLACEMENT_PIN } from "$shared/ipc/work-constants";
import type {
  WorkEnvironmentElement,
  WorkEnvironmentSnapshot,
  WorkArtifactV1,
  WorkExecutionFact,
  WorkPageV1,
  WorkRuntimeProjection,
} from "$shared/ipc/bindings";
import type { MediaAssetV1 } from "$domain/resources";
import { isLive } from "./agent-steps";
import { clipText, type CanvasPosition } from "./canvas-model";
import {
  threadOf,
  type RunTurn,
  type RunTurns,
  type WorkStage,
} from "./project-environment-thread";
import { boardOf } from "./board/adapter";
import { boardLayout, type LayoutBlock } from "./board/layout";
import { leadObject, onCanvas, pictureKey, runObjects, type RunObject } from "./board/objects";
import { objectHeight, objectWidth } from "./board/object-size";
import { ulidTime } from "./ulid-time";
import { runTrail } from "./board/trail";
import type { Picture } from "./board/types";
import { partColumns } from "./run/columns";
import { RUN, placeRun } from "./run/layout";
import { localReads, runParts, type PartAsk, type RunInputView, type RunPart } from "./run/parts";
import { PART, partSize, rowKey, type PartShape } from "./run/part-size";
import { runSources } from "./run/sources";
import { siteName } from "./run/site";
import { computerRows, computerView } from "./parts/computer";
import { foundByPart } from "./run/found";
import { provenance } from "./run/provenance";
import { freeSpot, touches } from "./free-space";
import * as m from "$shared/i18n/messages";

/** A placement written in board terms: the person moved the block; `x, y` are from the result's corner. */
export const BOARD_PIN = WORK_PLACEMENT_PIN;
const REQUEST_TEXT = 512;

/**
 * Whether an element is drawn by its request's lane: the request itself, or
 * what one of the canvas's works found or made. The person's own elements keep
 * absolute places.
 */
export function laneElement(
  snapshot: WorkEnvironmentSnapshot,
  element: WorkEnvironmentElement,
): boolean {
  const reference = element.reference;
  if (reference.kind === "objective") return true;
  if (reference.kind !== "subject" && reference.kind !== "finding" && reference.kind !== "artifact")
    return false;
  return snapshot.elements.some(
    (candidate) =>
      candidate.reference.kind === "objective" &&
      candidate.reference.objective === reference.objective,
  );
}

/** Blocks the person moved, by their offset from their lane's corner. */
function boardPins(snapshot: WorkEnvironmentSnapshot): Map<string, CanvasPosition> {
  const pins = new Map<string, CanvasPosition>();
  for (const place of snapshot.view.placements)
    if (place.revision === BOARD_PIN) pins.set(place.element, { x: place.x, y: place.y });
  return pins;
}

/** The admitted picture of each element: a `uses` relation to an image resource. */
export function elementPictures(
  snapshot: WorkEnvironmentSnapshot,
  media: ReadonlyMap<string, MediaAssetV1>,
): Map<string, Picture> {
  const resources = new Map(
    snapshot.elements.flatMap((element) =>
      element.reference.kind === "resource" ? [[element.id, element.reference.resource]] : [],
    ),
  );
  const pictures = new Map<string, Picture>();
  for (const relation of snapshot.relations ?? []) {
    if (relation.kind !== "uses" || pictures.has(relation.from)) continue;
    const resource = resources.get(relation.to);
    const asset = resource ? media.get(resource) : undefined;
    if (asset?.kind === "image")
      pictures.set(relation.from, { profile: snapshot.profile, digest: asset.digest });
  }
  return pictures;
}

/**
 * Pictures the canvas admitted from the web, by the address they were fetched
 * from: an object's item finds its own among its candidates.
 */
export function fetchedPictures(
  snapshot: WorkEnvironmentSnapshot,
  media: ReadonlyMap<string, MediaAssetV1>,
): Map<string, Picture> {
  const used = new Set(
    (snapshot.relations ?? []).flatMap((relation) =>
      relation.kind === "uses" ? [relation.to] : [],
    ),
  );
  const pictures = new Map<string, Picture>();
  for (const element of snapshot.elements) {
    if (element.reference.kind !== "resource" || !used.has(element.id)) continue;
    const asset = media.get(element.reference.resource);
    if (asset?.kind !== "image" || asset.origin?.kind !== "fetched") continue;
    pictures.set(pictureKey(asset.origin.url), { profile: snapshot.profile, digest: asset.digest });
  }
  return pictures;
}

/**
 * The person's words as text on the canvas: who and when over them, two lines
 * at rest, every line once opened.
 */
export function requestTextSize(text: string, open: boolean) {
  const perLine = 36;
  const lines = Math.max(1, Math.ceil(text.length / perLine));
  const shown = open ? lines : Math.min(2, lines);
  // Never under 80: a checkpoint refuses a shorter placement.
  return { width: RUN.request, height: Math.max(80, 20 + shown * 24 + (lines > 2 ? 24 : 0)) };
}

/** A block's height as it last measured itself at this width, open or not. */
export const measureKey = (id: string, width: number, open: boolean) =>
  `${id}|${Math.round(width)}|${open ? 1 : 0}`;

/**
 * What blocks report of their height, taken in once per turn: every block
 * that measured itself while the canvas drew lands in one change, so the runs
 * are laid out again once, not once per block.
 */
export function measurer(measured: Map<string, number>) {
  const pending = new Map<string, number>();
  let queued = false;
  return (id: string, width: number, open: boolean, height: number) => {
    pending.set(measureKey(id, width, open), height);
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      for (const [key, value] of pending) if (measured.get(key) !== value) measured.set(key, value);
      pending.clear();
    });
  };
}

export type StageOptions = {
  recorded?: (objective: string) => readonly WorkPageV1[];
  pictures?: ReadonlyMap<string, Picture>;
  /** Pictures admitted from the web, by the address they came from. */
  fetched?: ReadonlyMap<string, Picture>;
  chosen?: ReadonlySet<string>;
  /** Heights blocks and heads measured, by `measureKey`. */
  measured?: ReadonlyMap<string, number>;
  /** The block opened in place, if one is. */
  open?: string | null;
  /** Requests whose words the person opened to read whole. */
  requests?: ReadonlySet<string>;
  /** Questions waiting on the person, by the work they belong to. */
  asks?: (objective: string) => readonly PartAsk[];
  /** Whether a page of the request is held for the person (a check, a sign-in). */
  held?: (objective: string) => boolean;
  /** What a run drew on before it began. */
  inputs?: (runs: readonly WorkExecutionFact[]) => readonly RunInputView[];
  /** The questions a run put to the person and the answers, as the asks read them. */
  exchange?: (runs: readonly WorkExecutionFact[]) => RunTurn[];
  /** Where the person's own things stand, by element: every run is laid out clear of them. */
  around?: Readonly<Record<string, Box>>;
};

/** An input's mark: its name over what kind of thing it is, its tile where its line leaves. */
const INPUT = { width: 200, height: 36 } as const;

const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

/**
 * The lead's objects a run placed, each showing the newest version of its
 * chain; an object that revises one already on the canvas shows there
 * instead, and the run names it as what it changed.
 */
function leadEntries(
  snapshot: WorkEnvironmentSnapshot,
  projection: WorkRuntimeProjection,
  executions: readonly string[],
) {
  const all = new Map(
    projection.executions.flatMap((execution) =>
      execution.artifacts.map((artifact) => [artifact.id, { artifact, execution }] as const),
    ),
  );
  const newer = new Map<string, string>();
  for (const [id, { artifact }] of all) if (artifact.revises) newer.set(artifact.revises, id);
  const placed = new Map<string, string>();
  for (const element of snapshot.elements)
    if (element.reference.kind === "artifact" && element.reference.objective === projection.work.id)
      placed.set(element.reference.artifact, element.id);
  const rootOf = (id: string) => {
    let at = id;
    for (let hop = 0; hop < 64; hop++) {
      const previous = all.get(at)?.artifact.revises;
      if (!previous || !all.has(previous)) break;
      at = previous;
    }
    return at;
  };
  const newestOf = (id: string) => {
    let at = id;
    for (let hop = 0; hop < 64 && newer.has(at); hop++) at = newer.get(at)!;
    return at;
  };
  const entries: {
    element: string;
    artifact: WorkArtifactV1;
    execution: WorkExecutionFact;
    updated?: string;
  }[] = [];
  const revised: string[] = [];
  for (const element of snapshot.elements) {
    const reference = element.reference;
    if (
      reference.kind !== "artifact" ||
      reference.objective !== projection.work.id ||
      !executions.includes(reference.execution)
    )
      continue;
    const own = all.get(reference.artifact);
    if (!own || !leadObject(own.artifact) || !onCanvas(own.artifact, own.execution)) continue;
    const root = rootOf(reference.artifact);
    const holder = root !== reference.artifact ? placed.get(root) : undefined;
    if (holder) {
      if (!revised.includes(holder)) revised.push(holder);
      continue;
    }
    const newest = all.get(newestOf(reference.artifact))!;
    const at = newest.artifact.id !== reference.artifact ? ulidTime(newest.execution.id) : null;
    entries.push({
      element: element.id,
      artifact: newest.artifact,
      execution: newest.execution,
      ...(at ? { updated: m.work_object_updated({ time: clock.format(at) }) } : {}),
    });
  }
  return { entries, revised };
}

type InputFact = NonNullable<WorkExecutionFact["inputs"]>[number];
const baseName = (path: string) => path.replace(/\/+$/u, "").split("/").at(-1) || path;

/**
 * The folders a run read, by name: the one its fact names, else the
 * canvas's folders its files sit in, else the canvas's folders when they are
 * as many as it read. A count is never a name.
 */
type Folder = { label: string; element?: string };
function folderNames(
  snapshot: WorkEnvironmentSnapshot,
  run: WorkExecutionFact,
  fact: InputFact,
): Folder[] {
  const folders = snapshot.elements.flatMap((element) =>
    element.reference.kind === "folder"
      ? [{ path: element.reference.path, name: element.reference.name, element: element.id }]
      : [],
  );
  const named = (folder: (typeof folders)[number]): Folder => ({
    label: folder.name || baseName(folder.path),
    element: folder.element,
  });
  if (fact.reference?.startsWith("/")) {
    const folder = folders.find((candidate) => candidate.path === fact.reference);
    return [folder ? named(folder) : { label: baseName(fact.reference) }];
  }
  const read = [
    ...(run.file_evidence ?? []).map((record) => record.file.path),
    ...(run.steps ?? []).flatMap((step) => (step.local?.folder ? [step.local.folder] : [])),
  ];
  const used = folders.filter((folder) =>
    read.some((path) => path === folder.path || path.startsWith(`${folder.path}/`)),
  );
  if (used.length) return used.map(named);
  if (folders.length && folders.length === (fact.count ?? 1)) return folders.map(named);
  return [{ label: fact.label }];
}

/** Room the lines under a request take, until they measure themselves. */
function turnsHeight(turns: RunTurns): number {
  const lines = (text: string, per: number) => Math.max(1, Math.ceil(text.length / per));
  let height = turns.local.length ? 6 + turns.local.length * 20 : 0;
  for (const turn of turns.exchange)
    height +=
      turn.kind === "ask"
        ? 12 + lines(turn.question, 40) * 18 + lines(turn.answer ?? "", 40) * 18
        : 12 + lines(turn.text, 40) * 18;
  return height + (turns.exchange.length ? 8 : 0);
}

/** Each input once, as a run's several executions and later requests of its thread name it again. */
function uniqueInputs(inputs: readonly RunInputView[], shown: Set<string>): RunInputView[] {
  return inputs.filter((input) => {
    const key = `${input.kind}:${input.label}`;
    return !shown.has(key) && !!shown.add(key);
  });
}

/** The lead's own web searches, whose rows are its results rather than the sites it cited. */
export const searchPart = (part: RunPart) => part.key.startsWith("search:");

/** How a part's own node stands: its pages as windows, its sources, its helper's view or its ask. */
export function partShape(part: RunPart, projection?: WorkRuntimeProjection): PartShape {
  if (part.ask) {
    const ask = part.ask.props["ask"] as { kind?: string } | undefined;
    return { kind: "ask", confirm: ask?.kind === "confirm" };
  }
  if (part.helper === "computer" || part.helper === "connection") {
    const steps = part.steps ?? [];
    const rows =
      part.helper === "computer"
        ? computerRows(computerView(projection, steps))
        : // A call a step, four shown and a line for the rest, until the view measures itself.
          Math.max(1, Math.min(steps.length, 4) + (steps.length > 4 ? 1 : 0));
    return {
      kind: "helper",
      rows: Math.max(rows, Math.min(PART.helperLines, part.lines?.length ?? 0)),
    };
  }
  if (part.helper === "research" && !part.pages.length) {
    const search = searchPart(part);
    const cap = search ? PART.searchRows : PART.sourceRows;
    return {
      kind: "sources",
      // A search's words stand over its results as one more row.
      rows: Math.min(cap, part.sources.length || (search ? 3 : 0)) + (search ? 1 : 0),
      more: part.sources.length > cap,
    };
  }
  if (!part.pages.length) return { kind: "label" };
  return { kind: "pages", count: part.pages.length };
}

/**
 * Every request of the canvas as a run, top to bottom, 120 apart: its words,
 * a row per part with what the part found at the row's end, the result on
 * the right with the answer at its head.
 */
export function environmentStages(
  snapshot: WorkEnvironmentSnapshot,
  objectives: ReadonlyMap<string, WorkRuntimeProjection>,
  options: StageOptions = {},
): WorkStage[] {
  const pins = boardPins(snapshot);
  const measured = options.measured ?? new Map<string, number>();
  const stages: WorkStage[] = [];
  // A folder a run read is drawn as that run's input, not where it was put.
  const claimed = runInputFolders(snapshot, objectives);
  const around = Object.entries(options.around ?? {}).flatMap(([id, box]) =>
    claimed.has(id) ? [] : [box],
  );
  let top = 0;
  for (const element of snapshot.elements) {
    if (element.reference.kind !== "objective") continue;
    const projection = objectives.get(element.reference.objective);
    if (!projection) continue;
    const recorded = options.recorded?.(projection.work.id) ?? [];
    /** What earlier requests of this thread already showed they drew on. */
    const shown = new Set<string>();
    for (const draft of threadOf(element.id, projection)) {
      const runs = draft.executions.flatMap((id) => {
        const execution = projection.executions.find((entry) => entry.id === id);
        return execution ? [execution] : [];
      });
      const alive = (execution: WorkExecutionFact) => isLive(projection, execution);
      const live = runs.some(alive);
      const trail = runTrail(runs, live);
      const elements = snapshot.elements.filter((candidate) => {
        const reference = candidate.reference;
        return (
          (reference.kind === "artifact" || reference.kind === "subject") &&
          reference.objective === projection.work.id &&
          draft.executions.includes(reference.execution)
        );
      });
      const board = boardOf({
        id: `board:${draft.card}`,
        executions: runs,
        elements,
        ...(options.pictures ? { pictures: options.pictures } : {}),
        ...(options.chosen ? { chosen: options.chosen } : {}),
        ...(live ? { pending: m.work_board_pending() } : {}),
      });
      const request = clipText(draft.request, REQUEST_TEXT);
      const opened = !!options.requests?.has(draft.card);
      const turns: RunTurns = { local: localReads(runs), exchange: options.exchange?.(runs) ?? [] };
      const words = requestTextSize(request, opened);
      // Where the words' first line ends, so the run's lines leave from them, not from past them.
      const said = request.trim();
      const single = measure(said, 17, 500);
      const requestPart = {
        id: draft.card,
        width: words.width,
        ...(single < RUN.request - 8 ? { end: Math.ceil(single) + 8 } : {}),
        height:
          measured.get(measureKey(draft.card, RUN.request, opened)) ??
          words.height + turnsHeight(turns),
      };
      const parts = runParts(draft.card, runs, recorded, alive, {
        search: m.work_part_search(),
        unread: m.work_part_failed(),
        computer: m.work_part_computer(),
      });
      const asked = options.asks?.(projection.work.id) ?? [];
      if (live)
        for (const part of parts) {
          const ask = asked.find((entry) => [part.id, part.key, part.host].includes(entry.part));
          if (ask) part.ask = { props: ask.props };
        }
      // What the run drew on: the lead records it as facts; a caller may add its own.
      const folders: string[] = [];
      const recordedInputs = uniqueInputs(
        runs.flatMap((run) =>
          (run.inputs ?? []).flatMap((fact): RunInputView[] =>
            fact.kind === "files"
              ? folderNames(snapshot, run, fact).map((folder) => {
                  if (folder.element) folders.push(folder.element);
                  return {
                    kind: "files",
                    label: folder.label,
                    lit: true,
                    folder: true,
                    ...(folder.element ? { element: folder.element } : {}),
                  };
                })
              : [
                  {
                    kind: fact.kind,
                    label: fact.label,
                    lit: true,
                    ...(fact.count ? { count: fact.count } : {}),
                  },
                ],
          ),
        ),
        shown,
      );
      const inputs = (options.inputs?.(runs) ?? recordedInputs).map((input, index) => ({
        id: `input:${draft.card}:${index}`,
        input,
      }));
      const headId = `head:${draft.card}`;
      const lead = leadEntries(snapshot, projection, draft.executions);
      // While the run waits on the person, the answer's place says so, not that it is coming.
      // A held page belongs to a part whose read is still running.
      const held = live && !!options.held?.(projection.work.id);
      const waiting = live
        ? (parts.find((part) => part.ask) ??
          (held
            ? parts.find((part) =>
                part.pages.some((page) => page.steps.some((step) => step.status === "running")),
              )
            : undefined))
        : undefined;
      const set = runObjects({
        board,
        head: headId,
        live,
        pending: waiting
          ? m.work_board_waiting({ site: siteName(waiting.host ?? waiting.title) })
          : held
            ? m.work_line_waiting_for_you()
            : m.work_board_pending(),
        lead: lead.entries,
        ...(options.fetched ? { fetched: options.fetched } : {}),
      });
      const legacyFound = foundByPart(board, parts);
      const found = new Map<string, string>();
      for (const object of set.objects) {
        const part = object.part
          ? parts.find((candidate) => candidate.key === object.part)?.id
          : legacyFound.get(object.id);
        if (part) found.set(object.id, part);
      }
      // A research part's notes (a list of what it read, not the person's own to-dos or
      // messages) are what it handed the lead, not something it found: its row keeps its
      // summary and the notes live in the part's opened view.
      const notes = new Map<string, RunObject[]>();
      const folded = new Set<string>();
      for (const object of set.objects) {
        const holder = found.get(object.id);
        const part = holder ? parts.find((candidate) => candidate.id === holder) : undefined;
        const view = object.view;
        if (
          part?.helper !== "research" ||
          view.kind !== "list" ||
          view.style === "todo" ||
          view.style === "messages" ||
          view.items.some((item) => !!item.from?.who || !!item.from?.app)
        )
          continue;
        folded.add(object.id);
        found.delete(object.id);
        notes.set(part.id, [...(notes.get(part.id) ?? []), object]);
      }
      // What a part found, joined to the pages it was taken from: those pages stand over
      // what they gave, not in the part's stack.
      const sourced = new Map<string, Set<string>>();
      const objects = set.objects.map((object) => {
        const holder = found.get(object.id);
        const part = holder ? parts.find((candidate) => candidate.id === holder) : undefined;
        if (!part || object.view.kind !== "picks") return object;
        const told = provenance(object.view, part.pages, runs, recorded);
        if (!told) return object;
        sourced.set(part.id, new Set([...(sourced.get(part.id) ?? []), ...told.used]));
        return { ...object, view: told.view };
      });
      for (const part of parts) {
        const used = sourced.get(part.id);
        if (used) part.pages = part.pages.filter((group) => !used.has(group.id));
      }
      const open = options.open ?? undefined;
      const range = (object: RunObject) => objectWidth(object.view);
      const sized = (object: RunObject, width: number, opened: boolean) =>
        measured.get(measureKey(object.id, width, opened)) ?? objectHeight(object.view, width);
      const pinned = new Set(objects.flatMap((object) => (pins.has(object.id) ? [object.id] : [])));
      const layout = boardLayout(
        objects
          .filter(
            (object) => !found.has(object.id) && !pinned.has(object.id) && !folded.has(object.id),
          )
          .map((object): LayoutBlock => ({
            id: object.id,
            kind: object.view.kind,
            emphasis: object.emphasis,
            ...(object.block?.group ? { group: object.block.group } : {}),
            width: range(object),
            height: (width) => sized(object, width, object.id === open),
          })),
        open ? { open } : {},
      );
      const reply = set.reply;
      const headWidth = reply
        ? Math.max(objectWidth(reply.view).min, Math.min(layout.width, objectWidth(reply.view).max))
        : 0;
      const head = reply
        ? { id: reply.id, width: headWidth, height: sized(reply, headWidth, false) }
        : undefined;
      const pinSizes = new Map(
        objects.flatMap((object) => {
          const pin = pins.get(object.id);
          if (!pin) return [];
          const width = range(object).ideal;
          return [[object.id, { ...pin, width, height: sized(object, width, false) }] as const];
        }),
      );
      // Work that overlapped in time stands in one column; later work, to its right.
      const phases = partColumns(parts);
      // In a column, in the order the work began.
      const rows = parts
        .map((part, index) => ({ part, index }))
        .sort(
          (a, b) =>
            phases[a.index]! - phases[b.index]! ||
            (a.part.began !== undefined && b.part.began !== undefined
              ? a.part.began - b.part.began
              : 0) ||
            a.index - b.index,
        )
        .map(({ part, index }) => ({
          phase: phases[index]!,
          ...(part.follows &&
          phases[parts.findIndex((other) => other.id === part.follows)] === phases[index]
            ? { after: part.follows }
            : {}),
          part: {
            id: part.id,
            ...partSize(
              partShape(part, projection),
              measured.get(measureKey(rowKey(part.id), 0, false)),
            ),
          },
          found: objects.flatMap((object) => {
            if (found.get(object.id) !== part.id || pinned.has(object.id)) return [];
            const width = Math.round(Math.min(FOUND, range(object).ideal));
            return [{ id: object.id, width, height: sized(object, width, object.id === open) }];
          }),
          feeds:
            part.state === "done" &&
            (part.pages.length > 0 || part.sources.length > 0 || !!part.lines?.length),
        }));
      const drawn = runSources(runs, recorded);
      const sourcesId = `sources:${draft.card}`;
      // Sources hold what a run read or cites: a block of search results it only passed over, or
      // of failures alone, is not drawn.
      const sources = drawn.rows.some((row) => row.used)
        ? {
            id: sourcesId,
            width: SOURCES,
            height: measured.get(measureKey(sourcesId, SOURCES, false)) ?? sourcesHeight(drawn),
          }
        : undefined;
      const run = {
        request: requestPart,
        ...(sources ? { sources } : {}),
        inputs: inputs.map((entry) => ({ id: entry.id, ...INPUT })),
        rows,
        ...(head ? { head } : {}),
        board: layout,
        pins: pinSizes,
      };
      let lane = placeRun(top, run);
      // The person's own things never move for a run: the run starts lower instead.
      // Each step clears at least one of them, so this ends.
      for (let left = around.length; left > 0; left -= 1) {
        const below = clearBelow(lane.rects, pinSizes, around);
        if (below === null) break;
        top = below;
        lane = placeRun(top, run);
      }
      const place = lane.rects[draft.card]!;
      stages.push({
        element: element.id,
        objective: projection.work.id,
        card: draft.card,
        request,
        executions: draft.executions,
        live,
        place,
        board,
        lane,
        trail,
        pinned,
        column: {
          parts: parts.map((part) => part.id),
          ...(head ? { head: head.id } : {}),
        },
        objects: objects,
        ...(reply ? { reply } : {}),
        revised: lead.revised,
        parts,
        inputs,
        found,
        ...(sources ? { sources: { id: sourcesId, view: drawn } } : {}),
        notes,
        turns,
        folders,
        targets: Object.fromEntries(
          Object.entries(lane.rects).map(([id, rect]) => [id, { x: rect.x, y: rect.y }]),
        ),
      });
      top = lane.extent + RUN.between;
    }
  }
  return stages;
}

/** What a part found stands at its row's end no wider than this (four cards), so the result keeps the view. */
const FOUND = 880;
/** The Sources under a result: a reading column of rows. */
const SOURCES = 560;
/** Rows the Sources show before Show all. */
export const SOURCE_ROWS = 6;
function sourcesHeight(drawn: ReturnType<typeof runSources>): number {
  const used = drawn.rows.filter((row) => row.used);
  const frames = used.some((row) => row.frame) ? 84 : 0;
  const rows = Math.min(SOURCE_ROWS, used.length);
  const more = used.length > SOURCE_ROWS || used.length < drawn.rows.length ? 32 : 0;
  return 28 + frames + rows * 32 + more + (drawn.unread.length ? 36 : 0);
}

type Box = { x: number; y: number; width: number; height: number };

/** The folders on the canvas that some run read, and so draws among its inputs. */
function runInputFolders(
  snapshot: WorkEnvironmentSnapshot,
  objectives: ReadonlyMap<string, WorkRuntimeProjection>,
): Set<string> {
  const claimed = new Set<string>();
  if (!snapshot.elements.some((element) => element.reference.kind === "folder")) return claimed;
  for (const element of snapshot.elements) {
    if (element.reference.kind !== "objective") continue;
    for (const run of objectives.get(element.reference.objective)?.executions ?? [])
      for (const fact of run.inputs ?? [])
        if (fact.kind === "files")
          for (const folder of folderNames(snapshot, run, fact))
            if (folder.element) claimed.add(folder.element);
  }
  return claimed;
}

/**
 * Where a run that touches one of the person's things must start instead:
 * just under the lowest thing its cards touch. Null when it touches none.
 * Blocks the person moved go with their run and are not counted.
 */
function clearBelow(
  rects: Readonly<Record<string, Box>>,
  pins: ReadonlyMap<string, unknown>,
  around: readonly Box[],
): number | null {
  let below: number | null = null;
  for (const [id, rect] of Object.entries(rects)) {
    if (pins.has(id)) continue;
    for (const thing of around)
      if (touches(rect, [thing]))
        below = Math.max(below ?? -Infinity, thing.y + thing.height + RUN.gutter);
  }
  return below === null ? null : Math.ceil(below / 8) * 8;
}

/**
 * Where the person's own things stand: exactly where they were put, always;
 * a run makes room for them, never the other way round. One with no place
 * yet stands in the nearest free room to `near` (the middle of the view),
 * clear of every run and of everything placed; without a `near`, in a column
 * left of every run, where no run ever grows.
 */
export function ownPlaces(
  positions: Readonly<Record<string, CanvasPosition>>,
  sizes: Readonly<Record<string, { width: number; height: number }>>,
  stages: readonly WorkStage[],
  /** The person's things with no place yet. */
  loose: readonly string[] = [],
  near?: CanvasPosition | null,
): Record<string, CanvasPosition> {
  const placed: Record<string, CanvasPosition> = { ...positions };
  const unplaced = loose.filter((id) => !positions[id]);
  if (!unplaced.length) return placed;
  const sizeOf = (id: string) => sizes[id] ?? { width: 280, height: 160 };
  const taken: Box[] = [
    ...stages.map((stage) => stage.lane.box),
    ...Object.entries(positions).map(([id, at]) => ({ ...at, ...sizeOf(id) })),
  ];
  const edge = stages.length
    ? Math.min(0, ...stages.map((stage) => stage.lane.box.x)) - RUN.gutter * 2
    : null;
  let below = stages.length ? Math.min(...stages.map((stage) => stage.lane.box.y)) : 120;
  for (const id of unplaced) {
    const size = sizeOf(id);
    let at: CanvasPosition;
    if (near) {
      const spot = freeSpot(near, size, taken);
      at = { x: Math.round(spot.x - size.width / 2), y: Math.round(spot.y - size.height / 2) };
    } else {
      at = { x: edge === null ? 80 : edge - size.width, y: below };
      for (let tries = taken.length; tries > 0; tries -= 1) {
        const hit = taken.find((rect) => touches({ ...at, ...size }, [rect]));
        if (!hit) break;
        at = { ...at, y: hit.y + hit.height + RUN.rowGap };
      }
      below = at.y + size.height + RUN.rowGap;
    }
    placed[id] = at;
    taken.push({ ...at, ...size });
  }
  return placed;
}
