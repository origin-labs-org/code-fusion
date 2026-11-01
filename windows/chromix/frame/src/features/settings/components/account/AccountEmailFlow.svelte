<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import { accountSession as session } from "$domain/account";
  import * as m from "$shared/i18n/messages";
  import Button from "$shared/ui/Button";
  import Field from "$shared/ui/Field";
  import { codeDigits, explainAccountFault, plausibleEmail } from "../../lib/account";

  /**
   * Address, then (when the session is older than the server allows) a fresh
   * sign-in, then the code sent to the new address. Never one unverified step.
   */
  type Step = "address" | "reauth" | "reauth_code" | "code";

  let { onclose }: { onclose: () => void } = $props();
  const account = $derived(session.account());
  const busy = $derived(session.pending());
  const fault = $derived(session.fault());
  let step = $state<Step>("address");
  let email = $state("");
  let code = $state("");

  const faultText = $derived.by(() => {
    if (!fault) return null;
    if (!["email_code", "reauth", "verify", "email_change"].includes(fault.action)) return null;
    if (fault.fault === "reauth_required") return null;
    return explainAccountFault(fault.fault, fault.retryAfter);
  });

  let form = $state<HTMLFormElement | null>(null);
  async function go(next: Step) {
    code = "";
    step = next;
    await tick();
    form?.querySelector<HTMLElement>("input, button[type=submit]")?.focus();
  }
  onMount(() => void go("address"));

  async function requestCode() {
    if (await session.sendEmailCode(email.trim())) await go("code");
    else if (session.fault()?.fault === "reauth_required") await go("reauth");
  }

  async function submit() {
    if (busy) return;
    switch (step) {
      case "address":
        if (plausibleEmail(email)) await requestCode();
        return;
      case "reauth":
        if (await session.sendReauthCode()) await go("reauth_code");
        return;
      case "reauth_code":
        if (codeDigits(code).length !== 6) return;
        if (await session.verify(codeDigits(code))) await requestCode();
        return;
      case "code":
        if (codeDigits(code).length !== 6) return;
        if (await session.changeEmail(email.trim(), codeDigits(code))) onclose();
        return;
    }
  }

  // The dialog can also be dismissed around the flow, so a sign-in code
  // still waiting is given up however it closes.
  onDestroy(() => {
    if (step === "reauth_code") void session.cancelCode();
  });

  const pendingFor: Record<Step, string> = {
    address: "email_code",
    reauth: "reauth",
    reauth_code: "verify",
    code: "email_change",
  };
</script>

<form
  class="flow"
  bind:this={form}
  onsubmit={(event) => {
    event.preventDefault();
    void submit();
  }}
>
  <p class="lead">
    {#if step === "reauth" || step === "reauth_code"}{m.account_email_reauth_body({
        email: account?.email ?? "",
      })}
    {:else if step === "code"}{m.account_email_code_body({ email: email.trim() })}
    {:else}{m.account_email_change_body()}{/if}
  </p>
  {#if step === "address"}<Field
      label={m.account_email_new()}
      type="email"
      placeholder={m.account_email_placeholder()}
      autocomplete="email"
      spellcheck="false"
      autocapitalize="off"
      maxlength={254}
      bind:value={email}
    />
  {:else if step === "reauth_code" || step === "code"}<Field
      label={step === "code" ? m.account_email_code() : m.account_email_reauth_code()}
      inputmode="numeric"
      autocomplete="one-time-code"
      placeholder="000000"
      maxlength={11}
      bind:value={code}
    />{/if}
  {#if faultText}<p class="error" role="alert">{faultText}</p>{/if}
  <footer>
    <Button onclick={onclose}>{m.action_cancel()}</Button>
    <Button
      type="submit"
      variant="primary"
      pending={busy === pendingFor[step]}
      disabled={(step === "address" && !plausibleEmail(email)) ||
        ((step === "code" || step === "reauth_code") && codeDigits(code).length !== 6)}
    >
      {#if step === "address"}{m.account_email_send()}
      {:else if step === "reauth"}{m.account_email_reauth_send()}
      {:else if step === "reauth_code"}{m.account_email_reauth_confirm()}
      {:else}{m.account_email_confirm()}{/if}
    </Button>
  </footer>
</form>

<style>
  .flow {
    display: grid;
    gap: 14px;
    margin-block-start: 10px;
  }

  .lead,
  .error {
    margin: 0;
    color: var(--color-muted);
    font-size: var(--text-label);
    line-height: 1.6;
  }

  .error {
    color: var(--color-danger);
  }

  /* Over the dialog's own footer spacing, which assumes no grid gap above it. */
  form.flow > footer {
    margin-block-start: 10px;
  }
</style>
