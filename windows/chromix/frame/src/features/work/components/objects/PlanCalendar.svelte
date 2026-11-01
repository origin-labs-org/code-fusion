<script lang="ts">
  import { tick } from "svelte";
  import { Popover } from "bits-ui";
  import Icon from "$shared/ui/Icon";
  import * as m from "$shared/i18n/messages";
  import "$shared/ui/Menu/popover.css";
  import type { ObjectActions, OwnedData, PlanView } from "../../lib/board/types";
  import {
    CALENDAR,
    SHOWN,
    firstWeekday,
    weekHeight,
    type CalendarDay,
    type CalendarRow,
    type CalendarSlot,
    type CalendarWeek,
  } from "../../lib/board/plan-calendar";
  import { Tick02Icon } from "./icons";
  /**
   * A dated plan as its weeks. Only the weeks that hold something stand; a run
   * of quiet ones is one line. A month the person turns to keeps all its weeks.
   */
  let {
    object,
    rows,
    month = false,
    actions = {},
  }: {
    object: PlanView;
    rows: CalendarRow[];
    /** One month of the person's own calendar: every week stands at the same height. */
    month?: boolean;
    actions?: ObjectActions;
  } = $props();
  const weekdays = $derived.by(() => {
    const first = firstWeekday();
    const format = new Intl.DateTimeFormat(undefined, { weekday: "short" });
    // 2024-01-01 was a Monday: day 1 of the week counting from it.
    return Array.from({ length: 7 }, (_, index) =>
      format.format(new Date(2024, 0, ((first - 1 + index) % 7) + 1)),
    );
  });
  const dateOf = (value: string) => {
    const [year, mon, date] = value.split("-").map(Number);
    return new Date(year!, mon! - 1, date!);
  };
  const monthDay = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
  const label = (day: CalendarDay) =>
    day.opens ? monthDay.format(dateOf(day.date)) : String(day.day);
  const railShort = new Intl.DateTimeFormat(undefined, { month: "short" });
  const railLong = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
  const rail = (key: string, format: Intl.DateTimeFormat) => format.format(dateOf(`${key}-01`));
  const range = (from: string, to: string) => monthDay.formatRange(dateOf(from), dateOf(to));
  /** The person's own calendar: a day takes a new event where it is clicked, an event its new name. */
  const editable = $derived(!!actions.edit);
  let adding = $state<string | null>(null);
  let renaming = $state<number | null>(null);
  type Step = Extract<OwnedData, { kind: "plan" }>["steps"][number];
  const change = (steps: (current: Step[]) => Step[]) =>
    actions.edit?.(object.id, (data) =>
      data.kind === "plan" ? { ...data, steps: steps([...data.steps]) } : data,
    );
  async function begin(date: string) {
    if (!editable || renaming !== null) return;
    adding = date;
    await tick();
    document.querySelector<HTMLInputElement>(`[data-adding="${date}"]`)?.focus();
  }
  function commitNew(field: HTMLInputElement, date: string) {
    if (adding !== date) return;
    const title = field.value.trim();
    adding = null;
    if (!title) return;
    change((steps) =>
      [...steps, { title, date, kind: "event" } as Step].sort((a, b) =>
        (a.date ?? "").localeCompare(b.date ?? ""),
      ),
    );
  }
  async function rename(index: number) {
    if (!editable) return;
    renaming = index;
    await tick();
    const field = document.querySelector<HTMLInputElement>(`[data-renaming="${index}"]`);
    field?.focus();
    field?.select();
  }
  function commitName(field: HTMLInputElement, index: number) {
    if (renaming !== index) return;
    const title = field.value.trim();
    renaming = null;
    if (title === object.steps[index]?.title) return;
    change((steps) =>
      title
        ? steps.map((step, at) => (at === index ? { ...step, title } : step))
        : steps.filter((_, at) => at !== index),
    );
  }
  const keys =
    (commit: (field: HTMLInputElement) => void, cancel: () => void) => (event: KeyboardEvent) => {
      if (event.isComposing) return;
      const field = event.currentTarget as HTMLInputElement;
      if (event.key === "Enter") {
        event.preventDefault();
        commit(field);
      } else if (event.key === "Escape") cancel();
    };
  const longDate = new Intl.DateTimeFormat(undefined, { dateStyle: "full" });
  const spoken = (day: CalendarDay) => longDate.format(dateOf(day.date));
  const toggles = $derived(!editable && object.checkable && !!actions.check);
  /** A bar stands for several days' steps: it is done when they all are. */
  function toggle(slot: CalendarSlot) {
    for (const index of slot.steps) actions.check?.(object.id, index, !slot.done);
  }
  const barTitle = (slot: CalendarSlot) => `${slot.title} · ${range(slot.from, slot.to)}`;
  // A month's weeks all stand as tall as a full day: room to click into and type in.
  const height = (week: CalendarWeek) => weekHeight(week.lanes, week.lines, month ? SHOWN : 0);
</script>

{#snippet event(index: number)}
  {@const step = object.steps[index]!}
  {#if renaming === index}<input
      class="field nodrag nopan"
      data-renaming={index}
      value={step.title}
      aria-label={step.title}
      onblur={(event) => commitName(event.currentTarget, index)}
      onkeydown={keys(
        (field) => commitName(field, index),
        () => (renaming = null),
      )}
    />{:else if editable}<button
      type="button"
      class="step nodrag nopan"
      title={step.detail ? `${step.title} — ${step.detail}` : step.title}
      onclick={() => void rename(index)}
      ><i class="mark"></i><span class="title">{step.title}</span></button
    >{:else if object.checkable && actions.check}<button
      type="button"
      class="step nodrag nopan"
      title={step.detail ? `${step.title} — ${step.detail}` : step.title}
      aria-pressed={!!step.done}
      onclick={() => actions.check?.(object.id, index, !step.done)}
      >{#if step.done}<Icon icon={Tick02Icon} size={11} />{:else}<i class="mark"></i>{/if}<span
        class="title">{step.title}</span
      ></button
    >{:else}<span class="step" title={step.detail ? `${step.title} — ${step.detail}` : step.title}
      >{#if step.done}<Icon icon={Tick02Icon} size={11} />{:else}<i class="mark"></i>{/if}<span
        class="title">{step.title}</span
      ></span
    >{/if}
{/snippet}

<div
  class="calendar"
  role="grid"
  aria-label={object.title}
  style:--gutter={`${CALENDAR.gutter}px`}
  style:--cell={`${CALENDAR.cell}px`}
  style:--head={`${CALENDAR.head}px`}
  style:--quiet={`${CALENDAR.quiet}px`}
  style:--pad={`${CALENDAR.pad}px`}
  style:--item={`${CALENDAR.item}px`}
  style:--number={`${CALENDAR.number}px`}
>
  <div class="weekdays" role="row">
    <span class="rail" aria-hidden="true"></span>
    {#each weekdays as weekday (weekday)}<span role="columnheader">{weekday}</span>{/each}
  </div>
  {#each rows as row, at (at)}
    {#if row.kind === "quiet"}
      <div class="quiet" role="row" style:block-size={`${CALENDAR.quiet + CALENDAR.rule}px`}>
        <span role="gridcell" aria-colspan="8"
          >{m.work_plan_quiet_weeks({ count: row.weeks })}<span class="dates">
            {range(row.from, row.to)}</span
          ></span
        >
      </div>
    {:else}
      <div class="week" role="row" style:block-size={`${height(row)}px`}>
        <span
          class="rail"
          aria-hidden="true"
          title={row.month ? rail(row.month, railLong) : undefined}
          >{row.month ? rail(row.month, railShort) : ""}</span
        >
        {#each row.days as day (day.date)}
          {@const shown = day.steps.length > SHOWN ? day.steps.slice(0, SHOWN - 1) : day.steps}
          <div
            class="day"
            class:outside={day.outside}
            class:today={day.today}
            class:weekend={day.weekend}
            class:editable
            role="gridcell"
            aria-label={spoken(day)}
            tabindex={editable ? -1 : undefined}
            onclick={(event) => {
              if (event.target === event.currentTarget) void begin(day.date);
            }}
            onkeydown={(event) => {
              if (event.key === "Enter" && event.target === event.currentTarget)
                void begin(day.date);
            }}
          >
            <span class="number" class:opens={day.opens}>{label(day)}</span>
            {#if day.slots.length || day.steps.length}
              <ul>
                {#each day.slots as slot, lane (lane)}
                  <li
                    class="bar {slot?.kind ?? ''}"
                    class:empty={!slot}
                    class:starts={slot?.starts}
                    class:ends={slot?.ends}
                    class:done={slot?.done}
                    aria-hidden={slot?.head ? undefined : true}
                  >
                    {#if slot?.head}
                      {#if toggles}<button
                          type="button"
                          class="step label nodrag nopan"
                          style:--span={slot.span}
                          style:--lose={`${(slot.starts ? 4 : 0) + (slot.ends ? 4 : 0)}px`}
                          title={barTitle(slot)}
                          aria-pressed={slot.done}
                          onclick={() => toggle(slot)}
                          >{#if slot.done}<Icon icon={Tick02Icon} size={11} />{:else}<i class="mark"
                            ></i>{/if}<span class="title">{slot.title}</span></button
                        >{:else}<span
                          class="step label"
                          style:--span={slot.span}
                          style:--lose={`${(slot.starts ? 4 : 0) + (slot.ends ? 4 : 0)}px`}
                          title={barTitle(slot)}
                          >{#if slot.done}<Icon icon={Tick02Icon} size={11} />{:else}<i class="mark"
                            ></i>{/if}<span class="title">{slot.title}</span></span
                        >{/if}
                    {/if}
                  </li>
                {/each}
                {#each shown as index (index)}
                  {@const step = object.steps[index]!}
                  <li class="chip {step.kind}" class:done={step.done}>
                    {@render event(index)}
                  </li>
                {/each}
                {#if day.steps.length > SHOWN}
                  <li class="rest">
                    <Popover.Root>
                      <Popover.Trigger
                        class="more nodrag nopan"
                        aria-label={`${m.work_plan_more_events({ count: day.steps.length - shown.length })}, ${spoken(day)}`}
                        >{m.work_plan_more_events({
                          count: day.steps.length - shown.length,
                        })}</Popover.Trigger
                      >
                      <Popover.Portal>
                        <Popover.Content
                          class="ui-menu ui-popover"
                          data-menu-material="opaque"
                          side="bottom"
                          align="start"
                          sideOffset={6}
                          collisionPadding={12}
                          aria-label={spoken(day)}
                        >
                          <div class="all" style:--item={`${CALENDAR.item}px`}>
                            <p>{spoken(day)}</p>
                            <ul>
                              {#each day.steps as index (index)}
                                {@const step = object.steps[index]!}
                                <li class="chip {step.kind}" class:done={step.done}>
                                  {@render event(index)}
                                </li>
                              {/each}
                            </ul>
                          </div>
                        </Popover.Content>
                      </Popover.Portal>
                    </Popover.Root>
                  </li>
                {/if}
              </ul>
            {/if}
            {#if adding === day.date}<input
                class="field adding nodrag nopan"
                data-adding={day.date}
                placeholder={m.work_block_new_event()}
                aria-label={m.work_block_new_event()}
                onblur={(event) => commitNew(event.currentTarget, day.date)}
                onkeydown={keys(
                  (field) => commitNew(field, day.date),
                  () => (adding = null),
                )}
              />{/if}
          </div>
        {/each}
      </div>
    {/if}
  {/each}
</div>

<style>
  /* One surface: the weeks that matter, separated by hairlines, the events carrying the colour. */
  .calendar {
    display: flex;
    flex-direction: column;
    inline-size: calc(var(--gutter) + 7 * var(--cell));
    overflow: hidden;
    border-radius: var(--radius-card);
    background: var(--color-surface);
    box-shadow:
      0 0 0 1px var(--color-border),
      var(--shadow-raised);
  }

  .weekdays,
  .week {
    display: grid;
    grid-template-columns: var(--gutter) repeat(7, var(--cell));
  }

  .weekdays {
    align-items: end;
    block-size: var(--head);
    padding-block-end: 6px;
    box-sizing: border-box;
    color: var(--color-faint);
    font-size: var(--text-caption);
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .weekdays span:not(.rail) {
    padding-inline: 10px;
  }

  .week,
  .quiet {
    box-shadow: inset 0 1px 0 var(--color-border);
    box-sizing: border-box;
  }

  /* The months stand in a rail down the side, named where one begins. */
  .rail {
    padding-block-start: calc(var(--pad) + 4px);
    padding-inline-start: 8px;
    overflow: hidden;
    color: var(--color-faint);
    font-size: var(--text-caption);
    font-weight: 600;
    letter-spacing: 0.04em;
    line-height: 14px;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .quiet {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-faint);
    font-size: var(--text-caption);
    font-weight: 500;
  }

  .quiet .dates {
    margin-inline-start: 4px;
    font-variant-numeric: tabular-nums;
  }

  .quiet .dates::before {
    content: "· ";
  }

  .day {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 4px;
    box-sizing: border-box;
    min-inline-size: 0;
    padding: var(--pad) 4px 0;
    transition: background-color var(--motion-fast) var(--ease-out);
  }

  .day.weekend {
    background: color-mix(in srgb, var(--color-text) 2%, transparent);
  }

  .day.editable:hover {
    background: color-mix(in srgb, var(--color-text) 5%, transparent);
  }

  .day:focus-visible {
    outline: 2px solid var(--color-ring);
    outline-offset: -2px;
  }

  /* A new or renamed event, typed where it will stand. */
  .field {
    box-sizing: border-box;
    inline-size: 100%;
    min-inline-size: 0;
    block-size: var(--item);
    padding: 0 6px;
    border: 0;
    border-radius: 5px;
    background: var(--color-surface);
    box-shadow: inset 0 0 0 1px var(--color-ring);
    color: var(--color-text);
    font: inherit;
    font-size: var(--text-caption);
    font-weight: 500;
    outline: none;
  }

  .field.adding {
    position: absolute;
    z-index: 2;
    inset-block-end: 6px;
    inset-inline: 4px;
    inline-size: auto;
  }

  .field::placeholder {
    color: var(--color-faint);
  }

  .number {
    align-self: flex-start;
    box-sizing: border-box;
    min-inline-size: var(--number);
    padding: 0 6px;
    margin-inline-start: 2px;
    border-radius: var(--radius-capsule);
    color: var(--color-label-secondary);
    font-size: var(--text-label);
    font-variant-numeric: tabular-nums;
    font-weight: 500;
    line-height: var(--number);
    text-align: center;
  }

  .number.opens {
    color: var(--color-text);
    font-weight: 650;
  }

  .weekend .number {
    color: var(--color-muted);
  }

  .outside .number {
    color: var(--color-faint);
  }

  .today .number {
    background: var(--color-accent);
    color: var(--color-on-accent);
    font-weight: 650;
  }

  ul {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-inline-size: 0;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .chip,
  .bar {
    --tone: var(--color-muted);

    position: relative;
    box-sizing: border-box;
    block-size: var(--item);
    border-radius: 5px;
    background: color-mix(in srgb, var(--tone) 13%, transparent);
  }

  .travel {
    --tone: var(--color-info);
  }

  .stay {
    --tone: var(--color-success);
  }

  .event {
    --tone: var(--color-tint-lavender);
  }

  .milestone {
    --tone: var(--color-warning);
  }

  .note {
    --tone: var(--color-faint);
  }

  /* A step that lasts: one bar across its days, squared where it carries on into the next. */
  .bar {
    background: color-mix(in srgb, var(--tone) 18%, transparent);
    border-radius: 0;
  }

  .bar.empty {
    background: none;
  }

  .bar:not(.starts) {
    margin-inline-start: -4px;
  }

  .bar:not(.ends) {
    margin-inline-end: -4px;
  }

  .bar.starts {
    border-start-start-radius: 5px;
    border-end-start-radius: 5px;
  }

  .bar.ends {
    border-start-end-radius: 5px;
    border-end-end-radius: 5px;
  }

  .step {
    display: flex;
    align-items: center;
    gap: 6px;
    box-sizing: border-box;
    inline-size: 100%;
    block-size: 100%;
    min-inline-size: 0;
    padding: 0 6px;
    border: 0;
    border-radius: inherit;
    background: none;
    color: var(--color-text);
    font: inherit;
    font-size: var(--text-caption);
    font-weight: 500;
    line-height: 1;
    text-align: start;
    cursor: default;
  }

  /* The bar's title runs on over the days it covers, past the cell it stands in. */
  .step.label {
    position: absolute;
    z-index: 1;
    inset-block-start: 0;
    inset-inline-start: 0;
    inline-size: calc(var(--span) * var(--cell) - var(--lose));
  }

  .bar:not(.starts) .step.label {
    padding-inline-start: 10px;
  }

  .mark {
    flex: none;
    inline-size: 3px;
    block-size: 12px;
    border-radius: 2px;
    background: var(--tone);
  }

  .step :global(svg) {
    flex: none;
    color: var(--color-success);
  }

  .title {
    min-inline-size: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  button.step:hover {
    background: color-mix(in srgb, var(--tone) 14%, transparent);
  }

  button.step:focus-visible {
    outline: 2px solid var(--color-ring);
    outline-offset: 1px;
  }

  .done .title {
    color: var(--color-muted);
    text-decoration: line-through;
  }

  .rest {
    block-size: var(--item);
  }

  .rest :global(.more) {
    box-sizing: border-box;
    block-size: 100%;
    padding: 0 6px;
    border: 0;
    border-radius: 5px;
    background: none;
    color: var(--color-muted);
    font: inherit;
    font-size: var(--text-caption);
    font-weight: 500;
    cursor: default;
    transition: color var(--motion-fast) var(--ease-out);
  }

  .rest :global(.more:hover) {
    color: var(--color-text);
  }

  .rest :global(.more:focus-visible) {
    outline: 2px solid var(--color-ring);
    outline-offset: 1px;
  }

  /* The day in full, where its count opens: every step, a line each. */
  .all {
    display: flex;
    flex-direction: column;
    gap: 8px;
    inline-size: 232px;
  }

  .all ul {
    max-block-size: 280px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .all .chip {
    flex: none;
  }

  .all p {
    margin: 0;
    padding-inline: 2px;
    color: var(--color-muted);
    font-size: var(--text-caption);
    font-weight: 600;
  }

  @media (prefers-reduced-motion: reduce) {
    .day,
    .rest :global(.more) {
      transition: none;
    }
  }
</style>
