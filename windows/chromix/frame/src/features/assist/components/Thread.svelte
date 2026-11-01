<script lang="ts">
  import * as m from "$shared/i18n/messages";
  import Button from "$shared/ui/Button";
  import Icon from "$shared/ui/Icon";
  import type { AssistSession } from "../lib/assist-session.svelte";
  import { ArrowDown02Icon } from "../lib/icons";
  import Empty from "./Empty.svelte";
  import PersonMessage from "./PersonMessage.svelte";
  import Reply from "./Reply.svelte";

  let {
    session,
    onwork,
    onexit,
  }: {
    session: AssistSession;
    onwork: (work: string) => void;
    /** Leaves the starts for the field below. */
    onexit: () => void;
  } = $props();

  let scroller = $state<HTMLElement>();
  let content = $state<HTMLElement>();
  /** The reader is at the end: the thread follows what arrives. */
  let pinned = $state(true);
  const messages = $derived(session.conversation.messages);
  const latest = $derived(session.latest?.id ?? null);

  const reduced = () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.dataset.reduceMotion === "true";

  function onscroll() {
    if (!scroller) return;
    pinned = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 32;
  }

  function toEnd(smooth: boolean) {
    scroller?.scrollTo({
      top: scroller.scrollHeight,
      behavior: smooth && !reduced() ? "smooth" : "auto",
    });
  }

  // What arrives grows the content; a pinned reader stays at its end.
  $effect(() => {
    const element = content;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      if (pinned) toEnd(false);
    });
    observer.observe(element);
    return () => observer.disconnect();
  });

  // A new message of the person's own always brings the thread to its end.
  let seen = 0;
  $effect(() => {
    const count = messages.length;
    const mine = messages.at(-2)?.kind === "person" || messages.at(-1)?.kind === "person";
    if (count > seen && mine) {
      pinned = true;
      queueMicrotask(() => toEnd(seen > 0));
    }
    seen = count;
  });
</script>

<div class="frame">
  <div
    class="thread"
    data-assist-thread
    bind:this={scroller}
    {onscroll}
    data-tauri-drag-region="false"
  >
    <div class="content" bind:this={content}>
      {#if session.unavailable}
        <section class="down" role="alert">
          <p>{m.assist_unavailable()}</p>
          <Button size="compact" onclick={() => session.refresh()}>{m.assist_retry()}</Button>
        </section>
      {:else if session.loading}
        <span class="sr-only" role="status">{m.panel_loading()}</span>
      {:else if messages.length === 0 && session.status}
        <Empty
          status={session.status}
          onsuggest={(suggestion) => void session.ask("", suggestion)}
          {onexit}
        />
      {:else}
        <div class="messages" role="log" aria-label={m.assist_thread_label()}>
          {#each messages as message (message.id)}
            {#if message.kind === "person"}
              <PersonMessage {message} />
            {:else}
              <Reply reply={message} {session} latest={message.id === latest} {onwork} />
            {/if}
          {/each}
        </div>
      {/if}
    </div>
  </div>
  {#if !pinned && messages.length}
    <button
      type="button"
      class="down-pill"
      aria-label={m.assist_to_end()}
      title={m.assist_to_end()}
      onclick={() => {
        pinned = true;
        toEnd(true);
      }}><Icon icon={ArrowDown02Icon} size={15} strokeWidth={2} /></button
    >
  {/if}
</div>

<style>
  .frame {
    position: relative;
    display: flex;
    flex: 1;
    flex-direction: column;
    min-block-size: 0;
  }

  .thread {
    flex: 1;
    min-block-size: 0;
    overflow: auto;
    overscroll-behavior: contain;
    scrollbar-gutter: stable;
  }

  .content {
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    min-block-size: 100%;
    padding: 4px 14px 18px 16px;
  }

  .messages {
    display: flex;
    flex-direction: column;
    gap: 24px;
    padding-block-start: 8px;
  }

  .down {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
    padding-block-start: 24px;
  }

  .down p {
    margin: 0;
    color: var(--color-muted);
    font-size: 13px;
    line-height: 1.5;
  }

  .down-pill {
    position: absolute;
    inset-block-end: 10px;
    inset-inline-start: 50%;
    display: grid;
    place-items: center;
    inline-size: 30px;
    block-size: 30px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--color-float);
    box-shadow: var(--shadow-popover);
    color: var(--color-text);
    cursor: default;
    translate: -50% 0;
    animation: pill 160ms var(--ease-out) both;
    transition: scale var(--motion-fast) var(--ease-smooth);
  }

  .down-pill:active {
    scale: 0.92;
  }

  .down-pill:focus-visible {
    outline: 2px solid var(--color-ring);
    outline-offset: 2px;
  }

  @keyframes pill {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .down-pill {
      animation: none;
    }
  }
</style>
