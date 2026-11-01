<script lang="ts">
  import type { Component } from "svelte";
  import {
    accountSession as session,
    creditsLeft,
    creditsTotal,
    positive,
    shortDate,
    usageTone,
  } from "$domain/account";
  import { ArrowDown01Icon, ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
  import { preferences } from "$domain/preferences";
  import * as m from "$shared/i18n/messages";
  import Button from "$shared/ui/Button";
  import Icon from "$shared/ui/Icon";
  import SettingsRow from "$shared/ui/SettingsRow";
  import { commands } from "$shared/ipc/bindings";
  import { explainAccountFault, SUPPORT_MAIL } from "../../lib/account";
  import * as settings from "../../lib/settings-state.svelte";
  import { canChangePlan, intervalsOf, planCards, planOffers, topUpOffers } from "../../lib/plans";
  import type AccountCredits from "./AccountCredits.svelte";
  import AccountDailyLimit from "./AccountDailyLimit.svelte";
  import type AccountPlans from "./AccountPlans.svelte";

  const account = $derived(session.account());
  const busy = $derived(session.pending());
  const fault = $derived(session.fault());
  const usage = $derived(account?.usage ?? null);
  const subscription = $derived(account?.subscription ?? null);
  const paid = $derived(subscription?.status === "active");
  const billing = $derived(account?.billing === true);
  const hosted = $derived(account?.hosted_models !== false);
  /** Under billing review nothing new is bought; export, the portal and downgrades remain. */
  const review = $derived(account?.billing_review === true);
  const change = $derived(account?.plan_change ?? null);
  // Off, the plan stays and Zephium AI's usage and credits leave with Work.
  const ai = $derived(preferences.aiEnabled());
  /** Credits exist only where the server states how many units make one. */
  const per = $derived(usage?.credit_units ?? null);

  const plans = $derived(planOffers(account?.offers ?? []));
  const topups = $derived(topUpOffers(account?.offers ?? []));
  const currentPlan = $derived(account?.plan ?? null);
  /** A subscription changes plan, not billing interval; a first purchase picks one. */
  const subscribed = $derived(paid ? (subscription?.plan ?? null) : null);
  const held = $derived(paid ? (subscription?.interval ?? null) : null);
  const settled = $derived(!change && billing);
  const canPlans = $derived(
    settled &&
      canChangePlan(
        planCards({
          plans,
          currentPlan,
          subscribed,
          paid,
          interval: held ?? intervalsOf(plans)[0] ?? "monthly",
          review,
        }),
      ),
  );
  const canCredits = $derived(settled && ai && !review && topups.length > 0);
  /** The dialogs load when first asked for; most visits never open them. */
  let Plans = $state.raw<typeof AccountPlans | null>(null);
  let Credits = $state.raw<typeof AccountCredits | null>(null);
  let plansOpen = $state(false);
  let creditsOpen = $state(false);

  const percent = $derived(usage?.used_percent ?? null);
  /** One statement of the allowance: what is left of what, or the share used where credits aren't stated. */
  const figure = $derived.by(() => {
    if (percent == null) return usage ? m.account_usage_none() : m.account_usage_loading();
    const left = creditsLeft(usage?.allowance_left, per);
    const total = positive(usage?.allowance_total)
      ? creditsLeft(usage?.allowance_total, per)
      : null;
    if (left && total) return m.account_usage_left_of({ left, total });
    return left
      ? m.account_usage_left_plain({ amount: left })
      : m.account_usage_used_nodate({ percent });
  });
  /** A trial says it is one; a plan's allowance says when it refills. */
  const renewalLine = $derived.by(() => {
    if (percent == null || !usage) return null;
    if (usage.one_time) return m.account_usage_trial();
    const date = shortDate(usage.resets_at);
    return date ? m.account_usage_refills({ date }) : null;
  });
  const purchased = $derived(creditsLeft(usage?.purchased_remaining, per));
  const hasPurchased = $derived(positive(usage?.purchased_remaining) && !!purchased);
  const pausedLine = $derived.by(() => {
    if (!usage?.free_paused) return null;
    return hasPurchased && usage.purchased_usable !== false
      ? m.account_usage_paused_purchased()
      : m.account_usage_paused();
  });
  const bonusLine = $derived.by(() => {
    if (!positive(usage?.bonus_remaining)) return null;
    const left = creditsLeft(usage?.bonus_remaining, per);
    if (!left) return null;
    const date = shortDate(usage?.bonus_expires_at);
    return date
      ? m.account_bonus_value({ amount: left, date })
      : m.account_bonus_value_nodate({ amount: left });
  });
  const heldCredits = $derived(positive(usage?.held) ? creditsTotal(usage?.held, per) : null);
  const planLine = $derived.by(() => {
    if (!subscription || subscription.status === "inactive") return null;
    if (subscription.status === "unknown") return m.account_plan_unknown();
    const date = shortDate(subscription.paid_until);
    if (!date) return m.account_plan_active();
    if (subscription.cancel_at_period_end) return m.account_plan_ends({ date });
    // Credits that refill the day the plan renews already say when it renews.
    if (ai && renewalLine && !usage?.one_time && date === shortDate(usage?.resets_at)) return null;
    return m.account_plan_renews({ date });
  });
  const unconfirmed = $derived(
    (account?.unsettled ?? []).some((request) => request.state !== "settled"),
  );

  async function showPlans() {
    Plans ??= (await import("./AccountPlans.svelte")).default;
    plansOpen = true;
  }

  async function showCredits() {
    Credits ??= (await import("./AccountCredits.svelte")).default;
    creditsOpen = true;
  }

  // Buy credits, chosen on the New Tab page, opens here as Settings shows.
  $effect(() => {
    if (!canCredits || settings.asking() !== "credits") return;
    settings.ask(null);
    void showCredits();
  });

  /** Usage history is loaded only when someone asks to see it, and kept while the page is open. */
  let History = $state.raw<Component | null>(null);
  let historyOpen = $state(false);
  async function toggleHistory() {
    if (historyOpen) {
      historyOpen = false;
      return;
    }
    History ??= (await import("./AccountHistory.svelte")).default;
    historyOpen = true;
  }

  /** A change in progress, or a quote waiting to be confirmed, is shown where it is read. */
  let Change = $state.raw<Component | null>(null);
  $effect(() => {
    if (!change || Change) return;
    void import("./AccountPlanChange.svelte").then((module) => (Change = module.default));
  });

  const billingFault = $derived(
    fault && ["buy", "manage", "plan_preview"].includes(fault.action)
      ? explainAccountFault(fault.fault, fault.retryAfter)
      : null,
  );
</script>

{#if !hosted}{#if ai}<p class="note">{m.account_hosted_off()}</p>{/if}
{:else}
  <section class="plan" aria-labelledby="account-plan-title">
    <header class="head">
      <div class="title">
        <h3 id="account-plan-title">{ai ? m.account_usage_group() : m.account_plan_group()}</h3>
        {#if planLine}<p>{planLine}</p>{/if}
      </div>
      {#if billing && (paid || subscription?.status === "unknown")}<Button
          size="compact"
          variant="ghost"
          class="manage"
          pending={busy === "manage"}
          disabled={!!busy && busy !== "manage"}
          onclick={() => void session.manage()}
          >{m.account_billing_manage()}<Icon icon={ArrowUpRight01Icon} size={13} /></Button
        >{/if}
    </header>
    {#if ai}<div class="usage">
        <h4>{m.account_usage_title()}</h4>
        <p class="figure">{figure}</p>
        {#if percent != null}<div
            class="meter"
            role="meter"
            aria-label={m.account_usage_meter()}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-valuetext={m.account_usage_used_nodate({ percent })}
            data-tone={usageTone(percent)}
          >
            <span style:inline-size={`${percent}%`}></span>
          </div>{/if}
        {#if renewalLine}<p class="caption">{renewalLine}</p>{/if}
        {#if pausedLine}<p class="caption" data-tone="warning" role="status">{pausedLine}</p>{/if}
      </div>{/if}
    {#if canPlans || canCredits}<div class="actions">
        {#if canPlans && !paid}<Button
            variant="primary"
            disabled={!!busy}
            onclick={() => void showPlans()}>{m.account_upgrade()}</Button
          >{/if}
        {#if canCredits}<Button
            variant={paid ? "primary" : "secondary"}
            disabled={!!busy}
            onclick={() => void showCredits()}>{m.account_credits_open()}</Button
          >{/if}
        {#if canPlans && paid}<Button disabled={!!busy} onclick={() => void showPlans()}
            >{m.account_plans_change()}</Button
          >{/if}
      </div>{/if}
    {#if review}<div class="review" role="status">
        <h4>{m.account_review_title()}</h4>
        <p>
          {m.account_review_body()}
          <a
            href={SUPPORT_MAIL}
            onclick={(event) => {
              event.preventDefault();
              void commands.browserOpenUrl(SUPPORT_MAIL, true).catch(() => {});
            }}>{m.account_review_contact()}</a
          >.
        </p>
      </div>{/if}
    {#if Change && change}<Change />{/if}
    {#if ai}<div class="rows" class:flush={!!(Change && change)}>
        {#if bonusLine}<SettingsRow title={m.account_bonus_title()}
            ><span class="value">{bonusLine}</span></SettingsRow
          >{/if}
        {#if per}<SettingsRow title={m.account_extra_title()}
            ><span class="value" data-none={!hasPurchased || undefined}
              >{hasPurchased
                ? m.account_extra_value({ amount: purchased ?? "0" })
                : m.account_extra_none()}</span
            ></SettingsRow
          >{/if}
        {#if heldCredits}<SettingsRow title={m.account_held_title()}
            ><span class="value">{m.account_held_value({ amount: heldCredits })}</span></SettingsRow
          >{/if}
        <AccountDailyLimit />
        <button
          type="button"
          class="disclosure"
          aria-expanded={historyOpen}
          aria-controls={History ? "account-history" : undefined}
          onclick={() => void toggleHistory()}
        >
          <span>{m.account_history_row()}</span>
          <Icon icon={ArrowDown01Icon} size={14} strokeWidth={2} />
        </button>
        {#if History}<div id="account-history" hidden={!historyOpen}><History /></div>{/if}
      </div>{/if}
  </section>
  {#if canPlans && Plans}<Plans
      bind:open={plansOpen}
      {plans}
      {currentPlan}
      {subscribed}
      {paid}
      {held}
      {review}
    />{/if}
  {#if canCredits && Credits}<Credits bind:open={creditsOpen} packs={topups} {per} />{/if}
  {#if unconfirmed}<p class="note" role="status">{m.account_unsettled()}</p>{/if}
  {#if billing && account?.checkout_open}<p class="note" role="status">
      {account.portal_open ? m.account_portal_waiting() : m.account_checkout_waiting()}
    </p>{/if}
  {#if billingFault}<p class="note" data-tone="error" role="alert">{billingFault}</p>{/if}
{/if}

<style>
  /* The plan is the account's one card: what it is, how much of it is left,
     the way to more, and the details under it. It clips rather than hides
     overflow, so the history's day headings can stick to the page's scroll. */
  .plan {
    overflow: clip;
    margin-block-end: 30px;
    border-radius: var(--radius-card);
    background: var(--color-surface);
    box-shadow: var(--shadow-card);
  }

  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    padding: 16px 12px 0 18px;
  }

  .title {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 2px 10px;
    min-inline-size: 0;
    padding-block-start: 3px;
  }

  h3 {
    margin: 0;
    color: var(--color-text);
    font-size: 15px;
    font-weight: 600;
    line-height: 20px;
    letter-spacing: -0.012em;
  }

  .title p {
    margin: 0;
    color: var(--color-muted);
    font-size: var(--text-label);
    font-variant-numeric: tabular-nums;
  }

  .head :global(.manage) {
    gap: 4px;
    padding-inline: 8px 6px;
  }

  .usage {
    display: grid;
    padding: 18px 18px 0;
  }

  h4 {
    margin: 0;
    color: var(--color-muted);
    font-size: var(--text-label);
    font-weight: 500;
    line-height: 16px;
  }

  .figure {
    margin: 4px 0 12px;
    color: var(--color-text);
    font-size: 20px;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    line-height: 26px;
    letter-spacing: -0.02em;
  }

  .caption,
  .value {
    margin: 0;
    color: var(--color-muted);
    font-size: var(--text-label);
    font-variant-numeric: tabular-nums;
  }

  .caption {
    margin-block-start: 10px;
    line-height: 1.5;
  }

  .meter + .caption {
    margin-block-start: 10px;
  }

  .caption + .caption {
    margin-block-start: 2px;
  }

  .caption[data-tone="warning"] {
    color: var(--color-warning);
  }

  .value {
    color: var(--color-label-secondary);
  }

  .value[data-none] {
    color: var(--color-faint);
  }

  .meter {
    overflow: hidden;
    block-size: 6px;
    border-radius: var(--radius-capsule);
    background: var(--color-track);
  }

  .meter span {
    display: block;
    block-size: 100%;
    border-radius: inherit;
    background: var(--color-text);
    transition: inline-size var(--motion-slow) var(--ease-out);
  }

  .meter[data-tone="high"] span {
    background: var(--color-warning);
  }

  .meter[data-tone="full"] span {
    background: var(--color-danger);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 18px 18px 0;
  }

  .actions :global(.ui-button) {
    min-inline-size: 104px;
  }

  .review {
    display: grid;
    gap: 4px;
    margin: 18px 18px 0;
    padding: 14px 16px;
    border-radius: var(--radius-control);
    background: var(--color-fill);
  }

  .review h4 {
    color: var(--color-text);
    font-size: var(--text-body);
  }

  .review p {
    margin: 0;
    color: var(--color-muted);
    font-size: var(--text-label);
    line-height: 1.5;
  }

  /* The card's details: one line each, the same height, divided by the rows' own hairlines. */
  .rows {
    position: relative;
    margin-block-start: 20px;
  }

  .plan > :global(:last-child:not(.rows)) {
    margin-block-end: 20px;
  }

  .plan > :global(.change) {
    margin-block-start: 20px;
  }

  .rows.flush {
    margin-block-start: 0;
  }

  .rows::before {
    position: absolute;
    top: 0;
    block-size: 1px;
    background: var(--color-border);
    content: "";
    inset-inline: 16px 0;
  }

  .rows :global(.ui-settings-row) {
    min-block-size: 46px;
    padding-block: 10px;
  }

  .rows :global(.ui-settings-copy h3) {
    font-size: var(--text-body);
  }

  .disclosure {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    box-sizing: border-box;
    inline-size: 100%;
    min-block-size: 46px;
    padding: 10px 18px;
    border: 0;
    background: transparent;
    color: var(--color-text);
    font: inherit;
    font-size: var(--text-body);
    font-weight: 500;
    letter-spacing: -0.008em;
    text-align: start;
    cursor: default;
    transition: background-color var(--motion-fast) var(--ease-out);
  }

  .disclosure::before {
    position: absolute;
    top: 0;
    block-size: 1px;
    background: var(--color-border);
    content: "";
    inset-inline: 16px 0;
  }

  .disclosure:hover {
    background: var(--row-hover);
  }

  .disclosure:focus-visible {
    outline: 2px solid var(--color-ring);
    outline-offset: -2px;
  }

  .disclosure :global(svg) {
    color: var(--color-faint);
    transition: rotate var(--motion-fast) var(--ease-out);
  }

  .disclosure[aria-expanded="true"] :global(svg) {
    rotate: 180deg;
  }

  .note {
    margin: -18px 18px 30px;
    color: var(--color-muted);
    font-size: var(--text-label);
    line-height: 1.5;
  }

  .note[data-tone="error"] {
    color: var(--color-danger);
  }

  @media (prefers-reduced-motion: reduce) {
    .meter span,
    .disclosure,
    .disclosure :global(svg) {
      transition: none;
    }
  }
</style>
