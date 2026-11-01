import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRightIcon, CircleHelpIcon } from "lucide-react";
import type { WorkflowRunPendingQuestion, WorkflowRunState } from "@origin-ai/cf-shared/cf-protocol-v4";
import { cn } from "@/components/lib/utils.js";
import { phaseDisplayName } from "@/components/workflow-graph/phase-name.js";
import type { WorkflowCausalityGraphData } from "@/components/workflow-graph/types.js";
import type { WorkflowTimelineModel } from "@/components/workflow-timeline/timeline-model.js";
import {
  ROSTER_PINS_PANE,
  pillInstanceKey,
  rosterMore,
  rosterRestCounts,
  rosterRoll,
  stationRosterOf,
} from "@/components/workflow-timeline/roster-model.js";
import { WorkflowAgentPill } from "@/components/workflow-timeline/WorkflowAgentPill.js";
import { WorkflowMoreRow } from "@/components/workflow-timeline/WorkflowMoreRow.js";
import { WorkflowRoll } from "@/components/workflow-timeline/WorkflowRoll.js";
import { RosterMeter } from "@/components/workflow-timeline/WorkflowRosterParts.js";
import { WorkflowRunQuestionRow } from "@/app-shell/WorkflowRunQuestionRow.js";
import {
  AvatarCluster,
  Rounds,
  SpineJointRow,
  SpineLamp,
  SpinePieces,
  useWorkflowActorModelLabels,
} from "@/app-shell/WorkflowRunSpineParts.js";
import { phasePillRenderers } from "@/app-shell/WorkflowRunPhasePills.js";
import { spineLayout } from "@/app-shell/workflowRunSpine.js";
import {
  FillHeadingRow,
  HoleWaitingBody,
  SpineHoleLamp,
} from "@/app-shell/WorkflowRunHoleParts.js";
import { useSpineFillFrames } from "@/app-shell/WorkflowRunFillFrames.js";
import { HoleFillMark } from "@/components/workflow-timeline/WorkflowHoleParts.js";
import type { WorkflowActorInstance } from "@/app-shell/workflowRunPanel.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";

const QUESTION_TICK_MS = 30_000;

const LANDING_MS = 1200;

function questionKey(question: WorkflowRunPendingQuestion): string | undefined {
  return question.actorSiteId === undefined || question.actorOrdinal === undefined
    ? undefined
    : `${question.actorSiteId}@${question.actorOrdinal}`;
}

const pillKey = pillInstanceKey;

export const WorkflowRunPhaseList = memo(function WorkflowRunPhaseList({
  graph,
  landing,
  model,
  onOpenActor,
  onOpenWorkspace,
  pendingQuestions,
  run,
  subagentModelProviderName,
}: {
  graph: WorkflowCausalityGraphData;
  model: WorkflowTimelineModel;
  run: WorkflowRunState | undefined;
  pendingQuestions: readonly WorkflowRunPendingQuestion[];
  
  onOpenActor?: (instance: WorkflowActorInstance) => void;
  
  onOpenWorkspace?: (phaseId: string) => void;
  
  landing?: { phaseId: string; key: string };
  
  subagentModelProviderName?: (providerId: string) => string | undefined;
}) {
  const { intl } = useCfIntl();
  const format = intl.formatMessage.bind(intl);
  const actorModels = useWorkflowActorModelLabels(run?.actors, subagentModelProviderName);
  const runningKey = model.stations
    .filter((station) => station.status === "running")
    .map((station) => station.id)
    .join("\u0000");
  const runningIds = useMemo(
    () => (runningKey === "" ? [] : runningKey.split("\u0000")),
    [runningKey],
  );
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(runningIds));
  useEffect(() => {
    setOpen((previous) =>
      runningIds.every((id) => previous.has(id)) ? previous : new Set([...previous, ...runningIds]),
    );
  }, [runningIds]);
  const toggle = useCallback((id: string) => {
    setOpen((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const [listed, setListed] = useState<ReadonlySet<string>>(() => new Set());
  const toggleListed = useCallback((id: string) => {
    setListed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const rootRef = useRef<HTMLDivElement>(null);
  const landedOnceRef = useRef<string | undefined>(undefined);
  const [landed, setLanded] = useState<{ phaseId: string; key: string } | undefined>(undefined);
  useEffect(() => {
    if (landing === undefined || landedOnceRef.current === landing.key) return undefined;
    landedOnceRef.current = landing.key;
    const { phaseId } = landing;
    setOpen((previous) => (previous.has(phaseId) ? previous : new Set([...previous, phaseId])));
    setListed((previous) => (previous.has(phaseId) ? previous : new Set([...previous, phaseId])));
    setLanded(landing);
    const timer = setTimeout(
      () => setLanded((current) => (current?.key === landing.key ? undefined : current)),
      LANDING_MS,
    );
    return () => clearTimeout(timer);
  }, [landing]);
  useEffect(() => {
    if (landed === undefined) return;
    const root = rootRef.current;
    if (root === null) return;
    const section = [...root.querySelectorAll<HTMLElement>("[data-phase-id]")].find(
      (candidate) => candidate.getAttribute("data-phase-id") === landed.phaseId,
    );
    const head = section?.querySelector<HTMLElement>('[data-testid="workflow-run-phase-toggle"]');
    if (head === undefined || head === null || typeof head.scrollIntoView !== "function") return;
    const reduced =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    head.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  }, [landed]);

  const [now, setNow] = useState(() => Date.now());
  const hasQuestions =
    pendingQuestions.length > 0 ||
    model.stations.some((station) => station.hole?.state === "waiting");
  useEffect(() => {
    if (!hasQuestions) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), QUESTION_TICK_MS);
    return () => clearInterval(timer);
  }, [hasQuestions]);
  const waitingHoleKey = model.stations
    .filter((station) => station.hole?.state === "waiting")
    .map((station) => station.id)
    .join("\u0000");
  useEffect(() => {
    if (waitingHoleKey === "") return;
    const ids = waitingHoleKey.split("\u0000");
    setOpen((previous) =>
      ids.every((id) => previous.has(id)) ? previous : new Set([...previous, ...ids]),
    );
  }, [waitingHoleKey]);

  const questionsByInstance = useMemo(() => {
    const byKey = new Map<string, WorkflowRunPendingQuestion[]>();
    for (const question of pendingQuestions) {
      const key = questionKey(question);
      if (key === undefined) continue;
      const list = byKey.get(key) ?? [];
      list.push(question);
      byKey.set(key, list);
    }
    return byKey;
  }, [pendingQuestions]);
  const attachedKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const station of model.stations) {
      for (const pill of station.pills) {
        const key = pillKey(pill);
        if (key !== undefined) keys.add(key);
      }
    }
    return keys;
  }, [model]);
  const orphanQuestions = pendingQuestions.filter((question) => {
    const key = questionKey(question);
    return key === undefined || !attachedKeys.has(key);
  });
  const spine = spineLayout(model);
  const fillFrames = useSpineFillFrames(rootRef, model);
  const textColumn = spine.gutter === 0 ? undefined : { paddingLeft: 39 + spine.gutter };
  const { nameOf, pillProps, renderPill } = phasePillRenderers({
    actorModels,
    format,
    graph,
    model,
    now,
    questionsByInstance,
    run,
    ...(onOpenActor === undefined ? {} : { onOpenActor }),
    ...(onOpenWorkspace === undefined ? {} : { onOpenWorkspace }),
  });

  return (
    <div
      className="wf-motion relative flex min-h-0 flex-1 flex-col overflow-auto pb-3 pt-2.5"
      data-testid="workflow-run-phases"
      ref={rootRef}
      {...fillFrames.handlers}
    >
      {fillFrames.frames}
      {model.stations.map((station, index) => {
        const expanded = open.has(station.id);
        const name = phaseDisplayName(station.naming, format);
        const status = station.status ?? "pending";
        const pending = status === "pending";
        const section = spine.sections[index] ?? { rails: [] };
        const roster = stationRosterOf(station, ROSTER_PINS_PANE);
        const hole = station.hole;
        const headings = (model.fills ?? []).filter((fill) => fill.from === index);
        const column = textColumn;
        return (
          <Fragment key={station.id}>
            <SpineJointRow joint={section.fork} kind="fork" pitch={spine.pitch} />
            {headings.map((heading) => (
              <FillHeadingRow
                fill={heading}
                fresh={fillFrames.fresh.has(heading.holeId)}
                key={heading.holeId}
                on={fillFrames.active === heading.holeId}
                onSelect={() => toggle(station.id)}
                textColumn={textColumn}
              />
            ))}
            <section
              className="relative"
              data-phase-fill={station.fill}
              data-phase-hole={hole?.state}
              data-phase-id={station.id}
              data-phase-landed={landed?.phaseId === station.id ? "true" : undefined}
              data-phase-open={expanded ? "true" : "false"}
              data-phase-status={status}
              data-phase-track={station.track}
              data-testid="workflow-run-phase"
            >
              <SpinePieces pitch={spine.pitch} section={section} />
              <button
                aria-expanded={expanded}
                aria-label={intl.formatMessage(
                  {
                    id: expanded
                      ? "chat.toolCall.workflow.run.phase.collapse"
                      : "chat.toolCall.workflow.run.phase.expand",
                  },
                  { name },
                )}
                className={cn(
                  "wf-station-open relative flex h-9 w-full items-center gap-2 pl-[39px] pr-3 text-left outline-none transition-colors hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring/40",
                  landed?.phaseId === station.id && "wf-landed",
                )}
                data-testid="workflow-run-phase-toggle"
                key={landed?.phaseId === station.id ? landed.key : "head"}
                onClick={() => toggle(station.id)}
                style={column}
                type="button"
              >
                {hole !== undefined && hole.state !== "filled" ? (
                  <SpineHoleLamp hole={hole} pitch={spine.pitch} track={station.track} />
                ) : (
                  <SpineLamp pitch={spine.pitch} status={status} track={station.track} />
                )}
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-ui-base",
                    pending ? "text-foreground-subtle" : "font-medium text-foreground",
                  )}
                >
                  {name}
                </span>
                {hole?.state === "filled" ? <HoleFillMark holeId={hole.siteId} /> : null}
                <span className="flex shrink-0 items-center gap-2.5 font-mono text-ui-xs tabular-nums text-foreground-subtlest">
                  {expanded ? null : roster !== undefined ? (
                    <RosterMeter counts={roster.counts} mini />
                  ) : (
                    <AvatarCluster nameOf={nameOf} pills={station.pills} />
                  )}
                  {station.fraction === undefined ? null : (
                    <span data-testid="workflow-run-phase-fraction">
                      {station.fraction.settled}/{station.fraction.observed}
                    </span>
                  )}
                  <Rounds station={station} />
                  <ChevronRightIcon
                    aria-hidden
                    className={cn("size-3.5 transition-transform", expanded && "rotate-90")}
                  />
                </span>
              </button>
              {expanded ? (
                <div
                  className="wf-unfold flex flex-col gap-1.5 pb-3 pl-[39px] pr-3 pt-0.5"
                  data-testid="workflow-run-phase-body"
                  style={column}
                >
                  {hole?.state === "waiting" ? <HoleWaitingBody hole={hole} now={now} /> : null}
                  {roster === undefined ? (
                    station.pills.map(renderPill)
                  ) : (
                    <>
                      <div className="flex flex-col gap-1.5" data-testid="workflow-roster-pins">
                        {roster.pinned.map(renderPill)}
                      </div>
                      <WorkflowMoreRow
                        door={{
                          open: listed.has(station.id),
                          tally: rosterRestCounts(roster),
                        }}
                        more={rosterMore(roster)}
                        onOpen={() => toggleListed(station.id)}
                      />
                      {listed.has(station.id) ? (
                        <WorkflowRoll
                          groups={rosterRoll(roster)}
                          unlisted={roster.unlisted.actors}
                          renderRow={(pill, enterDelayMs) => (
                            <WorkflowAgentPill
                              enterDelayMs={enterDelayMs}
                              key={pill.key}
                              size="row"
                              {...pillProps(pill)}
                            >
                              {}
                              {pill.asking === true ? (
                                <CircleHelpIcon
                                  aria-hidden
                                  className="size-3 shrink-0 text-warning"
                                  data-testid="workflow-roll-asking"
                                />
                              ) : null}
                            </WorkflowAgentPill>
                          )}
                        />
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}
            </section>
            <SpineJointRow joint={section.merge} kind="merge" pitch={spine.pitch} />
          </Fragment>
        );
      })}
      {orphanQuestions.length === 0 ? null : (
        <div
          className="flex flex-col gap-1 pl-[39px] pr-3 pt-2"
          data-testid="workflow-run-orphan-questions"
          style={textColumn}
        >
          <span className="text-ui-xs font-medium text-foreground-subtle">
            {intl.formatMessage({ id: "chat.toolCall.workflow.run.questions.title" })}
          </span>
          {orphanQuestions.map((question) => (
            <WorkflowRunQuestionRow key={question.qid} now={now} question={question} showAsker />
          ))}
        </div>
      )}
    </div>
  );
});
