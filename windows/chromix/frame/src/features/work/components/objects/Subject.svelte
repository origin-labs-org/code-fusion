<script lang="ts">
  import Icon from "$shared/ui/Icon";
  import type { IconSvgElement } from "@hugeicons/svelte";
  import * as m from "$shared/i18n/messages";
  import type { ObjectActions, SubjectView } from "../../lib/board/types";
  import { siteName } from "../../lib/run/site";
  import {
    ArrowUpRight01Icon,
    CheckmarkCircle02Icon,
    Doc01Icon,
    GitMergeIcon,
    GitPullRequestClosedIcon,
    GitPullRequestIcon,
    Mail01Icon,
    Message01Icon,
    PlayCircleIcon,
    RecordIcon,
    Ticket01Icon,
  } from "./icons";
  import Inline from "./Inline.svelte";
  import Mark from "./Mark.svelte";
  /** One thing in a service — a pull request, an issue, a thread — read the way that service shows it. */
  let {
    object,
    actions = {},
    centre = false,
  }: { object: SubjectView; actions?: ObjectActions; centre?: boolean } = $props();
  const host = $derived.by(() => {
    try {
      return new URL(object.url).hostname.replace(/^www\./u, "");
    } catch {
      return "";
    }
  });
  const service = $derived(host ? siteName(host) : "");
  /** `crynta/terax#1337` as where it lives and its number; a bare `#48` lives in its service. */
  const where = $derived.by(() => {
    const reference = object.reference ?? "";
    const at = reference.lastIndexOf("#");
    if (at > 0) return { path: reference.slice(0, at), number: reference.slice(at) };
    return { path: service || reference, number: service ? reference : "" };
  });
  const tone = $derived(object.status?.tone ?? "active");
  /** The service's own sign for this kind of thing in this state. */
  const glyph = $derived.by((): IconSvgElement => {
    const noun = object.noun.toLowerCase();
    if (/pull|merge request/u.test(noun))
      return tone === "done"
        ? GitMergeIcon
        : tone === "closed"
          ? GitPullRequestClosedIcon
          : GitPullRequestIcon;
    if (/issue|bug/u.test(noun)) return tone === "done" ? CheckmarkCircle02Icon : RecordIcon;
    if (/mail/u.test(noun)) return Mail01Icon;
    if (/thread|message|channel|chat|conversation/u.test(noun)) return Message01Icon;
    if (/ticket|task|story/u.test(noun)) return Ticket01Icon;
    if (/video/u.test(noun)) return PlayCircleIcon;
    return Doc01Icon;
  });
  const open = (event: MouseEvent) => {
    if (!actions.link) return;
    event.preventDefault();
    actions.link(object.url);
  };
</script>

<article class="subject" class:centre aria-label={object.heading}>
  <a
    class="where nodrag"
    href={object.url}
    onclick={open}
    title={service ? m.work_list_open_in({ app: service }) : m.work_env_open()}
  >
    {#if host}<Mark address={object.url} size={16} />{/if}
    <span class="path">{where.path}</span>
    {#if where.number}<span class="number">{where.number}</span>{/if}
    <Icon icon={ArrowUpRight01Icon} size={12} />
  </a>

  <div class="head" data-tone={tone}>
    <span class="glyph" title={object.noun}><Icon icon={glyph} size={centre ? 20 : 18} /></span>
    <h3>{object.heading}</h3>
  </div>

  <p class="meta" data-tone={tone}>
    {#if object.status}<span class="state">{object.status.label}</span>{:else}<span class="noun"
        >{object.noun}</span
      >{/if}
    {#each object.people as person, index (index)}<span class="item"
        ><span class="key">{person.role}</span> <span class="value">{person.name}</span></span
      >{/each}
    {#each object.facts as fact, index (index)}<span class="item"
        ><span class="key">{fact.label}</span> <span class="value">{fact.value}</span></span
      >{/each}
  </p>

  {#if object.summary}<p class="summary"><Inline text={object.summary} /></p>{/if}

  {#if object.labels.length}<ul class="labels">
      {#each object.labels as label (label)}<li>{label}</li>{/each}
    </ul>{/if}
</article>

<style>
  .subject {
    display: flex;
    flex-direction: column;
    gap: 8px;
    box-sizing: border-box;
    inline-size: 100%;
    padding: 16px 20px 18px;
    border-radius: var(--radius-card);
    background: var(--color-surface);
    box-shadow: var(--shadow-raised);
    color: var(--color-text);
  }

  .centre {
    gap: 12px;
    padding: 24px 28px 26px;
  }

  [data-tone] {
    --tone: var(--color-success);
  }

  [data-tone="done"] {
    --tone: var(--color-info);
  }

  [data-tone="waiting"] {
    --tone: var(--color-warning);
  }

  [data-tone="blocked"] {
    --tone: var(--color-danger);
  }

  [data-tone="closed"] {
    --tone: var(--color-muted);
  }

  /* Where it lives, as the service names it: the way back to it. */
  .where {
    display: inline-flex;
    align-items: center;
    align-self: flex-start;
    gap: 6px;
    max-inline-size: 100%;
    color: var(--color-muted);
    font-size: var(--text-label);
    text-decoration: none;
    cursor: default;
    transition: color var(--motion-fast) var(--ease-out);
  }

  .where :global(svg:last-child) {
    flex: none;
    opacity: 0;
    transition: opacity var(--motion-fast) var(--ease-out);
  }

  .where:hover {
    color: var(--color-text);
  }

  .where:hover :global(svg:last-child),
  .where:focus-visible :global(svg:last-child) {
    opacity: 1;
  }

  .where:focus-visible {
    outline: 2px solid var(--color-ring);
    outline-offset: 2px;
    border-radius: var(--radius-control-compact);
  }

  .path {
    overflow: hidden;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .number {
    flex: none;
    color: var(--color-faint);
    font-variant-numeric: tabular-nums;
  }

  .head {
    display: flex;
    align-items: flex-start;
    gap: 9px;
  }

  .glyph {
    display: grid;
    flex: none;
    place-items: center;
    block-size: 1.3em;
    color: var(--tone);
    font-size: var(--text-object-title);
  }

  .centre .glyph {
    font-size: var(--text-title);
  }

  h3 {
    margin: 0;
    font-size: var(--text-object-title);
    font-weight: 650;
    line-height: 1.3;
    letter-spacing: -0.015em;
    overflow-wrap: anywhere;
    text-wrap: balance;
  }

  .centre h3 {
    font-size: var(--text-title);
  }

  /* One quiet line of what it is now: its state in its tone, then who and the few numbers. */
  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 2px 16px;
    margin: 0;
    padding-inline-start: 27px;
    color: var(--color-muted);
    font-size: var(--text-label);
    line-height: 18px;
  }

  .centre .meta {
    padding-inline-start: 29px;
    font-size: var(--text-body);
  }

  .state {
    color: var(--tone);
    font-weight: 600;
  }

  .value {
    color: var(--color-label-secondary);
    font-variant-numeric: tabular-nums;
    font-weight: 550;
  }

  .summary {
    margin: 6px 0 0;
    max-inline-size: 68ch;
    color: var(--color-label-secondary);
    font-size: var(--text-body);
    line-height: 1.5;
    text-wrap: pretty;
  }

  .centre .summary {
    font-size: var(--text-reading);
  }

  .labels {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 4px 0 0;
    padding: 0;
    list-style: none;
  }

  .labels li {
    padding: 1px 8px;
    border-radius: var(--radius-capsule);
    box-shadow: inset 0 0 0 1px var(--color-border-strong);
    color: var(--color-label-secondary);
    font-size: var(--text-label);
    line-height: 18px;
  }
</style>
