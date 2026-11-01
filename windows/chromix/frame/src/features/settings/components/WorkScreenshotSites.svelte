<script lang="ts">
  import { commands, type WorkScreenshotSiteRowV1 } from "$shared/ipc/bindings";
  import * as m from "$shared/i18n/messages";
  import Button from "$shared/ui/Button";
  import SettingsRow from "$shared/ui/SettingsRow";
  import { observe } from "$shared/lib/observe";

  let { profile }: { profile: string } = $props();
  let sites = $state<WorkScreenshotSiteRowV1[]>([]);
  let pending = $state(false);
  let failed = $state(false);
  let generation = 0;
  let lifetime = new AbortController();
  let unconfirmed = $state<string | null>(null);

  async function load(origin?: string, owner = profile) {
    const current = ++generation;
    pending = true;
    failed = false;
    if (origin) unconfirmed = origin;
    try {
      const request = origin
        ? commands.workSetScreenshotSite(owner, { origin, allow: false })
        : commands.workScreenshotSites(owner);
      const observed = await observe(request, 12000, lifetime.signal);
      if (current !== generation || owner !== profile) return;
      if (observed.state !== "received") {
        failed = true;
        return;
      }
      const reply = observed.value;
      if (reply.version !== 1 || reply.profile !== owner || reply.error) {
        failed = true;
        return;
      }
      sites = reply.sites;
      unconfirmed = null;
    } catch {
      if (current === generation && owner === profile) failed = true;
    } finally {
      if (current === generation && owner === profile) pending = false;
    }
  }
  $effect(() => {
    sites = [];
    unconfirmed = null;
    lifetime = new AbortController();
    void load(undefined, profile);
    return () => {
      generation++;
      lifetime.abort();
    };
  });
</script>

<div data-setting="work.screenshot-sites">
  <SettingsRow
    title={m.settings_work_screenshot_sites()}
    description={m.settings_work_screenshot_sites_desc()}
  >
    {#if failed}
      <Button size="compact" disabled={pending} onclick={() => void load()}
        >{m.surface_retry()}</Button
      >
    {/if}
  </SettingsRow>
  {#each sites as site (site.origin)}
    <SettingsRow
      title={site.name}
      description={site.unconfirmed || unconfirmed === site.origin
        ? m.settings_work_screenshot_unconfirmed()
        : m.settings_work_screenshot_allowed()}
    >
      <Button size="compact" disabled={pending} onclick={() => void load(site.origin)}
        >{m.settings_work_screenshot_forget()}</Button
      >
    </SettingsRow>
  {/each}
  {#if failed}
    <p class="result" role="alert">
      {m.settings_work_failed()}
    </p>
  {:else if !pending && sites.length === 0}
    <p class="result">{m.settings_work_screenshot_none()}</p>
  {/if}
</div>

<style>
  .result {
    margin: 12px 18px;
    color: var(--color-muted);
    font-size: var(--text-body);
    line-height: 1.5;
  }
</style>
