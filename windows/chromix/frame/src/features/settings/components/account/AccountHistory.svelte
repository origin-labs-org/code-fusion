<script lang="ts">
  import { onMount } from "svelte";
  import {
    accountSession as session,
    creditsCall,
    creditsTotal,
    positive,
    requestStanding,
    sumUnits,
  } from "$domain/account";
  import type { AccountFaultV1, AccountRequestV1 } from "$shared/ipc/bindings";
  import * as m from "$shared/i18n/messages";
  import Button from "$shared/ui/Button";
  import SegmentedControl from "$shared/ui/SegmentedControl";
  import { explainAccountFault } from "../../lib/account";
  import {
    addDays,
    callsByDay,
    groupCalls,
    moment,
    startOfDay,
    type CallGroup,
  } from "../../lib/call-groups";
  import { taskTitle } from "../../lib/task-titles";

  /**
   * Hosted usage, one row per Work task (voice and the rest have their own).
   * Which task made a call is this computer's own record; the service only
   * ever sees request ids. Pages load by the service's cursor, on request.
   */
  type Range = "week" | "month" | "all";
  type Day = {
    key: string;
    label: string;
    groups: CallGroup[];
    /** Units charged that day; null while older pages may still add to it. */
    total: string | null;
  };

  let requests = $state.raw<AccountRequestV1[]>([]);
  let cursor = $state<string | null>(null);
  let loading = $state(true);
  let failure = $state<AccountFaultV1 | null>(null);
  let openGroup = $state<string | null>(null);
  let open = $state<string | null>(null);
  let receipt = $state.raw<AccountRequestV1 | AccountFaultV1 | null>(null);
  let titles = $state.raw<Record<string, string | null>>({});
  let range = $state<Range>("all");
  /** Tasks whose name was asked for; not state, so asking never re-runs the effect. */
  const asked: Record<string, boolean> = {};
  const per = $derived(session.account()?.usage?.credit_units ?? null);
  const today = startOfDay(Date.now());
  const ranges = [
    { value: "week", label: m.account_history_range_week() },
    { value: "month", label: m.account_history_range_month() },
    { value: "all", label: m.account_history_range_all() },
  ];
  const when = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: "long" });
  const dated = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const datedYear = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  /** The range's first day, counting today as one of its days. */
  const cutoff = $derived(
    range === "week" ? addDays(today, -6) : range === "month" ? addDays(today, -29) : null,
  );
  const shown = $derived(
    cutoff === null
      ? requests
      : requests.filter((request) => (moment(request.started_at) ?? Infinity) >= cutoff),
  );
  /** Newest first, so once a page reaches past the range, no later page can add to it. */
  const exhausted = $derived.by(() => {
    if (!cursor) return true;
    if (cutoff === null) return false;
    const oldest = moment(requests.at(-1)?.started_at ?? null);
    return oldest !== null && oldest < cutoff;
  });
  const days = $derived.by((): Day[] => {
    const listed = callsByDay(shown, today);
    return listed.map(({ day, calls }, at) => ({
      key: String(day),
      label: dayLabel(day),
      groups: groupCalls(calls),
      total: exhausted || at < listed.length - 1 ? charged(calls) : null,
    }));
  });
  const rangeTotal = $derived(exhausted ? charged(shown) : null);

  function dayLabel(day: number) {
    if (day === today) return m.account_history_today();
    if (day === addDays(today, -1)) return m.account_history_yesterday();
    if (day > addDays(today, -7)) return weekday.format(day);
    return new Date(day).getFullYear() === new Date(today).getFullYear()
      ? dated.format(day)
      : datedYear.format(day);
  }

  function charged(calls: readonly AccountRequestV1[]) {
    return sumUnits(calls.filter((call) => call.state === "settled").map((call) => call.charged));
  }

  function amount(units: string | null) {
    if (!positive(units)) return null;
    const credits = creditsTotal(units, per);
    return credits ? m.account_request_charged({ amount: credits }) : null;
  }

  async function load(after: string | null) {
    loading = true;
    const page = await session.usageHistory(after);
    loading = false;
    failure = page.fault;
    if (page.fault) return;
    requests = after ? [...requests, ...page.requests] : page.requests;
    cursor = page.next_cursor;
  }

  onMount(() => void load(null));

  $effect(() => {
    for (const group of days.flatMap((day) => day.groups)) {
      if (!group.task || asked[group.key]) continue;
      asked[group.key] = true;
      const { profile, work } = group.task;
      void taskTitle(profile, work).then((title) => {
        titles = { ...titles, [group.key]: title };
        // A failed read may be retried the next time the history opens.
        if (title === null) delete asked[group.key];
      });
    }
  });

  function name(group: CallGroup) {
    if (group.kind === "voice") return m.account_history_voice();
    if (group.kind === "page") return m.account_history_ask();
    if (group.kind === "other") return m.account_history_other();
    return titles[group.key] ?? m.account_history_task();
  }

  function toggleGroup(key: string) {
    openGroup = openGroup === key ? null : key;
    open = null;
  }

  async function toggle(id: string) {
    if (open === id) {
      open = null;
      return;
    }
    open = id;
    receipt = null;
    const read = await session.receipt(id);
    if (open === id) receipt = read;
  }

  function time(iso: string | null, format = when) {
    const at = moment(iso);
    return at === null ? "" : format.format(at);
  }

  function count(calls: number) {
    return calls === 1 ? m.account_history_call_one() : m.account_history_calls({ count: calls });
  }

  function total(group: CallGroup) {
    const amount = positive(group.total) ? creditsTotal(group.total, per) : null;
    const charged = amount ? m.account_request_charged({ amount }) : null;
    if (!group.unsettled) return charged ?? m.account_request_free();
    return [charged, m.account_request_running()].filter(Boolean).join(" · ");
  }

  function cost(request: AccountRequestV1) {
    switch (requestStanding(request.state)) {
      case "charged": {
        const amount = creditsCall(request.charged ?? "0", per);
        return amount ? m.account_request_charged({ amount }) : m.account_request_charged_plain();
      }
      case "free":
        return m.account_request_free();
      case "checking":
        return m.account_request_checking();
      case "running":
        return m.account_request_running();
    }
  }

  function funding(request: AccountRequestV1) {
    if (requestStanding(request.state) !== "charged") return null;
    switch (request.funding) {
      case "allowance":
        return m.account_funding_allowance();
      case "purchased":
        return m.account_funding_purchased();
      case "mixed":
        return m.account_funding_mixed();
      default:
        return null;
    }
  }

  function details(request: AccountRequestV1) {
    const held = creditsCall(request.reserved, per);
    const finished = request.finished_at
      ? m.account_receipt_finished({ time: time(request.finished_at) })
      : null;
    const paid = funding(request);
    let line: string | null;
    switch (requestStanding(request.state)) {
      case "charged": {
        const amount = creditsCall(request.charged ?? "0", per);
        line = amount ? m.account_receipt_charged({ amount }) : m.account_request_charged_plain();
        break;
      }
      case "free":
        line = m.account_receipt_free();
        break;
      case "checking":
        line = [m.account_receipt_checking(), held && m.account_receipt_held({ amount: held })]
          .filter(Boolean)
          .join(" · ");
        break;
      case "running":
        line = held ? m.account_receipt_held({ amount: held }) : m.account_request_running();
        break;
    }
    return [line, paid, finished].filter(Boolean).join(" · ");
  }
</script>

<div class="history" aria-busy={loading}>
  {#if failure && !requests.length}<p class="quiet" role="alert">
      {explainAccountFault(failure, null)}
    </p>
  {:else if loading && !requests.length}<p class="quiet">{m.account_usage_loading()}</p>
  {:else if !requests.length}<p class="quiet">{m.account_history_empty()}</p>
  {:else}
    <div class="toolbar">
      <SegmentedControl
        label={m.account_history_range()}
        size="compact"
        options={ranges}
        bind:value={range}
      />
      {#if amount(rangeTotal)}<span class="sum">{amount(rangeTotal)}</span>{/if}
    </div>
    {#each days as day, at (day.key)}
      <section class="day" aria-labelledby="day-{at}">
        <h4 id="day-{at}">
          <span>{day.label}</span>
          {#if amount(day.total)}<span class="sum">{amount(day.total)}</span>{/if}
        </h4>
        <ul class="groups">
          {#each day.groups as group, index (group.key)}
            {@const id = `${day.key}:${group.key}`}
            <li>
              <button
                type="button"
                class="group"
                aria-expanded={openGroup === id}
                aria-controls="calls-{at}-{index}"
                onclick={() => toggleGroup(id)}
              >
                <span class="what">
                  <span class="name" data-quiet={group.task && !titles[group.key] ? "" : undefined}
                    >{name(group)}</span
                  >
                  <span class="meta"
                    >{[time(group.latest, clock), count(group.calls.length)]
                      .filter(Boolean)
                      .join(" · ")}</span
                  >
                </span>
                <span class="cost" data-standing={group.unsettled ? "running" : "charged"}
                  >{total(group)}</span
                >
              </button>
              {#if openGroup === id}
                <ul class="calls" id="calls-{at}-{index}">
                  {#each group.calls as request (request.id)}
                    <li>
                      <button
                        type="button"
                        class="request"
                        aria-expanded={open === request.id}
                        aria-label={m.account_request_details()}
                        onclick={() => void toggle(request.id)}
                      >
                        <span class="model"
                          >{request.model_id ?? "—"}{#if funding(request)}<span class="funding"
                              >{funding(request)}</span
                            >{/if}</span
                        >
                        <span class="when">{time(request.started_at, clock)}</span>
                        <span class="cost" data-standing={requestStanding(request.state)}
                          >{cost(request)}</span
                        >
                      </button>
                      {#if open === request.id}<p class="receipt" role="status">
                          {#if receipt === null}{m.account_usage_loading()}
                          {:else if typeof receipt === "string"}{explainAccountFault(receipt, null)}
                          {:else}{details(receipt)}{/if}
                        </p>{/if}
                    </li>
                  {/each}
                </ul>
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {:else}<p class="quiet">{m.account_history_range_empty()}</p>
    {/each}
    {#if failure}<p class="quiet" role="alert">{m.account_history_failed()}</p>{/if}
    {#if !exhausted}<div class="more">
        <Button size="compact" variant="ghost" pending={loading} onclick={() => void load(cursor)}
          >{m.account_history_more()}</Button
        >
      </div>{/if}
  {/if}
  <p class="footnote">{m.account_history_row_desc()}</p>
</div>

<style>
  .history {
    padding: 4px 18px 16px;
  }

  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding-block: 4px 6px;
  }

  /* Day headings hold to the top of the page while their day scrolls under them. */
  h4 {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
    margin: 0 -18px;
    padding: 14px 18px 6px;
    background: var(--color-surface);
    color: var(--color-muted);
    font-size: var(--text-caption);
    font-weight: 600;
    line-height: 16px;
    letter-spacing: 0.02em;
  }

  .sum {
    color: var(--color-muted);
    font-size: var(--text-label);
    font-variant-numeric: tabular-nums;
    font-weight: 500;
    letter-spacing: 0;
  }

  ul {
    display: grid;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .group,
  .request {
    inline-size: calc(100% + 16px);
    margin: 0 -8px;
    padding: 7px 8px;
    border: 0;
    border-radius: var(--radius-row);
    background: transparent;
    color: var(--color-text);
    font: inherit;
    font-size: var(--text-label);
    text-align: start;
    cursor: default;
  }

  .group {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 16px;
    min-block-size: 44px;
  }

  .request {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto 8.5em;
    align-items: baseline;
    gap: 16px;
  }

  .group:hover,
  .request:hover {
    background: var(--color-fill-hover);
  }

  .group[aria-expanded="true"],
  .request[aria-expanded="true"] {
    background: var(--color-fill);
  }

  .group:focus-visible,
  .request:focus-visible {
    outline: 2px solid var(--color-ring);
    outline-offset: -2px;
  }

  .what {
    display: grid;
    gap: 1px;
    min-inline-size: 0;
  }

  .name {
    overflow: hidden;
    font-size: var(--text-body);
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .name[data-quiet] {
    color: var(--color-muted);
  }

  .meta {
    color: var(--color-faint);
    font-variant-numeric: tabular-nums;
  }

  /* Calls sit in under their task, indented to read as its parts. */
  .calls {
    margin-inline-start: 12px;
    padding-block: 2px 6px;
  }

  .cost {
    text-align: end;
  }

  .model {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .funding {
    margin-inline-start: 8px;
    color: var(--color-muted);
    font-size: var(--text-caption);
  }

  .when,
  .cost {
    color: var(--color-muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .cost[data-standing="charged"] {
    color: var(--color-text);
  }

  .receipt,
  .quiet {
    margin: 2px 0 6px;
    color: var(--color-muted);
    font-size: var(--text-label);
    line-height: 1.5;
    font-variant-numeric: tabular-nums;
  }

  .quiet {
    padding-block: 10px 4px;
  }

  .more {
    display: flex;
    justify-content: flex-start;
    margin-inline-start: -10px;
    padding-block-start: 6px;
  }

  .footnote {
    margin: 12px 0 0;
    color: var(--color-faint);
    font-size: var(--text-caption);
    line-height: 1.5;
  }
</style>
