<script lang="ts">
  import type { Component } from "svelte";
  import { accountSession as session } from "$domain/account";
  import * as m from "$shared/i18n/messages";
  import Button from "$shared/ui/Button";
  import AccountDialog from "./AccountDialog.svelte";

  const busy = $derived(session.pending());
  let open = $state(false);
  /** The change flow loads only when someone starts it. */
  let Flow = $state.raw<Component<{ onclose: () => void }> | null>(null);

  async function start() {
    session.clearFault();
    Flow ??= (await import("./AccountEmailFlow.svelte")).default;
    open = true;
  }
</script>

<Button size="compact" variant="ghost" disabled={!!busy} onclick={() => void start()}
  >{m.account_email_change_open()}</Button
>

{#if Flow}<AccountDialog bind:open title={m.account_email_change_title()} width={440}>
    <Flow onclose={() => (open = false)} />
  </AccountDialog>{/if}
