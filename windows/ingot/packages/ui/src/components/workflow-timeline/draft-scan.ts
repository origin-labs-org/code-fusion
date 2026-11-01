import type { TimelineStation, WorkflowTimelineModel } from "./timeline-model.js";

export interface WorkflowDraftPhase {
  name: string;
  typing?: true;
}

export interface WorkflowDraft {
  phases: WorkflowDraftPhase[];
  
  agents: string[];
}

const TOKEN = /\b(phase|agent)\(\s*(?:(["'`])([^"'`\n]*)(\2)?)?/gu;

export function scanWorkflowDraft(script: string): WorkflowDraft {
  const phases: WorkflowDraftPhase[] = [];
  const agents: string[] = [];
  for (const match of script.matchAll(TOKEN)) {
    const [, kind, quote, body, closing] = match;
    if (quote === undefined) continue;
    const name = (body ?? "").split("${")[0]!.trim();
    const closed = closing !== undefined;
    if (kind === "phase") {
      const last = phases[phases.length - 1];
      if (last?.typing === true) {
        last.name = name;
        if (closed) delete last.typing;
        continue;
      }
      if (closed && phases.some((phase) => phase.name === name)) continue;
      phases.push({ name, ...(closed ? {} : { typing: true }) });
      continue;
    }
    if (!closed || name.length === 0) continue;
    if (!agents.includes(name)) agents.push(name);
  }
  return { agents, phases };
}

export function draftTimeline(draft: WorkflowDraft): WorkflowTimelineModel {
  const stations: TimelineStation[] = draft.phases.map((phase, i) => ({
    id: `draft:${i}`,
    naming: { id: `draft:${i}`, name: phase.name },
    onLoop: false,
    pills: [],
    rounds: 0,
    status: undefined,
    track: 0,
    visited: false,
    ...(phase.typing === true ? { typing: true as const } : {}),
  }));
  return {
    arcs: [],
    bands: [],
    draft: { agents: draft.agents.length },
    live: false,
    rails: stations.slice(1).map((_, i) => ({ from: i, ink: "faint" as const, to: i + 1 })),
    runningIndex: undefined,
    stations,
  };
}
