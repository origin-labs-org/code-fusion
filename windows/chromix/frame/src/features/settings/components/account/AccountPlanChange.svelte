<script lang="ts">
  import { tick } from "svelte";
  import { accountSession as session, planName, priceLabel, shortDate } from "$domain/account";
  import * as m from "$shared/i18n/messages";
  import Button from "$shared/ui/Button";
  import Field from "$shared/ui/Field";
  import { codeDigits, explainAccountFault, explainChangeError } from "../../lib/account";

  /**
   * A Pro/Max change from quote to receipt. The quote is held by Rust, so this
   * picks up wherever it was left: after a restart, or after signing in again
   * because a confirmation needs a session younger than ten minutes.
   */
  type Step = "review" | "reauth" | "reauth_code";

  const account = $derived(session.account());
  const change = $derived(account?.plan_change ?? null);
  const busy = $derived(session.pending());
  const fault = $derived(session.fault());
  let step = $state<Step>("review");
  let code = $state("");
  let now = $state(Date.now());
  let form = $state<HTMLFormElement | null>(null);

  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 15_000);
    return () => clearInterval(timer);
  });

  const to = $derived(planName(change?.target_plan) ?? "");
  const from = $derived(planName(change?.current_plan) ?? "");
  const upgrade = $derived(change?.direction === "upgrade");
  const quoted = $derived(change?.status === "quoted");
  const running = $derived(change?.status === "queued" || change?.status === "executing");
  const uncertain = $derived(change?.status === "uncertain");
  const expiry = $derived(change?.expires_at ? Date.parse(change.expires_at) : Number.NaN);
  const expired = $derived(quoted && Number.isFinite(expiry) && expiry <= now);
  const recurring = $derived.by(() => {
    const price = priceLabel(change?.recurring);
    if (!price) return null;
    return change?.interval === "yearly"
      ? m.account_price_year({ price })
      : m.account_price_month({ price });
  });
  const due = $derived(priceLabel(change?.charge));
  const effective = $derived(shortDate(change?.effective_at));
  const until = $derived(
    Number.isFinite(expiry)
      ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(expiry)
      : null,
  );

  const faultText = $derived.by(() => {
    if (!fault || !["plan_confirm", "plan_preview", "reauth", "verify"].includes(fault.action))
      return null;
    if (fault.fault === "reauth_required") return null;
    return explainAccountFault(fault.fault, fault.retryAfter);
  });

  async function go(next: Step) {
    code = "";
    step = next;
    await tick();
    form?.querySelector<HTMLElement>("input")?.focus();
  }

  async function confirm() {
    if (busy || expired) return;
    if (await session.confirmPlanChange()) return;
    if (session.fault()?.fault === "reauth_required") await go("reauth");
  }

  async function submit() {
    if (busy) return;
    if (step === "review") return confirm();
    if (step === "reauth") {
      if (await session.sendReauthCode()) await go("reauth_code");
      return;
    }
    if (codeDigits(code).length !== 6) return;
    if (!(await session.verify(codeDigits(code)))) return;
    step = "review";
    await confirm();
  }

  async function renew() {
    if (!change || busy) return;
    const { target_plan, interval } = change;
    await session.dismissPlanChange();
    await session.previewPlanChange(target_plan, interval);
  }

  function back() {
    if (step === "reauth_code") void session.cancelCode();
    step = "review";
    code = "";
  }
</script>

{#if change}
  <section class="change" aria-labelledby="change-title" aria-live="polite">
    {#if quoted}
      <h4 id="change-title">
        {upgrade
          ? m.account_change_title_up({ plan: to })
          : m.account_change_title_down({ plan: to })}
      </h4>
      <form
        bind:this={form}
        onsubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {#if step === "review"}
          <dl>
            <div>
              <dt>{m.account_change_plans()}</dt>
              <dd>{from} → {to}</dd>
            </div>
            {#if recurring}<div>
                <dt>{m.account_change_price()}</dt>
                <dd>{recurring}</dd>
              </div>{/if}
            {#if upgrade && due}<div>
                <dt>{m.account_change_due()}</dt>
                <dd>{due}</dd>
              </div>{/if}
            <div>
              <dt>{m.account_change_when()}</dt>
              <dd>
                {effective
                  ? m.account_change_at_renewal({ date: effective })
                  : upgrade
                    ? m.account_change_now()
                    : m.account_change_at_renewal_nodate()}
              </dd>
            </div>
          </dl>
          {#if upgrade && due}<p class="note">{m.account_change_due_note()}</p>{/if}
          {#if !upgrade}<p class="note">{m.account_change_downgrade_note({ plan: from })}</p>{/if}
          {#if expired}<p class="note" data-tone="warning" role="status">
              {m.account_change_expired()}
            </p>
          {:else if until}<p class="note">{m.account_change_valid_until({ time: until })}</p>{/if}
        {:else}
          <p class="note">{m.account_email_reauth_body({ email: account?.email ?? "" })}</p>
          {#if step === "reauth_code"}<Field
              label={m.account_email_reauth_code()}
              inputmode="numeric"
              autocomplete="one-time-code"
              placeholder="000000"
              maxlength={11}
              bind:value={code}
            />{/if}
        {/if}
        {#if faultText}<p class="note" data-tone="error" role="alert">{faultText}</p>{/if}
        <div class="actions">
          <Button
            size="compact"
            variant="ghost"
            disabled={!!busy && busy !== "plan_dismiss"}
            pending={busy === "plan_dismiss"}
            onclick={() => (step === "review" ? void session.dismissPlanChange() : back())}
            >{m.action_cancel()}</Button
          >
          {#if expired}
            <Button
              size="compact"
              variant="primary"
              pending={busy === "plan_preview"}
              disabled={!!busy}
              onclick={() => void renew()}>{m.account_change_new_quote()}</Button
            >
          {:else}
            <Button
              size="compact"
              type="submit"
              variant="primary"
              pending={busy === "plan_confirm" || busy === "reauth" || busy === "verify"}
              disabled={!!busy || (step === "reauth_code" && codeDigits(code).length !== 6)}
            >
              {#if step === "reauth"}{m.account_email_reauth_send()}
              {:else if step === "reauth_code"}{m.account_email_reauth_confirm()}
              {:else if upgrade}{m.account_change_confirm_up()}
              {:else}{m.account_change_confirm_down()}{/if}
            </Button>
          {/if}
        </div>
      </form>
    {:else if running || uncertain}
      <h4 id="change-title">
        {uncertain ? m.account_change_uncertain() : m.account_change_working()}
      </h4>
      <p class="note">
        {uncertain ? m.account_change_uncertain_desc() : m.account_change_working_desc()}
      </p>
      <span class="working" aria-hidden="true"></span>
    {:else if change.status === "applied"}
      <h4 id="change-title">{m.account_change_applied({ plan: to })}</h4>
      <p class="note">{m.account_change_applied_desc()}</p>
      <div class="actions">
        <Button
          size="compact"
          variant="primary"
          disabled={!!busy}
          onclick={() => void session.dismissPlanChange()}>{m.account_change_done()}</Button
        >
      </div>
    {:else if change.status === "scheduled"}
      <h4 id="change-title">
        {effective
          ? m.account_change_scheduled({ plan: to, date: effective })
          : m.account_change_scheduled_nodate({ plan: to })}
      </h4>
      <p class="note">{m.account_change_scheduled_desc({ plan: from })}</p>
      <div class="actions">
        <Button
          size="compact"
          variant="primary"
          disabled={!!busy}
          onclick={() => void session.dismissPlanChange()}>{m.account_change_done()}</Button
        >
      </div>
    {:else}
      <h4 id="change-title">{m.account_change_failed()}</h4>
      <p class="note" data-tone="error" role="alert">
        {explainChangeError(change.error)}
      </p>
      <div class="actions">
        <Button
          size="compact"
          variant="primary"
          disabled={!!busy}
          onclick={() => void session.dismissPlanChange()}>{m.account_change_done()}</Button
        >
      </div>
    {/if}
  </section>
{/if}

<style>
  .change {
    display: grid;
    gap: 12px;
    padding: 18px;
    border-block-start: 1px solid var(--color-border);
  }

  h4 {
    margin: 0;
    color: var(--color-text);
    font-size: var(--text-page-title);
    font-weight: 500;
    line-height: 19px;
  }

  form {
    display: grid;
    gap: 12px;
  }

  dl {
    display: grid;
    gap: 8px;
    margin: 0;
  }

  dl div {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
  }

  dt,
  dd,
  .note {
    margin: 0;
    color: var(--color-muted);
    font-size: var(--text-label);
    line-height: 1.5;
  }

  dd {
    color: var(--color-text);
    font-variant-numeric: tabular-nums;
    text-align: end;
  }

  .note[data-tone="error"] {
    color: var(--color-danger);
  }

  .note[data-tone="warning"] {
    color: var(--color-warning);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  /* Quiet motion that says it is still going, without a number to watch. */
  .working {
    overflow: hidden;
    block-size: 3px;
    border-radius: var(--radius-capsule);
    background: var(--color-track);
  }

  .working::after {
    display: block;
    inline-size: 35%;
    block-size: 100%;
    border-radius: inherit;
    background: var(--color-muted);
    animation: slide 1.6s var(--ease-out) infinite;
    content: "";
  }

  @keyframes slide {
    from {
      transform: translateX(-100%);
    }

    to {
      transform: translateX(300%);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .working::after {
      animation: none;
      inline-size: 100%;
      opacity: 0.4;
    }
  }
</style>
