<script lang="ts">
  import type { WorkHumanCheckOutcomeV1, WorkHumanPageV1 } from "$shared/ipc/bindings";
  import Button from "$shared/ui/Button";
  import * as m from "$shared/i18n/messages";
  import HostGlyph from "../cards/HostGlyph.svelte";
  import AskReceipt from "./AskReceipt.svelte";
  import AskShell from "./AskShell.svelte";
  import { registrableSite, siteName, type SignInAsk } from "./asks";

  /** A page the agent can't go past until the person signs in; it carries on by itself after. */
  let {
    ask,
    placement = "canvas",
    busy = false,
    onopen,
    oncheck,
  }: {
    ask: SignInAsk;
    placement?: "canvas" | "island";
    busy?: boolean;
    onopen?: () => void;
    oncheck?: (page: WorkHumanPageV1) => Promise<WorkHumanCheckOutcomeV1>;
  } = $props();
  let checking = $state(false);
  let checked = $state<{ key: string; outcome: WorkHumanCheckOutcomeV1 } | null>(null);
  const checkKey = $derived(
    `${ask.step}:${ask.page?.id.attempt}:${ask.page?.id.generation}:${ask.page?.document_revision}`,
  );
  const result = $derived(checked?.key === checkKey ? checked.outcome : null);
  async function checkAgain() {
    if (checking || busy) return;
    const key = checkKey;
    const page = ask.page;
    checked = null;
    if (!page || page.phase === "waiting_for_human" || page.phase === "presenting") {
      onopen?.();
      checked = { key, outcome: "open_page" };
      return;
    }
    if (!oncheck) return;
    checking = true;
    const outcome = await oncheck(page).catch(() => "unavailable" as const);
    checking = false;
    if (key !== checkKey || ask.state !== "open") return;
    checked = { key, outcome };
    if (outcome === "open_page") onopen?.();
  }
  const title = $derived(
    ask.kind === "check"
      ? m.work_human_title_check({ host: siteName(ask.host) })
      : m.work_ask_sign_in_title({ host: siteName(ask.host) }),
  );
</script>

{#if ask.state === "open"}
  <AskShell {placement} {busy} label={title} where={registrableSite(ask.host)} {title}>
    {#snippet mark()}<HostGlyph host={ask.host} size={18} initial={false} />{/snippet}
    <p class="how">{m.work_ask_handoff_how()}</p>
    {#if result}
      <p class="how" role="status">
        {result === "waiting"
          ? ask.kind === "check"
            ? m.work_human_check_waiting()
            : m.work_human_still_signed_out()
          : result === "clear"
            ? m.work_human_check_ready()
            : result === "open_page"
              ? m.work_human_check_open_page()
              : m.work_human_check_unavailable()}
      </p>
    {/if}
    {#snippet actions()}
      {#if oncheck}<Button
          variant="ghost"
          disabled={busy}
          pending={checking}
          onclick={() => void checkAgain()}>{m.work_human_check_again()}</Button
        >{/if}
      {#if onopen}<Button variant="primary" disabled={busy} onclick={() => onopen?.()}
          >{ask.kind === "check" ? m.work_human_open() : m.work_ask_sign_in()}</Button
        >{/if}
    {/snippet}
  </AskShell>
{:else}
  <AskReceipt
    tone={ask.state === "done" ? "done" : ask.state === "failed" ? "failed" : "working"}
    status={ask.state === "done"
      ? m.work_ask_done()
      : ask.state === "failed"
        ? m.work_ask_not_done()
        : m.work_ask_continuing()}
    text={ask.state === "failed" ? title : siteName(ask.host)}
  />
{/if}

<style>
  .how {
    margin: 0;
    color: var(--color-muted);
    font-size: var(--text-body);
    line-height: 18px;
  }
</style>
