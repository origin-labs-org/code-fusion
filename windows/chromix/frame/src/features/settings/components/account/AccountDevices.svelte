<script lang="ts">
  import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
  import { accountSession as session, shortDate } from "$domain/account";
  import type { AccountFaultV1, AccountSessionV1 } from "$shared/ipc/bindings";
  import * as m from "$shared/i18n/messages";
  import Button from "$shared/ui/Button";
  import Icon from "$shared/ui/Icon";
  import SettingsRow from "$shared/ui/SettingsRow";
  import { explainAccountFault } from "../../lib/account";

  let shown = $state(false);
  let loaded = $state(false);
  let loading = $state(false);
  let devices = $state.raw<AccountSessionV1[]>([]);
  let failure = $state<AccountFaultV1 | null>(null);
  let revoking = $state<string | null>(null);
  let confirming = $state(false);
  const busy = $derived(session.pending());
  const fault = $derived(session.fault());
  const signOutAllFault = $derived(
    fault?.action === "sign_out_all" ? explainAccountFault(fault.fault, fault.retryAfter) : null,
  );

  async function toggle() {
    shown = !shown;
    confirming = false;
    if (!shown) return;
    loading = true;
    const result = await session.sessions();
    loading = false;
    if (typeof result === "string") {
      failure = result;
      return;
    }
    failure = null;
    loaded = true;
    devices = [...result].sort((a, b) => Number(b.current) - Number(a.current));
  }

  async function revoke(id: string) {
    revoking = id;
    const ok = await session.revoke(id);
    revoking = null;
    if (ok) devices = devices.filter((device) => device.id !== id);
  }

  const countLine = $derived(
    devices.length === 1
      ? m.account_devices_count_one()
      : m.account_devices_count({ count: devices.length }),
  );

  function since(device: AccountSessionV1) {
    const date = shortDate(device.created_at);
    return date ? m.account_device_since({ date }) : undefined;
  }
</script>

<section class="devices" aria-label={m.account_devices_group()}>
  <button
    type="button"
    class="disclosure"
    aria-expanded={shown}
    aria-controls="account-devices"
    onclick={() => void toggle()}
  >
    <span>{m.account_devices_group()}</span>
    <span class="end">
      {#if loaded && devices.length}<span class="count">{countLine}</span>{/if}
      <Icon icon={ArrowDown01Icon} size={14} strokeWidth={2} />
    </span>
  </button>
  <div id="account-devices" class="list" hidden={!shown}>
    {#if shown}
      {#if loading && !loaded}<p class="empty">{m.account_usage_loading()}</p>
      {:else if failure}<p class="empty" role="alert">{explainAccountFault(failure, null)}</p>
      {:else}
        {#each devices as device (device.id)}
          <SettingsRow
            title={device.current
              ? m.account_device_this()
              : (device.device ?? m.account_device_unknown())}
            description={device.current ? (device.device ?? since(device)) : since(device)}
          >
            {#if !device.current}<Button
                size="compact"
                variant="ghost"
                pending={revoking === device.id}
                disabled={!!revoking}
                onclick={() => void revoke(device.id)}>{m.account_device_sign_out()}</Button
              >{/if}
          </SettingsRow>
        {:else}<p class="empty">{m.account_devices_empty()}</p>
        {/each}
      {/if}
      <SettingsRow
        title={m.account_sign_out_all_title()}
        description={m.account_sign_out_all_desc()}
      >
        {#if confirming}<Button size="compact" variant="ghost" onclick={() => (confirming = false)}
            >{m.action_cancel()}</Button
          ><Button
            size="compact"
            variant="danger"
            pending={busy === "sign_out_all"}
            onclick={() => void session.signOutEverywhere()}
            >{m.account_sign_out_all_confirm()}</Button
          >
        {:else}<Button
            size="compact"
            variant="ghost"
            disabled={!!busy}
            onclick={() => (confirming = true)}>{m.account_sign_out_all()}</Button
          >{/if}
      </SettingsRow>
    {/if}
  </div>
  {#if signOutAllFault}<p class="empty error" role="alert">{signOutAllFault}</p>{/if}
</section>

<style>
  .devices {
    overflow: clip;
    margin-block-end: 30px;
    border-radius: var(--radius-card);
    background: var(--color-surface);
    box-shadow: var(--shadow-card);
  }

  .disclosure {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    box-sizing: border-box;
    inline-size: 100%;
    min-block-size: 50px;
    padding: 12px 18px;
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

  .disclosure:hover {
    background: var(--row-hover);
  }

  .disclosure:focus-visible {
    outline: 2px solid var(--color-ring);
    outline-offset: -2px;
  }

  .end {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--color-faint);
  }

  .end :global(svg) {
    transition: rotate var(--motion-fast) var(--ease-out);
  }

  .disclosure[aria-expanded="true"] .end :global(svg) {
    rotate: 180deg;
  }

  .count {
    color: var(--color-muted);
    font-size: var(--text-label);
    font-weight: 400;
    font-variant-numeric: tabular-nums;
  }

  .list {
    position: relative;
  }

  .list::before {
    position: absolute;
    top: 0;
    block-size: 1px;
    background: var(--color-border);
    content: "";
    inset-inline: 16px 0;
  }

  .list :global(.ui-settings-row) {
    min-block-size: 0;
    padding-block: 11px;
  }

  .list :global(.ui-settings-copy h3) {
    font-size: var(--text-body);
  }

  .list :global(.ui-settings-control) {
    display: flex;
    gap: 6px;
    margin-inline-end: -10px;
  }

  .empty {
    margin: 0;
    padding: 14px 18px;
    color: var(--color-muted);
    font-size: var(--text-label);
  }

  .empty + :global(.ui-settings-row)::before {
    position: absolute;
    top: 0;
    block-size: 1px;
    background: var(--color-border);
    content: "";
    inset-inline: 16px 0;
  }

  .error {
    color: var(--color-danger);
  }

  @media (prefers-reduced-motion: reduce) {
    .disclosure,
    .end :global(svg) {
      transition: none;
    }
  }
</style>
