<script lang="ts">
  import { commands } from "$shared/ipc/bindings";
  import * as m from "$shared/i18n/messages";
  import Button from "$shared/ui/Button";
  import SettingsRow from "$shared/ui/SettingsRow";

  let { profile }: { profile: string } = $props();
  let confirming = $state(false);
  let pending = $state(false);
  let failed = $state(false);
  let cleared = $state(false);

  async function clear() {
    if (pending) return;
    pending = true;
    failed = false;
    try {
      if (!(await commands.workClearWebsiteData(profile))) {
        failed = true;
        return;
      }
      cleared = true;
      confirming = false;
    } catch {
      failed = true;
    } finally {
      pending = false;
    }
  }
</script>

<div data-setting="work.website-data">
  <SettingsRow
    title={m.settings_work_website_data()}
    description={confirming
      ? m.settings_work_website_data_confirm()
      : m.settings_work_website_data_desc()}
  >
    <div class="actions">
      {#if confirming}<Button size="compact" variant="ghost" onclick={() => (confirming = false)}
          >{m.action_cancel()}</Button
        ><Button size="compact" variant="danger" {pending} onclick={() => void clear()}
          >{m.settings_work_website_data_apply()}</Button
        >{:else}<Button
          onclick={() => {
            cleared = false;
            failed = false;
            confirming = true;
          }}>{m.settings_work_website_data_open()}</Button
        >{/if}
    </div>
  </SettingsRow>
  {#if failed}<p class="result error" role="alert">
      {m.settings_work_website_data_failed()}
    </p>{:else if cleared}<p class="result" role="status">
      {m.settings_work_website_data_done()}
    </p>{/if}
</div>

<style>
  .actions {
    display: flex;
    gap: 8px;
  }

  .result {
    margin: 12px 18px;
    color: var(--color-muted);
    font-size: var(--text-body);
  }

  .error {
    color: var(--color-danger);
  }
</style>
