import type {
  WorkArtifactV1,
  WorkExecutionFact,
  WorkArtifactDataV1,
  WorkSignalV1,
  WorkEvidenceLink,
} from "$domain/work";
import type {
  ArtifactView,
  ArtifactContent,
  DocumentNodeView,
  EvidenceReference,
} from "$shared/ui/data/Artifact";
import { createSubscriber } from "svelte/reactivity";
import { loadMarkdown } from "$features/notes";
import * as m from "$shared/i18n/messages";
import { fileFolder } from "./work-files";

/** Hostname for a source label. Resolved here so a small lazy chunk that needs
 * one line of text does not pull the whole Artifact UI module with it. */
function displayHost(value: string | undefined): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.hostname.replace(/^www\./u, "") : "";
  } catch {
    return "";
  }
}

type Parse = Awaited<ReturnType<typeof loadMarkdown>>["parse"];
type ParsedNode = ReturnType<Parse>["doc"];
let parse: Parse | null = null;
let arrived: (() => void) | null = null;
/** A projection read before the parser arrived runs again once it has. */
const waiting = createSubscriber((update) => {
  arrived = update;
  return () => (arrived = null);
});
/** The notes parser loads beside Work rather than inside every graph that projects a result. */
void loadMarkdown().then(
  (module) => {
    parse = module.parse;
    arrived?.();
  },
  () => {},
);
/**
 * An answer's Markdown as the notes parser reads it, in the view's own shape:
 * anything the subset refuses and still arrives (a raw block, a wiki link)
 * stays its written text.
 */
function answerBlock(node: ParsedNode): DocumentNodeView {
  const attrs = node.attrs ?? {};
  if (node.type === "rawBlock")
    return { type: "paragraph", content: [{ type: "text", text: String(attrs.source ?? "") }] };
  if (node.type === "rawInline" || node.type === "wikiLink")
    return {
      type: "text",
      text: String(attrs.source ?? attrs.alias ?? attrs.target ?? ""),
      marks: (node.marks ?? []).map((mark) => ({ type: mark.type })),
    };
  return {
    type: node.type ?? "paragraph",
    ...(node.text !== undefined ? { text: node.text } : {}),
    ...(node.marks?.length ? { marks: node.marks.map((mark) => ({ type: mark.type })) } : {}),
    ...(node.type === "heading" ? { attrs: { level: Number(attrs.level ?? 2) } } : {}),
    ...(node.type === "orderedList" ? { attrs: { start: Number(attrs.start ?? 1) } } : {}),
    ...(node.type === "codeBlock"
      ? { attrs: { language: typeof attrs.language === "string" ? attrs.language : null } }
      : {}),
    ...(node.content?.length ? { content: node.content.map(answerBlock) } : {}),
  };
}
/** Projections repeat per render; an answer is parsed once while it is recent. */
const parsed = new Map<string, DocumentNodeView[]>();
function answerBlocks(markdown: string): DocumentNodeView[] {
  if (!parse) {
    waiting();
    // Until then its paragraphs as written.
    return markdown
      .split(/\n{2,}/u)
      .filter((text) => text.trim())
      .map((text) => ({ type: "paragraph", content: [{ type: "text", text }] }));
  }
  let blocks = parsed.get(markdown);
  if (!blocks) {
    blocks = (parse(markdown).doc.content ?? []).map(answerBlock);
    if (parsed.size >= 32) parsed.delete(parsed.keys().next().value!);
    parsed.set(markdown, blocks);
  }
  return blocks;
}

type Refs = (indices: readonly number[] | undefined) => EvidenceReference[];
function subjects(
  list:
    | readonly {
        name: string;
        descriptor?: string | null;
        homepage?: string | null;
        image_candidates?: readonly string[] | null;
        record_media?: import("$shared/ipc/bindings").WorkRecordMediaRefV1 | null;
        media_attempted?: boolean;
      }[]
    | undefined,
) {
  return (list ?? []).map((subject) => ({
    name: subject.name,
    ...(subject.record_media ? { recordMedia: subject.record_media } : {}),
    ...(subject.media_attempted ? { mediaAttempted: true } : {}),
    ...(subject.descriptor ? { descriptor: subject.descriptor } : {}),
    ...(subject.homepage ? { homepage: subject.homepage } : {}),
    ...(subject.image_candidates?.length
      ? { imageCandidates: subject.image_candidates.slice(0, 3) }
      : {}),
  }));
}
function content(data: WorkArtifactDataV1, refs: Refs): ArtifactContent {
  switch (data.kind) {
    case "document":
      return {
        kind: "document",
        paragraphs: data.paragraphs,
        ...(data.formatted ? { formatted: data.formatted } : {}),
      };
    case "table":
    case "comparison":
    case "checklist":
      return data;
    case "chart":
      return {
        kind: "chart",
        xLabel: data.x_label,
        yLabel: data.y_label,
        series: data.series.map((entry) => ({
          name: entry.name,
          points: entry.points.map((point) => ({
            label: point.label,
            value: point.value,
            ...(point.evidence?.length ? { evidence: refs(point.evidence) } : {}),
          })),
        })),
        ...(data.basis
          ? {
              basis: {
                method: data.basis.method,
                ...(data.basis.conditions ? { conditions: data.basis.conditions } : {}),
                ...(data.basis.versions ? { versions: data.basis.versions } : {}),
                ...(data.basis.observed_at ? { observedAt: data.basis.observed_at } : {}),
              },
            }
          : {}),
        generalKnowledge: !!data.general_knowledge,
      };
    case "evidence_collection":
      return {
        kind: "sources",
        summary: data.summary,
        subjects: subjects(data.subjects),
        entries: (data.entries ?? []).flatMap((entry) => {
          const [evidence] = refs([entry.evidence]);
          return evidence
            ? [
                {
                  evidence,
                  title: entry.title,
                  role: entry.role,
                  ...(entry.subject !== null && entry.subject !== undefined
                    ? { subject: entry.subject }
                    : {}),
                },
              ]
            : [];
        }),
      };
    case "comparison_matrix":
      return {
        kind: "matrix",
        subjects: subjects(data.subjects),
        criteria: data.criteria.map((criterion) => ({
          name: criterion.name,
          kind: criterion.kind.kind,
          ...(criterion.kind.kind === "measurement"
            ? { unit: criterion.kind.unit, basis: criterion.kind.basis }
            : criterion.kind.kind === "rating"
              ? { rubric: criterion.kind.rubric, scaleMax: criterion.kind.scale_max }
              : {}),
        })),
        cells: data.cells.map((row) =>
          row.map((cell) => ({
            value:
              cell.value.kind === "money"
                ? {
                    kind: "money",
                    amount: cell.value.amount,
                    currency: cell.value.currency,
                    ...(cell.value.observed_at ? { observedAt: cell.value.observed_at } : {}),
                  }
                : cell.value,
            evidence: refs(cell.evidence),
            ...(cell.note ? { note: cell.note } : {}),
            generalKnowledge: !!cell.general_knowledge,
          })),
        ),
        notes: data.notes ?? [],
      };
    case "findings":
      return {
        kind: "findings",
        subjects: subjects(data.subjects),
        items: data.items.map((item) => ({
          claim: item.claim,
          ...(item.subject !== null && item.subject !== undefined ? { subject: item.subject } : {}),
          evidence: refs(item.evidence),
          confidence: item.confidence,
          ...(item.detail ? { detail: item.detail } : {}),
          generalKnowledge: !!item.general_knowledge,
        })),
      };
    case "browser_resource_preview":
      return { kind: "browser", title: data.title, location: data.url, summary: data.summary };
    case "diagram":
      return {
        kind: "diagram",
        nodes: data.nodes.map((node) => ({
          id: node.id,
          name: node.name,
          kind: node.kind,
          ...(node.vendor ? { vendor: node.vendor } : {}),
          ...(node.note ? { note: node.note } : {}),
          ...(node.layer ? { layer: node.layer } : {}),
        })),
        edges: data.edges.map((edge) => ({
          from: edge.from,
          to: edge.to,
          ...(edge.label ? { label: edge.label } : {}),
        })),
        layers: data.layers ?? [],
      };
    case "answer":
      return { kind: "answer", markdown: data.markdown, blocks: answerBlocks(data.markdown) };
    case "code":
      return {
        kind: "code",
        language: data.language,
        text: data.text,
        notes: (data.notes ?? []).map((note) => ({
          from: note.from,
          to: note.to,
          text: note.text,
        })),
      };
    default:
      // Lead objects render through their own components, not this adapter.
      return { kind: "document", paragraphs: [] };
  }
}

/**
 * Recognizable source labels: the citation's title, else its site, else what
 * kind of source it is. Never a number: "Source 10" tells a person nothing.
 */
function evidenceReferences(
  links: readonly WorkEvidenceLink[],
  execution: WorkExecutionFact,
): EvidenceReference[] {
  return links.map((link) => {
    const key = `${link.extraction_id}:${link.source_id}`;
    const record = execution.provider_evidence?.find((record) => record.id === link.extraction_id);
    const citation = record?.evidence.citations[link.source_id - 1];
    const origin = displayHost(citation?.url);
    if (!citation?.url)
      // A granted folder is not a web address: a file cites its own name.
      for (const entry of execution.file_evidence ?? [])
        if (entry.id === link.extraction_id)
          return {
            key,
            label: entry.file.name,
            origin: fileFolder(entry.file.path),
            file: { record: entry.id, path: entry.file.path },
          };
    return {
      key,
      label: citation?.title?.trim() || origin || m.work_env_page(),
      ...(origin ? { origin } : {}),
      ...(citation?.url ? { url: citation.url } : {}),
    };
  });
}

export function artifactView(artifact: WorkArtifactV1, execution: WorkExecutionFact): ArtifactView {
  const user = execution.user_artifacts?.find((value) => value.artifact === artifact.id);
  const links = user?.edited_data ? user.evidence : artifact.evidence;
  const evidence = evidenceReferences(links, execution);
  const refs: Refs = (indices) =>
    (indices ?? []).flatMap((index) => (evidence[index] ? [evidence[index]] : []));
  return {
    key: artifact.id,
    title: artifact.title,
    content: content(user?.edited_data ?? artifact.data, refs),
    // A result reads as finished; only the person's own decision says more.
    reviewLabel:
      user?.decision === "accepted"
        ? m.work_accepted()
        : user?.decision === "rejected"
          ? m.work_rejected()
          : m.work_env_status_done(),
    evidence,
    ...(knowledge(artifact, user?.edited_data ?? artifact.data) ? { knowledge: true } : {}),
  };
}

/** Marked as the agent's own knowledge rather than a source, as a whole or as a chart. */
const knowledge = (artifact: WorkArtifactV1, data: WorkArtifactDataV1) =>
  artifact.general_knowledge ?? (data.kind === "chart" && !!data.general_knowledge);

const ACTIVITY_LABELS: Record<WorkSignalV1["activity"], () => string> = {
  planning: m.work_activity_planning,
  delegating: m.work_activity_delegating,
  searching: m.work_activity_searching,
  reading: m.work_activity_reading,
  interacting: m.work_activity_interacting,
  verifying: m.work_activity_verifying,
  recovering: m.work_activity_recovering,
  comparing: m.work_activity_comparing,
  producing_artifact: m.work_activity_producing,
  paused: m.work_activity_paused,
  waiting_for_approval: m.work_activity_approval,
  waiting_for_human: m.work_activity_human,
  cancelling: m.work_activity_cancelling,
  finishing: m.work_activity_finishing,
};
/** What a live attempt is doing, in a few words. */
export function activityLabel(activity: string): string | undefined {
  return (ACTIVITY_LABELS as Record<string, (() => string) | undefined>)[activity]?.();
}
