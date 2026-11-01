<script lang="ts">
  import { onMount } from "svelte";
  import * as m from "$shared/i18n/messages";
  import { commands, type LoginItemStatus } from "$shared/ipc/bindings";
  import SettingsRow from "$shared/ui/SettingsRow";
  import Switch from "$shared/ui/Switch";
  import Button from "$shared/ui/Button";

  // The system holds the answer, and System Settings can change it: read it
  // on open and whenever the window comes back, never on a timer.
  let status = $state.raw<LoginItemStatus | null>(null);
  let pending = $state(false);
  let failed = $state(false);
  let epoch = 0;

  async function read() {
    const at = ++epoch;
    try {
      const next = await commands.loginItemStatus();
      if (at === epoch) status = next;
    } catch {
      // The last known answer stands.
    }
  }

  async function set(enabled: boolean) {
    pending = true;
    failed = false;
    const at = ++epoch;
    try {
      const next = await commands.loginItemSet(enabled);
      if (at !== epoch) return;
      status = next;
      failed = next.enabled !== enabled && !(enabled && next.needs_approval);
    } catch {
      failed = true;
    } finally {
      pending = false;
    }
  }

  onMount(() => {
    void read();
    const reread = () => void read();
    window.addEventListener("focus", reread);
    return () => window.removeEventListener("focus", reread);
  });

  let on = $derived(!!status && (status.enabled || status.needs_approval));
  let description = $derived(
    failed
      ? m.general_login_failed()
      : status?.needs_approval
        ? m.general_login_approval()
        : m.general_login_help(),
  );
</script>

{#if status?.supported}
  <SettingsRow settingId="general.login" title={m.general_login_title()} {description}>
    <div class="login">
      {#if status.needs_approval}<Button
          size="compact"
          onclick={() => void commands.loginItemOpenSettings().catch(() => false)}
          >{m.general_login_approve()}</Button
        >{/if}
      <Switch
        label={m.general_login_title()}
        labelHidden
        checked={on}
        disabled={pending}
        onchange={(value) => void set(value)}
      />
    </div>
  </SettingsRow>
{/if}

<style>
  .login {
    display: flex;
    align-items: center;
    gap: 12px;
  }
</style>
