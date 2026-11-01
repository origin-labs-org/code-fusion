<script lang="ts">
  import Icon from "$shared/ui/Icon";
  import type { ObjectActions, PlanView } from "../../lib/board/types";
  import MakeTasks from "../board/MakeTasks.svelte";
  import Mark, { hasMark } from "./Mark.svelte";
  import Title from "./Title.svelte";
  import PlanCalendar from "./PlanCalendar.svelte";
  import { openingMonth, planCalendar } from "../../lib/board/plan-calendar";
  import { ArrowLeft01Icon, ArrowRight01Icon } from "./icons";
  import { icsFileName, planIcs } from "../../lib/board/plan-ics";
  import { commands } from "$shared/ipc/bindings";
  import * as m from "$shared/i18n/messages";
  import {
    AirplaneTakeOff01Icon,
    BedDoubleIcon,
    Calendar03Icon,
    CheckmarkCircle02Icon,
    Flag02Icon,
    Note01Icon,
    Tick02Icon,
  } from "./icons";
  /** Steps in time along one spine: when, what, what it costs, and the pick it stands on. */
  let {
    object,
    actions = {},
    centre = false,
  }: {
    object: PlanView;
    actions?: ObjectActions;
    /** Opened in the centre, where the header makes the tasks. */
    centre?: boolean;
  } = $props();
  const GLYPH = {
    travel: AirplaneTakeOff01Icon,
    stay: BedDoubleIcon,
    event: Calendar03Icon,
    task: CheckmarkCircle02Icon,
    milestone: Flag02Icon,
    note: Note01Icon,
  } as const;
  const priced = $derived(object.steps.some((step) => step.cost));
  /** The person's calendar turns a month at a time; one the agent drew shows all its months. */
  const keeps = $derived(!!object.calendar && !!actions.edit);
  let turned = $state(0);
  const month = $derived.by(() => {
    const opening = openingMonth(object);
    return new Date(opening.getFullYear(), opening.getMonth() + turned, 1);
  });
  const monthName = $derived(
    new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(month),
  );
  function showToday() {
    const opening = openingMonth(object);
    const now = new Date();
    turned = (now.getFullYear() - opening.getFullYear()) * 12 + now.getMonth() - opening.getMonth();
  }
  /** A long dated plan stands as its weeks; the centre keeps every step's words beneath. */
  const rows = $derived(planCalendar(object, keeps ? { month } : {}));
  const onDays = $derived(object.steps.some((step) => step.date));
  let saving = $state(false);
  async function addToCalendar() {
    const text = planIcs(object);
    if (!text || saving) return;
    saving = true;
    try {
      await commands.workSaveCalendar(icsFileName(object), text);
    } finally {
      saving = false;
    }
  }
  /** A step names its day only where the day changes. */
  const dated = $derived(
    object.steps.map((step, index) =>
      index > 0 && step.when === object.steps[index - 1]?.when ? "" : (step.when ?? ""),
    ),
  );
</script>

<section class="plan" class:priced class:calendar={!!rows} aria-label={object.title}>
  {#if object.title || onDays || keeps}<header>
      {#if object.title}<Title text={object.title} />{/if}
      {#if keeps}<div class="month nodrag nopan">
          <span class="month-name">{monthName}</span>
          <button
            type="button"
            class="turn"
            aria-label={m.work_block_previous_month()}
            onclick={() => (turned -= 1)}><Icon icon={ArrowLeft01Icon} size={14} /></button
          >
          <button type="button" class="turn today" onclick={showToday}
            >{m.work_block_today()}</button
          >
          <button
            type="button"
            class="turn"
            aria-label={m.work_block_next_month()}
            onclick={() => (turned += 1)}><Icon icon={ArrowRight01Icon} size={14} /></button
          >
        </div>{/if}
      {#if onDays}<button
          type="button"
          class="calendar-add nodrag nopan"
          disabled={saving}
          onclick={addToCalendar}>{m.work_plan_add_to_calendar()}</button
        >{/if}
    </header>{/if}
  {#if rows}<PlanCalendar {object} {rows} month={keeps} {actions} />{/if}
  {#if !rows || centre}<div class="grid">
      <ol class="steps">
        {#each object.steps as step, index (index)}
          <li class="step {step.kind}" class:done={step.done} class:first={!!dated[index]}>
            <span class="when">{dated[index]}</span>
            <span class="node">
              {#if object.checkable && actions.check}<button
                  type="button"
                  class="glyph check nodrag nopan"
                  aria-pressed={!!step.done}
                  aria-label={step.title}
                  onclick={() => actions.check?.(object.id, index, !step.done)}
                  ><Icon icon={step.done ? Tick02Icon : GLYPH[step.kind]} size={14} /></button
                >{:else}<span class="glyph"
                  ><Icon icon={step.done ? Tick02Icon : GLYPH[step.kind]} size={14} /></span
                >{/if}
            </span>
            <div class="what">
              <div class="head">
                <h4>{step.title}</h4>
                {#if step.pick}
                  {#if step.pick.picture}<img
                      class="thumb"
                      src={step.pick.picture.src}
                      alt={step.pick.name}
                      title={step.pick.name}
                      decoding="async"
                      loading="lazy"
                      width="40"
                      height="30"
                    />{:else if step.pick.logo && hasMark(step.pick.logo)}<span
                      class="logo"
                      title={step.pick.name}><Mark address={step.pick.logo} size={16} /></span
                    >{/if}
                {/if}
              </div>
              {#if step.detail || step.place}
                <p class="detail">
                  {#if step.place}<span class="place">{step.place}{step.detail ? " · " : ""}</span
                    >{/if}{#if step.detail}{step.detail}{/if}
                </p>
              {/if}
            </div>
            {#if priced}<span class="cost">{step.cost ?? ""}</span>{/if}
          </li>
        {/each}
      </ol>
      {#if object.total?.value.trim()}
        <p class="total" class:loose={!priced}>
          <span class="label">{object.total.label}</span><span class="value"
            >{object.total.value}</span
          >
        </p>
      {/if}
      {#if object.checkable && !centre && !rows}<footer><MakeTasks id={object.id} /></footer>{/if}
    </div>{/if}
  {#if rows && object.checkable && !centre}<footer><MakeTasks id={object.id} /></footer>{/if}
</section>

<style>
  .plan {
    --node: 28px;

    display: flex;
    flex-direction: column;
    gap: 16px;
    max-inline-size: 760px;
    color: var(--color-text);
  }

  .plan.calendar {
    max-inline-size: none;
  }

  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
  }

  .month {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-inline-start: auto;
  }

  .month-name {
    margin-inline-end: 8px;
    color: var(--color-label-secondary);
    font-size: var(--text-body);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .turn {
    display: grid;
    place-items: center;
    min-inline-size: 26px;
    block-size: 26px;
    padding: 0 6px;
    border: 0;
    border-radius: var(--radius-control-compact);
    background: transparent;
    color: var(--color-muted);
    font: inherit;
    font-size: var(--text-label);
    font-weight: 500;
    cursor: default;
    transition:
      background-color var(--motion-fast) var(--ease-out),
      color var(--motion-fast) var(--ease-out);
  }

  .turn:hover {
    background: var(--color-control-hover);
    color: var(--color-text);
  }

  .turn:focus-visible {
    outline: 2px solid var(--color-ring);
    outline-offset: 1px;
  }

  .calendar-add {
    flex: none;
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-muted);
    font: inherit;
    font-size: var(--text-label);
    font-weight: 500;
    cursor: default;
    transition: color var(--motion-fast) var(--ease-out);
  }

  .calendar-add:hover {
    color: var(--color-text);
  }

  .calendar-add:focus-visible {
    outline: 2px solid var(--color-ring);
    outline-offset: 2px;
  }

  /* One grid for every step: the date column is as wide as its longest label. */
  .grid {
    display: grid;
    grid-template-columns: fit-content(200px) var(--node) minmax(0, 1fr);
    column-gap: 14px;
  }

  .priced .grid {
    grid-template-columns: fit-content(200px) var(--node) minmax(0, 1fr) auto;
  }

  .steps {
    display: grid;
    grid-column: 1 / -1;
    grid-template-columns: subgrid;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .step {
    display: grid;
    grid-column: 1 / -1;
    grid-template-columns: subgrid;
    padding-block-end: 18px;
  }

  .step.first:not(:first-child) {
    padding-block-start: 10px;
  }

  .when {
    padding-block-start: 7px;
    color: var(--color-muted);
    font-size: var(--text-caption);
    font-weight: 600;
    letter-spacing: 0.06em;
    line-height: 15px;
    text-transform: uppercase;
    text-wrap: balance;
  }

  .node {
    position: relative;
    display: flex;
    justify-content: center;
  }

  /* The spine: one hairline from each node down to the next, through the air between. */
  .step:not(:last-child) .node::before {
    position: absolute;
    inset-block: calc(var(--node) + 4px) -14px;
    inset-inline-start: calc(50% - 0.5px);
    inline-size: 1px;
    background: var(--color-border-strong);
    content: "";
  }

  .step.first:not(:first-child) .node::after {
    position: absolute;
    inset-block-start: -10px;
    inset-inline-start: calc(50% - 0.5px);
    inline-size: 1px;
    block-size: 10px;
    background: var(--color-border-strong);
    content: "";
  }

  .glyph {
    position: relative;
    display: grid;
    place-items: center;
    inline-size: var(--node);
    block-size: var(--node);
    padding: 0;
    border: 0;
    border-radius: var(--radius-capsule);
    background: var(--color-fill-active);
    box-shadow: inset 0 0 0 1px var(--color-border);
    color: var(--color-label-secondary);
    cursor: default;
  }

  .milestone .glyph {
    background: var(--color-lit);
    color: var(--color-on-lit);
  }

  .done .glyph {
    background: var(--color-success);
    box-shadow: none;
    color: var(--color-surface);
  }

  .check:hover {
    box-shadow: inset 0 0 0 1.5px var(--color-border-strong);
  }

  .check:focus-visible {
    outline: 2px solid var(--color-ring);
    outline-offset: 2px;
  }

  .what {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-inline-size: 0;
    padding-block-start: 4px;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  h4 {
    margin: 0;
    font-size: var(--text-page-title);
    font-weight: 600;
    line-height: 20px;
    text-wrap: pretty;
  }

  .done h4 {
    color: var(--color-muted);
  }

  .thumb {
    flex: none;
    inline-size: 40px;
    block-size: 30px;
    border-radius: var(--radius-inset);
    object-fit: cover;
    box-shadow: 0 0 0 1px var(--color-border);
  }

  .logo {
    display: inline-flex;
  }

  .detail {
    max-inline-size: 60ch;
    margin: 0;
    color: var(--color-label-secondary);
    font-size: var(--text-body);
    line-height: 19px;
    text-wrap: pretty;
  }

  .place {
    color: var(--color-muted);
  }

  .cost {
    padding-block-start: 5px;
    color: var(--color-label-secondary);
    font-size: var(--text-body);
    font-variant-numeric: tabular-nums;
    text-align: end;
    white-space: nowrap;
  }

  .total {
    display: flex;
    grid-column: 3 / -1;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
    margin: 0;
    padding-block-start: 14px;
    border-block-start: 1px solid var(--color-border-strong);
  }

  /* With no cost column to line up under, the total stands as a figure over its label. */
  .total.loose {
    flex-direction: column-reverse;
    align-items: flex-start;
    justify-content: flex-start;
    gap: 2px;
  }

  .total .label {
    color: var(--color-muted);
    font-size: var(--text-label);
    font-weight: 500;
  }

  .total .value {
    font-size: var(--text-title);
    font-weight: 650;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.015em;
  }

  footer {
    grid-column: 3 / -1;
    padding-block-start: 16px;
  }
</style>
