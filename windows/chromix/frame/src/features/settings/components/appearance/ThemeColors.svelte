<script lang="ts">
  import * as m from "$shared/i18n/messages";
  import { palette, type Mode } from "$domain/appearance";
  import * as notices from "$session/notice.svelte";
  import SettingsRow from "$shared/ui/SettingsRow";
  import SegmentedControl from "$shared/ui/SegmentedControl";
  import ColorWell from "$shared/ui/ColorWell";
  import Slider from "$shared/ui/Slider";
  import Button from "$shared/ui/Button";
  import Field from "$shared/ui/Field";
  import type { ThemeEditor } from "../../lib/theme-editor.svelte";

  let {
    editor,
    mode = $bindable(),
  }: {
    editor: ThemeEditor;
    mode: Mode;
  } = $props();

  let importing = $state(false);
  let pasted = $state("");
  let invalid = $state(false);

  const fields = [
    { id: "accent", label: m.look_accent },
    { id: "bg", label: m.look_background },
    { id: "fg", label: m.look_foreground },
  ] as const;

  let custom = $derived(editor.selected === palette.CUSTOM_THEME);
  let origin = $derived(editor.current.from ? palette.preset(editor.current.from) : undefined);

  async function copy() {
    try {
      await navigator.clipboard.writeText(
        palette.encodeShare({ spec: editor.current, contrast: editor.contrast }),
      );
      notices.show(m.look_copied());
    } catch {
      // A denied clipboard leaves the theme as it is; nothing was claimed.
    }
  }

  function apply(event: SubmitEvent) {
    event.preventDefault();
    const shared = palette.decodeShare(pasted);
    invalid = shared === null;
    if (!shared) return;
    editor.adopt(shared);
    importing = false;
    pasted = "";
  }
</script>

<SettingsRow
  settingId="appearance.colors"
  title={m.look_editing()}
  description={m.look_editing_desc()}
>
  <SegmentedControl
    label={m.look_editing()}
    size="compact"
    bind:value={mode}
    options={[
      { value: "light", label: m.theme_light() },
      { value: "dark", label: m.theme_dark() },
    ]}
  />
</SettingsRow>
{#each fields as field (field.id)}
  <SettingsRow title={field.label()}>
    <ColorWell
      label={field.label()}
      hexLabel={m.look_hex({ name: field.label() })}
      value={editor.current[mode][field.id]}
      invalidLabel={m.look_hex_invalid()}
      onchange={(hex) => editor.edit(mode, field.id, hex)}
    />
  </SettingsRow>
{/each}
<SettingsRow
  settingId="appearance.contrast"
  title={m.look_contrast()}
  description={m.look_contrast_desc()}
>
  <div class="slider">
    <Slider
      label={m.look_contrast()}
      slim
      value={editor.contrast}
      onchange={(value) => editor.setContrast(value)}
    />
  </div>
</SettingsRow>
<div class="actions">
  {#if editor.failed}
    <p class="note error" role="alert">{m.look_save_failed()}</p>
  {:else if custom}
    <p class="note">{origin ? m.look_based_on({ name: origin.name }) : m.look_custom()}</p>
    {#if origin}
      <Button
        size="compact"
        variant="ghost"
        aria-label={m.look_reset_to({ name: origin.name })}
        onclick={() => editor.reset()}>{m.look_reset()}</Button
      >
    {/if}
  {/if}
  <span class="spacer"></span>
  <Button size="compact" onclick={copy}>{m.look_copy()}</Button>
  <Button
    size="compact"
    aria-expanded={importing}
    onclick={() => {
      importing = !importing;
      invalid = false;
    }}>{m.look_import()}</Button
  >
</div>
{#if importing}
  <form class="import" onsubmit={apply}>
    <Field
      label={m.look_import_label()}
      labelHidden
      placeholder="zephium-theme:v1:…"
      spellcheck="false"
      autocomplete="off"
      bind:value={pasted}
      hint={m.look_import_hint()}
      error={invalid ? m.look_import_invalid() : undefined}
      oninput={() => (invalid = false)}
    />
    <Button type="submit" size="compact" variant="primary" disabled={pasted.trim() === ""}
      >{m.look_import_apply()}</Button
    >
  </form>
{/if}

<style>
  .slider {
    width: 240px;
  }

  .actions {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 18px;
  }

  .actions::before,
  .import::before {
    content: "";
    position: absolute;
    inset-inline: 16px 0;
    top: 0;
    height: 1px;
    background: var(--color-border);
  }

  .note {
    min-width: 0;
    margin: 0;
    overflow: hidden;
    color: var(--color-muted);
    font-size: var(--text-label);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .error {
    color: var(--color-danger);
  }

  .spacer {
    flex: 1;
  }

  .import {
    position: relative;
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: start;
    gap: 10px;
    padding: 14px 18px 16px;
  }

  .import :global(.ui-button) {
    margin-block-start: 1px;
  }
</style>
