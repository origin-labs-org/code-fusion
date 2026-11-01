<script lang="ts">
  import { untrack } from "svelte";
  import { Tick02Icon } from "@hugeicons/core-free-icons";
  import { accountSession as session, planName } from "$domain/account";
  import * as m from "$shared/i18n/messages";
  import Button from "$shared/ui/Button";
  import Icon from "$shared/ui/Icon";
  import SegmentedControl from "$shared/ui/SegmentedControl";
  import {
    intervalsOf,
    planCards,
    yearlySavesTwoMonths,
    type PlanCard,
    type PlanOffer,
  } from "../../lib/plans";
  import AccountDialog from "./AccountDialog.svelte";

  let {
    open = $bindable(false),
    plans,
    currentPlan,
    subscribed = null,
    paid,
    held,
    review,
  }: {
    open?: boolean;
    plans: readonly PlanOffer[];
    currentPlan: string | null;
    /** The plan the active subscription is for. */
    subscribed?: string | null;
    paid: boolean;
    /** The interval a subscription is billed at; a plan change keeps it. */
    held: string | null;
    review: boolean;
  } = $props();

  const busy = $derived(session.pending());
  const intervals = $derived(intervalsOf(plans));
  let picked = $state("yearly");
  const interval = $derived(
    held && intervals.includes(held)
      ? held
      : intervals.includes(picked)
        ? picked
        : (intervals[0] ?? picked),
  );
  const choosable = $derived(!paid && intervals.length > 1);
  const saving = $derived(yearlySavesTwoMonths(plans));
  const cards = $derived(planCards({ plans, currentPlan, subscribed, paid, interval, review }));
  /** Polar's prices are before tax; the note shows only where a paid price is. */
  const priced = $derived(cards.some((card) => card.offer?.price));
  let working = $state<string | null>(null);

  // Each opening starts from the account's own state, never from a stale pick.
  $effect(() => {
    if (open) untrack(() => (working = null));
  });

  const intervalName = (value: string) =>
    value === "monthly"
      ? m.account_interval_monthly()
      : value === "yearly"
        ? m.account_interval_yearly()
        : (planName(value) ?? value);

  async function choose(card: PlanCard) {
    if (!card.offer || working) return;
    working = card.id;
    const moved =
      card.action === "switch"
        ? await session.previewPlanChange(card.id, interval)
        : await session.buy({ kind: "plan", plan: card.id, interval: card.offer.interval });
    working = null;
    open = false;
    // The service already has a subscription for this account: read it again,
    // and the cards turn into switches.
    if (
      !moved &&
      card.action === "upgrade" &&
      session.fault()?.fault === "subscription_change_required"
    )
      void session.refresh();
  }
</script>

<AccountDialog
  bind:open
  title={m.account_plans_title()}
  description={m.account_plans_desc()}
  width={860}
>
  {#if choosable}<div class="interval">
      <SegmentedControl
        label={m.account_plans_billing()}
        size="compact"
        options={intervals.map((value) => ({ value, label: intervalName(value) }))}
        bind:value={picked}
      />
      {#if saving && interval === "yearly"}<span class="saving">{m.account_plans_two_months()}</span
        >{/if}
    </div>{/if}
  <ul class="cards">
    {#each cards as card (card.id)}
      <li class="card" data-current={card.action === "current" || undefined}>
        <h3 id={`plan-${card.id}`}>{card.name}</h3>
        <p class="price">
          <strong>{card.price}</strong>{#if card.per}<span>{card.per}</span>{/if}
        </p>
        <ul class="features" aria-labelledby={`plan-${card.id}`}>
          {#each card.features as feature (feature)}
            <li>
              <Icon icon={Tick02Icon} size={14} strokeWidth={2} />
              <span>{feature}</span>
            </li>
          {/each}
        </ul>
        <div class="action">
          {#if card.action === "current"}<span class="here"
              >{paid && held && card.id !== "free"
                ? m.account_plans_current_interval({ interval: intervalName(held) })
                : m.account_plans_current()}</span
            >
          {:else if card.action === "upgrade" || card.action === "switch"}<Button
              variant={card.downgrade ? "secondary" : "primary"}
              pending={working === card.id}
              disabled={!!busy || !!working}
              onclick={() => void choose(card)}
              >{card.action === "upgrade"
                ? m.account_upgrade_to({ plan: card.name })
                : m.account_switch_to({ plan: card.name })}</Button
            >{/if}
        </div>
      </li>
    {/each}
  </ul>
  <footer>
    {#if priced}<p class="tax">{m.account_prices_before_tax()}</p>{/if}
    <Button onclick={() => (open = false)}>{m.account_plans_close()}</Button>
  </footer>
</AccountDialog>

<style>
  .interval {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-block-end: 18px;
  }

  .saving {
    padding: 3px 9px;
    border-radius: var(--radius-capsule);
    background: var(--color-accent-soft);
    color: var(--color-text);
    font-size: var(--text-caption);
    font-weight: 600;
    white-space: nowrap;
  }

  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(0, 1fr));
    grid-auto-flow: column;
    gap: 12px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-inline-size: 0;
    padding: 20px 18px 18px;
    border-radius: var(--radius-card);
    background: var(--color-surface);
    box-shadow: inset 0 0 0 1px var(--color-border);
  }

  .card[data-current] {
    box-shadow: inset 0 0 0 1.5px var(--color-accent);
  }

  h3 {
    margin: 0;
    color: var(--color-text);
    font-size: var(--text-page-title);
    font-weight: 600;
  }

  .price {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 2px 6px;
    margin: 0;
    min-block-size: 36px;
  }

  .price strong {
    color: var(--color-text);
    font-size: var(--text-headline);
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    letter-spacing: -0.025em;
    line-height: 1.2;
  }

  .price span {
    color: var(--color-muted);
    font-size: var(--text-label);
  }

  .features {
    display: grid;
    flex: 1;
    align-content: start;
    gap: 9px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .features li {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    color: var(--color-label-secondary);
    font-size: var(--text-label);
    line-height: 1.45;
  }

  .features :global(svg) {
    flex: none;
    margin-block-start: 2px;
    color: var(--color-muted);
  }

  /* Every card keeps the same slot for its action, so a plan that is
     current, or offers none, does not change the cards' heights. */
  .action {
    display: grid;
    min-block-size: 34px;
    align-items: center;
  }

  .action :global(.ui-button) {
    inline-size: 100%;
  }

  .here {
    color: var(--color-text);
    font-size: var(--text-label);
    font-weight: 600;
    text-align: center;
  }

  .tax {
    align-self: center;
    margin: 0 auto 0 2px;
    color: var(--color-faint);
    font-size: var(--text-caption);
    line-height: 1.5;
  }

  @media (width <= 760px) {
    .cards {
      grid-auto-flow: row;
      grid-template-columns: minmax(0, 1fr);
    }
  }

  @media (forced-colors: active) {
    .card[data-current] {
      outline: 2px solid Highlight;
    }
  }
</style>
