<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { commands, type ResourceSummary } from "$shared/ipc/bindings";
  import { events } from "$shared/ipc/native-events";
  import Button from "$shared/ui/Button";
  import Icon from "$shared/ui/Icon";
  import { File01Icon, Image01Icon, Pdf01Icon, Upload01Icon } from "../lib/icons";
  import * as m from "$shared/i18n/messages";
  import PickZone from "./bar/PickZone.svelte";
  import "./bar/pick.css";
  let {
    profile,
    kind = "document",
    attachedIds = [],
    pending = false,
    onattach,
  }: {
    profile: string;
    /** Which half of the library this palette shows. */
    kind?: "document" | "image";
    attachedIds?: readonly string[];
    pending?: boolean;
    onattach: (ids: string[]) => void;
  } = $props();
  const IMAGES = /\.(png|jpe?g|gif|webp|avif|heic|heif|svg|bmp|tiff?)$/iu;
  // The newest page of the library; media is minted only by Rust.
  let library = $state.raw<ResourceSummary[]>([]);
  let reads = 0;
  async function reload() {
    const read = ++reads;
    const owner = untrack(() => profile);
    try {
      const reply = await commands.resourceCall(owner, {
        kind: "list",
        query: {
          kind: "media",
          completed: null,
          search: "",
          trashed: false,
          after: null,
          limit: 100,
        },
      });
      if (read === reads && reply.profile === owner && reply.response.kind === "page")
        library = reply.response.items;
    } catch {
      // The list stays as it was; an import still attaches directly.
    }
  }
  onMount(() => {
    void reload();
    const stop = events.resourceChanged.listen(({ payload }) => {
      if (payload.profile === profile && payload.kind === "media") void reload();
    });
    return () => void stop.then((unlisten) => unlisten());
  });
  const extension = (title: string) =>
    title.match(/\.([a-z0-9]{1,5})$/iu)?.[1]?.toUpperCase() ?? "";
  const items = $derived(library.filter((item) => IMAGES.test(item.title) === (kind === "image")));
  let selected = $state<string[]>([]);
  let importing = $state(false);
  let failure = $state<string | null>(null);
  const eligible = $derived(
    selected.filter((id) => items.some((item) => item.id === id) && !attachedIds.includes(id)),
  );
  function toggle(id: string) {
    selected = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
  }
  async function importFile() {
    if (importing) return;
    importing = true;
    failure = null;
    try {
      const result = await commands.mediaImport(profile);
      if (result.status !== "ok") {
        failure = m.work_media_import_failed();
        return;
      }
      const outcome = result.data;
      if (outcome.kind === "imported") {
        await reload();
        onattach([outcome.record.id]);
      } else if (outcome.kind === "refused") {
        failure =
          outcome.error === "capacity"
            ? m.work_media_import_too_large()
            : m.work_media_import_failed();
      }
    } catch {
      failure = m.work_media_import_failed();
    } finally {
      importing = false;
    }
  }
</script>

<section
  class="picker"
  aria-label={kind === "image" ? m.work_env_images() : m.work_env_documents()}
  aria-busy={pending || importing}
>
  {#if items.length}
    <ul>
      {#each items as item (item.id)}
        <li>
          <label class="row">
            <input
              type="checkbox"
              class="pick-check"
              checked={eligible.includes(item.id)}
              disabled={pending || attachedIds.includes(item.id)}
              onchange={() => toggle(item.id)}
            />
            <span class="glyph"
              ><Icon
                icon={item.title.toLowerCase().endsWith(".pdf")
                  ? Pdf01Icon
                  : IMAGES.test(item.title)
                    ? Image01Icon
                    : File01Icon}
                size={15}
              /></span
            >
            <span class="identity">
              <strong>{item.title}</strong>
              <span class="where"
                >{attachedIds.includes(item.id)
                  ? m.work_media_added()
                  : extension(item.title)}</span
              >
            </span>
          </label>
        </li>
      {/each}
    </ul>
  {/if}
  {#if failure}<p role="alert">{failure}</p>{/if}
  {#if items.length}
    <footer>
      <Button
        size="compact"
        variant="ghost"
        disabled={pending || importing}
        onclick={() => void importFile()}
        ><Icon icon={Upload01Icon} size={13} />{importing
          ? m.work_media_importing()
          : m.work_media_import()}</Button
      ><Button
        size="compact"
        variant="primary"
        disabled={pending || eligible.length === 0}
        onclick={() => onattach([...eligible])}
        >{m.work_media_add({ count: eligible.length })}</Button
      >
    </footer>
  {:else}
    <PickZone icon={kind === "image" ? Image01Icon : File01Icon} text={m.work_media_none()}>
      {#snippet action()}<Button
          size="compact"
          disabled={pending || importing}
          onclick={() => void importFile()}
          >{importing ? m.work_media_importing() : m.work_media_import()}</Button
        >{/snippet}
    </PickZone>
  {/if}
</section>

<style>
  .picker {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 12px;
    min-block-size: 0;
    min-inline-size: 0;
  }

  ul {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-block-size: 0;
    max-block-size: 244px;
    margin: 0;
    padding: 0;
    overflow: auto;
    list-style: none;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    min-block-size: 44px;
    padding: 4px 10px;
    border-radius: var(--radius-control);
    transition: background-color var(--motion-fast) var(--ease-smooth);
  }

  .row:hover {
    background: var(--row-active);
  }

  .glyph {
    display: grid;
    flex: none;
    inline-size: 28px;
    block-size: 28px;
    place-items: center;
    border-radius: var(--radius-control-compact);
    background: var(--color-fill);
    color: var(--color-muted);
  }

  .identity {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 1px;
    min-inline-size: 0;
  }

  .identity strong {
    overflow: hidden;
    font-size: var(--text-body);
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .where {
    color: var(--color-muted);
    font-size: var(--text-caption);
  }

  p[role="alert"] {
    margin: 0;
    color: var(--color-danger);
    font-size: var(--text-caption);
  }

  footer {
    display: flex;
    flex: none;
    justify-content: space-between;
    gap: 8px;
  }
</style>
