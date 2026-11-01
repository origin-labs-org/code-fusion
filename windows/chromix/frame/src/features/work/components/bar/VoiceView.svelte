<script lang="ts">
  import { onMount, untrack } from "svelte";
  import Icon from "$shared/ui/Icon";
  import { VoiceTake, engineName } from "$domain/voice";
  import { commands } from "$shared/ipc/bindings";
  import * as m from "$shared/i18n/messages";
  import { Alert02Icon, Cancel01Icon } from "../../lib/icons";
  import { voiceProblem } from "../../lib/voice-problem";
  import VoiceWave from "./VoiceWave.svelte";

  let {
    oncommit,
    onclose,
    take: provided,
  }: {
    /** The words, once, when a take is done. */
    oncommit: (text: string) => void;
    /** The view has nothing left to show. */
    onclose: () => void;
    /** A take to drive instead of a new one, for tests. */
    take?: VoiceTake;
  } = $props();

  // The view drives one take for its whole life.
  const take = untrack(() => provided) ?? new VoiceTake((text) => oncommit(text));
  let stopButton = $state<HTMLButtonElement>();
  let now = $state(performance.now());

  /** The bar's mic and the shortcut: stop while listening, else close. */
  export function toggle() {
    if (take.phase === "listening" || take.phase === "starting") take.stop();
    else if (take.phase === "failed") {
      take.cancel();
      onclose();
    }
  }

  onMount(() => {
    if (!untrack(() => provided)) void take.start();
    stopButton?.focus();
    return () => take.dispose();
  });

  // The view closes itself once the words have gone to the bar or the take
  // was cancelled.
  let opened = false;
  $effect(() => {
    if (take.phase !== "idle") opened = true;
    else if (opened) onclose();
  });

  $effect(() => {
    if (take.phase !== "listening") return;
    const timer = setInterval(() => (now = performance.now()), 250);
    return () => clearInterval(timer);
  });

  const elapsed = $derived.by(() => {
    const seconds = take.since === null ? 0 : Math.max(0, Math.floor((now - take.since) / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  });
  const cloud = $derived(take.engine !== null && take.engine !== "on_device");
  const problem = $derived(take.problem ? voiceProblem(take.problem, take.engine) : null);
  const announcement = $derived(
    take.phase === "listening"
      ? m.voice_listening()
      : take.phase === "transcribing"
        ? m.voice_transcribing()
        : "",
  );

  function cancel() {
    take.cancel();
    onclose();
  }

  function remedy() {
    switch (problem?.remedy) {
      case "settings":
        void commands.runCommand("settings.ai");
        return cancel();
      case "plans":
      case "account":
      case "limit":
        void commands.runCommand("settings.account");
        return cancel();
      case "microphone":
      case "recognition":
      case "dictation":
        void commands.voiceOpenPrivacy(problem.remedy).catch(() => false);
        return cancel();
      case "retry":
        return void take.start();
    }
  }

  const remedyLabel = $derived(
    problem?.remedy === "settings"
      ? m.voice_remedy_settings()
      : problem?.remedy === "plans"
        ? m.work_fault_fix_plans()
        : problem?.remedy === "account"
          ? m.work_fault_fix_account()
          : problem?.remedy === "limit"
            ? m.work_fault_fix_limit()
            : problem?.remedy === "microphone" || problem?.remedy === "recognition"
              ? m.voice_remedy_privacy()
              : problem?.remedy === "dictation"
                ? m.voice_remedy_keyboard()
                : problem?.remedy === "retry"
                  ? m.voice_remedy_retry()
                  : null,
  );
</script>

<svelte:window
  onkeydown={(event) => {
    if (event.key !== "Escape" || event.isComposing || take.phase === "idle") return;
    event.preventDefault();
    event.stopPropagation();
    cancel();
  }}
/>

<div class="voice" data-phase={take.phase} role="group" aria-label={m.voice_label()}>
  {#if take.phase === "listening" && take.partial}<p class="partial">{take.partial}</p>{/if}
  <div class="strip">
    {#if problem}
      <span class="problem-mark" aria-hidden="true"><Icon icon={Alert02Icon} size={15} /></span>
      <p class="message" role="alert">{problem.message}</p>
      {#if remedyLabel}<button type="button" class="remedy" onclick={remedy}>{remedyLabel}</button
        >{/if}
      <button type="button" class="ghost" aria-label={m.voice_dismiss()} onclick={cancel}>
        <Icon icon={Cancel01Icon} size={15} strokeWidth={1.8} />
      </button>
    {:else}
      <button
        type="button"
        class="ghost"
        aria-label={m.voice_cancel()}
        title={m.voice_cancel_hint()}
        onclick={cancel}
      >
        <Icon icon={Cancel01Icon} size={15} strokeWidth={1.8} />
      </button>
      <div class="listen">
        <VoiceWave {take} phase={take.phase} />
        {#if take.phase === "transcribing"}<span class="working">{m.voice_transcribing()}</span
          >{/if}
      </div>
      <span class="meta">
        {#if cloud && take.engine}<span class="engine" title={m.voice_cloud_note()}
            >{engineName(take.engine)}</span
          >{/if}
        <span class="time" aria-hidden="true">{elapsed}</span>
      </span>
      <button
        type="button"
        class="stop"
        bind:this={stopButton}
        aria-label={take.phase === "transcribing" ? m.voice_transcribing() : m.voice_stop()}
        title={m.voice_stop()}
        aria-busy={take.phase === "transcribing" || undefined}
        disabled={take.phase === "transcribing"}
        onclick={() => take.stop()}
      >
        {#if take.phase === "transcribing"}<span class="spinner" aria-hidden="true"
          ></span>{:else}<span class="square" aria-hidden="true"></span>{/if}
      </button>
    {/if}
  </div>
  <span class="sr-only" aria-live="polite">{announcement}</span>
</div>

<style>
  /* The bar's row while it listens: cancel, the voice itself, how long, and
     the one control that matters, in the send button's place. */
  .voice {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 4px;
    min-inline-size: 0;
    animation: voice-in var(--motion-base) var(--ease-out);
  }

  @keyframes voice-in {
    from {
      opacity: 0;
    }
  }

  .partial {
    display: -webkit-box;
    margin: 0;
    padding: 2px 8px 0 40px;
    overflow: hidden;
    color: var(--color-muted);
    font-size: 14px;
    line-height: 20px;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }

  .strip {
    display: flex;
    align-items: center;
    gap: 6px;
    min-block-size: 34px;
    min-inline-size: 0;
  }

  .listen {
    position: relative;
    display: flex;
    flex: 1;
    align-items: center;
    min-inline-size: 0;
  }

  .working {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: var(--color-muted);
    font-size: var(--text-label);
    animation: working 1.6s var(--ease-in-out) infinite alternate;
  }

  @keyframes working {
    from {
      opacity: 0.55;
    }

    to {
      opacity: 1;
    }
  }

  .meta {
    display: flex;
    flex: none;
    align-items: center;
    gap: 8px;
    padding-inline: 2px;
    color: var(--color-muted);
    font-size: var(--text-label);
    font-variant-numeric: tabular-nums;
  }

  .engine {
    padding: 2px 7px;
    border-radius: var(--radius-capsule);
    background: var(--color-fill);
    color: var(--color-muted);
    font-size: var(--text-caption);
  }

  .time {
    min-inline-size: 30px;
    text-align: end;
  }

  .voice[data-phase="starting"] .time {
    opacity: 0.4;
  }

  .ghost {
    display: grid;
    flex: none;
    place-items: center;
    inline-size: 30px;
    block-size: 30px;
    margin: 2px;
    border: 0;
    border-radius: var(--radius-capsule);
    background: transparent;
    color: var(--color-muted);
    cursor: default;
    transition:
      background-color var(--motion-fast) var(--ease-out),
      color var(--motion-fast) var(--ease-out);
  }

  .ghost:hover {
    background: var(--color-fill-hover);
    color: var(--color-text);
  }

  .stop {
    display: grid;
    flex: none;
    place-items: center;
    inline-size: 30px;
    block-size: 30px;
    margin: 2px;
    border: 0;
    border-radius: var(--radius-capsule);
    background: var(--color-lit);
    color: var(--color-on-lit);
    cursor: default;
    transition:
      background-color var(--motion-fast) var(--ease-out),
      scale var(--motion-base) var(--ease-spring);
  }

  .stop:disabled {
    background: var(--color-fill);
    color: var(--color-muted);
  }

  .stop:hover:not(:disabled) {
    background: var(--color-lit-hover);
  }

  .stop:active:not(:disabled) {
    scale: 0.92;
  }

  :is(.ghost, .stop, .remedy):focus-visible {
    outline: 2px solid var(--color-ring);
    outline-offset: 2px;
  }

  .square {
    inline-size: 10px;
    block-size: 10px;
    border-radius: 2.5px;
    background: currentcolor;
  }

  .spinner {
    inline-size: 14px;
    block-size: 14px;
    box-sizing: border-box;
    border: 1.6px solid currentcolor;
    border-block-start-color: transparent;
    border-radius: 50%;
    animation: spin 0.9s linear infinite;
  }

  @keyframes spin {
    to {
      rotate: 1turn;
    }
  }

  .problem-mark {
    display: grid;
    flex: none;
    place-items: center;
    inline-size: 30px;
    color: var(--color-warning);
  }

  .message {
    flex: 1;
    min-inline-size: 0;
    margin: 0;
    color: var(--color-text);
    font-size: 13px;
    line-height: 18px;
  }

  .remedy {
    flex: none;
    block-size: 28px;
    padding-inline: 12px;
    border: 0;
    border-radius: var(--radius-capsule);
    background: var(--color-control);
    box-shadow: var(--shadow-control);
    color: var(--color-on-control);
    font: inherit;
    font-size: var(--text-label);
    font-weight: 500;
    cursor: default;
  }

  .remedy:hover {
    background: var(--color-control-hover);
  }

  .sr-only {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }

  @media (forced-colors: active) {
    .stop {
      border: 1px solid ButtonText;
    }
  }
</style>
