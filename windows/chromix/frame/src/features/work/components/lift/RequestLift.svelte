<script lang="ts">
  import type { IconSvgElement } from "@hugeicons/svelte";
  import type { WorkExecutionFact } from "$shared/ipc/bindings";
  import Icon from "$shared/ui/Icon";
  import FavIcon from "$shared/ui/FavIcon";
  import HostGlyph from "../cards/HostGlyph.svelte";
  import LiftHeader from "../LiftHeader.svelte";
  import LiftRow from "./LiftRow.svelte";
  import LiftSection from "./LiftSection.svelte";
  import { sourceRows, type SourceRow } from "../../lib/project-environment-stage";
  import { runTimeline, type TimelineGlyph } from "../../lib/run-timeline";
  import type { TrailIcon, TrailLine } from "../../lib/board/trail";
  import type { ObjectKind } from "../../lib/board/types";
  import { objectIcon } from "../../lib/object-kind";
  import {
    AccountSetting01Icon,
    Alert02Icon,
    ArrowRight01Icon,
    BrowserIcon,
    Clock01Icon,
    ComputerTerminal01Icon,
    File01Icon,
    HelpCircleIcon,
    Message01Icon,
    Search01Icon,
    SparklesIcon,
    Tick02Icon,
    UserIcon,
  } from "../../lib/icons";
  import * as m from "$shared/i18n/messages";
  /** A request opened: what its runs did, what they made, where they looked, and every step. */
  let {
    request,
    trail,
    runs,
    made,
    onsource,
    onmade,
    oncommand,
  }: {
    request: string;
    trail: readonly TrailLine[];
    runs: readonly WorkExecutionFact[];
    /** What the request's runs put on the canvas, in the order they made it. */
    made: readonly { id: string; title: string; kind: ObjectKind }[];
    onsource: (row: SourceRow) => void;
    onmade: (id: string) => void;
    oncommand?: (record: string) => void;
  } = $props();

  const TRAIL: Record<Exclude<TrailIcon, "live">, IconSvgElement> = {
    search: Search01Icon,
    page: BrowserIcon,
    knowledge: SparklesIcon,
    ask: HelpCircleIcon,
    steer: Message01Icon,
    file: File01Icon,
    command: ComputerTerminal01Icon,
    account: AccountSetting01Icon,
    time: Clock01Icon,
    stopped: Alert02Icon,
  };
  const STEP: Record<Exclude<TimelineGlyph, "page">, IconSvgElement> = {
    said: Message01Icon,
    search: Search01Icon,
    file: File01Icon,
    command: ComputerTerminal01Icon,
    ask: HelpCircleIcon,
    done: Tick02Icon,
  };

  const steps = $derived(
    runs.flatMap((run) => runTimeline(run).map((row) => ({ run: run.id, row }))),
  );
  const sources = $derived(
    runs
      .flatMap((run) => sourceRows(run))
      .filter((row, index, rows) => rows.findIndex((other) => other.key === row.key) === index),
  );
  /** Where the latest run stands, and how far it went. */
  const meta = $derived.by(() => {
    const last = runs.at(-1);
    if (!last) return "";
    const state = ["running", "approved", "cancel_requested"].includes(last.status)
      ? m.work_lift_run_live()
      : last.status === "completed" || last.status === "needs_review"
        ? m.work_lift_run_done()
        : last.status === "cancelled"
          ? m.work_lift_run_stopped()
          : m.work_lift_run_failed();
    if (!steps.length) return state;
    const count =
      steps.length === 1
        ? m.work_lift_run_steps_one()
        : m.work_lift_run_steps({ count: steps.length });
    return `${state} · ${count}`;
  });
</script>

<div class="request">
  <LiftHeader kind={m.work_env_request()} title={request} {meta} icon={UserIcon} whole />
  <div class="sections">
    {#if trail.length}<LiftSection title={m.work_run_did()}>
        {#each trail as line (line.key)}<LiftRow
            title={line.text}
            detail={line.detail ?? ""}
            mono={line.code}
            tone={line.live ? "live" : "plain"}
            onclick={line.command && oncommand ? () => oncommand(line.command!) : undefined}
          >
            {#snippet leading()}{#if line.icon === "live"}<FavIcon
                  image={null}
                  loading
                  size={14}
                />{:else}<Icon icon={TRAIL[line.icon]} size={16} />{/if}{/snippet}
          </LiftRow>{/each}
      </LiftSection>{/if}
    {#if made.length}<LiftSection title={m.work_run_made()} count={made.length}>
        {#each made as object (object.id)}<LiftRow
            title={object.title}
            onclick={() => onmade(object.id)}
          >
            {#snippet leading()}<Icon icon={objectIcon(object.kind)} size={16} />{/snippet}
          </LiftRow>{/each}
      </LiftSection>{/if}
    {#if sources.length}<LiftSection title={m.work_sources()} count={sources.length}>
        {#each sources as row (row.key)}<LiftRow
            title={row.title}
            detail={row.where}
            onclick={() => onsource(row)}
          >
            {#snippet leading()}<HostGlyph
                host={row.where}
                url={row.url}
                file={!!row.file}
                size={16}
              />{/snippet}
          </LiftRow>{/each}
      </LiftSection>{/if}
    {#if steps.length}
      <details class="steps">
        <summary
          ><span>{m.work_run_steps()}</span><span class="count">{steps.length}</span><Icon
            icon={ArrowRight01Icon}
            size={12}
          /></summary
        >
        <ol aria-label={m.work_lift_run_label()}>
          {#each steps as { run, row } (`${run}:${row.key}`)}<LiftRow
              title={row.where && row.glyph !== "said" ? `${row.what} ${row.where}` : row.what}
              detail={row.failure ?? ""}
              trailing={row.elapsed ?? ""}
              mono={row.glyph === "command"}
              wrap={row.glyph === "said"}
              tone={row.live
                ? "live"
                : row.failure
                  ? "failed"
                  : row.glyph === "said"
                    ? "quiet"
                    : "plain"}
            >
              {#snippet leading()}{#if row.glyph === "page"}<HostGlyph
                    host={row.where}
                    size={14}
                  />{:else}<Icon icon={STEP[row.glyph]} size={14} />{/if}{/snippet}
            </LiftRow>{/each}
        </ol>
      </details>
    {/if}
  </div>
</div>

<style>
  .request {
    display: flex;
    flex-direction: column;
  }

  .sections {
    display: flex;
    flex-direction: column;
    gap: 24px;
    padding-block-start: 12px;
  }

  .steps {
    border-block-start: 1px solid var(--color-border);
    padding-block-start: 16px;
  }

  summary {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--color-muted);
    font-size: var(--text-label);
    font-weight: 600;
    line-height: 16px;
    list-style: none;
    cursor: default;
    border-radius: var(--radius-inset);
  }

  summary::-webkit-details-marker {
    display: none;
  }

  summary:hover {
    color: var(--color-text);
  }

  summary:focus-visible {
    outline: 2px solid var(--color-ring);
    outline-offset: 2px;
  }

  summary :global(svg) {
    transition: transform var(--motion-fast) var(--ease-out);
  }

  .steps[open] summary :global(svg) {
    transform: rotate(90deg);
  }

  .count {
    color: var(--color-faint);
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }

  ol {
    display: flex;
    flex-direction: column;
    margin: 8px 0 0;
    padding: 0;
    list-style: none;
  }
</style>
