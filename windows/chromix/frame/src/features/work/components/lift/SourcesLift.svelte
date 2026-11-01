<script lang="ts" module>
  /** One page or file a run drew on, as the sources lift lists it. */
  export type SourceEntry = {
    key: string;
    title: string;
    /** The site, or the folder a file sits in. */
    host: string;
    url: string;
    /** What the run took from it, in a line. */
    note?: string;
    /** The file record it is, when it is a file. */
    file?: string;
  };
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import HostGlyph from "../cards/HostGlyph.svelte";
  import LiftHeader from "../LiftHeader.svelte";
  import LiftRow from "./LiftRow.svelte";
  import LiftSection from "./LiftSection.svelte";
  import { GlobalIcon } from "../../lib/icons";
  import * as m from "$shared/i18n/messages";
  /** The pages and files a run or one of its parts read, and the ones that would not open. */
  let {
    kind,
    title,
    rows,
    unread = [],
    notes,
    onopen,
  }: {
    kind: string;
    /** A part's own name; the run's sources need none. */
    title?: string;
    rows: readonly SourceEntry[];
    unread?: readonly { key: string; host: string; note: string }[];
    /** What a part handed the lead, read before the pages it came from. */
    notes?: Snippet;
    onopen: (row: SourceEntry) => void;
  } = $props();
</script>

<div class="sources">
  <LiftHeader {kind} {title} icon={GlobalIcon} />
  <div class="sections">
    {#if notes}<div class="notes">{@render notes()}</div>{/if}
    {#if rows.length}<LiftSection title={m.work_lift_read()} count={rows.length}>
        {#each rows as row (row.key)}<LiftRow
            title={row.title}
            detail={row.note || row.host}
            onclick={() => onopen(row)}
          >
            {#snippet leading()}<HostGlyph
                host={row.host}
                url={row.url}
                file={!!row.file}
                size={16}
              />{/snippet}
          </LiftRow>{/each}
      </LiftSection>{/if}
    {#if unread.length}<LiftSection title={m.work_lift_unread()} count={unread.length}>
        {#each unread as page (page.key)}<LiftRow
            title={page.host}
            detail={page.note}
            tone="failed"
          >
            {#snippet leading()}<HostGlyph host={page.host} size={16} />{/snippet}
          </LiftRow>{/each}
      </LiftSection>{/if}
  </div>
</div>

<style>
  .sources {
    display: flex;
    flex-direction: column;
  }

  .sections {
    display: flex;
    flex-direction: column;
    gap: 24px;
    padding-block-start: 12px;
  }

  .notes {
    display: flex;
    flex-direction: column;
    gap: 28px;
  }
</style>
