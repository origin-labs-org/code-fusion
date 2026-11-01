import type {
  BotConfig,
  BotProviderCallbackResult,
  BotsConfigFile,
} from "@origin-ai/cf-shared";
import type { ICredentialService } from "../credential/credential.js";
import { getWeixinUpdates } from "./providers/weixinProvider.js";
import {
  acquireWeixinPollingLock,
  assertBotCallbackSucceeded,
  BOT_RUNTIME_LOCK_RETRY_MS,
  createBotConnectionFingerprint,
  createLatestRuntimeRefreshQueue,
  type BotRuntimeLogger,
  type BotRuntimeStatusSink,
  waitFor,
} from "./channelRuntime.js";

interface WeixinChannelRuntimeDeps {
  runBackgroundTasks?: boolean;
  credentialService: ICredentialService;
  logger: BotRuntimeLogger;
  statusSink: BotRuntimeStatusSink;
  ensureBotStorageMigrated(): Promise<void>;
  readConfig(): Promise<BotsConfigFile>;
  readWeixinGetUpdatesBuf(botId: string): Promise<string | undefined>;
  writeWeixinGetUpdatesBuf(botId: string, buf: string): Promise<void>;
  processProviderCallback(
    provider: "weixin",
    payload: unknown,
  ): Promise<BotProviderCallbackResult>;
  getUpdates?: typeof getWeixinUpdates;
  acquirePollingLock?: typeof acquireWeixinPollingLock;
}

export function createWeixinChannelRuntime(deps: WeixinChannelRuntimeDeps) {
  interface RuntimeEntry {
    controller: AbortController;
    fingerprint: string;
    done: Promise<void>;
  }

  const runtimes = new Map<string, RuntimeEntry>();
  const refreshQueue = createLatestRuntimeRefreshQueue();

  async function getConnectionFingerprint(bot: BotConfig): Promise<string> {
    const credential = bot.credentialRef
      ? await deps.credentialService.load(bot.credentialRef)
      : null;
    return createBotConnectionFingerprint([
      bot.provider,
      bot.credentialRef ?? "",
      credential ?? "",
    ]);
  }

  async function pollBot(bot: BotConfig, signal: AbortSignal): Promise<void> {
    const token = bot.credentialRef
      ? await deps.credentialService.load(bot.credentialRef)
      : null;
    if (!token?.trim()) {
      deps.statusSink.setRuntimeStatus({
        botId: bot.id,
        provider: "weixin",
        status: "error",
        message: "Weixin bot token is missing.",
      });
      return;
    }

    while (!signal.aborted) {
      let lock: Awaited<ReturnType<typeof acquireWeixinPollingLock>>;
      try {
        lock = await (deps.acquirePollingLock ?? acquireWeixinPollingLock)(
          token,
          bot.id,
        );
      } catch (error) {
        if (signal.aborted) return;
        deps.statusSink.setRuntimeStatus({
          botId: bot.id,
          provider: "weixin",
          status: "error",
          message: `Weixin polling lock failed: ${error instanceof Error ? error.message : String(error)}`,
        });
        await waitFor(5_000, signal);
        continue;
      }
      if (!lock) {
        deps.statusSink.setRuntimeStatus({
          botId: bot.id,
          provider: "weixin",
          status: "idle",
          message: "Weixin long polling is handled by another CodeFusion window.",
        });
        await waitFor(BOT_RUNTIME_LOCK_RETRY_MS, signal);
        continue;
      }
      try {
        deps.statusSink.setRuntimeStatus({
          botId: bot.id,
          provider: "weixin",
          status: "polling",
          message: "Weixin long polling is running.",
          messageId: "bots.runtime.weixinLongPollingRunning",
        });
        while (!signal.aborted) {
          const buf = await deps.readWeixinGetUpdatesBuf(bot.id);
          const result = await (deps.getUpdates ?? getWeixinUpdates)({
            bot,
            deps: { loadCredential: (key) => deps.credentialService.load(key) },
            buf,
            signal,
          });
          if (signal.aborted) {
            return;
          }
          if ((result.rawMessageCount ?? 0) > 0 || result.messages.length > 0) {
            const attachmentCount = result.messages.reduce(
              (count, message) => count + (message.attachments?.length ?? 0),
              0,
            );
            deps.logger.debug(
              undefined,
              `weixin polling received bot=${bot.id} raw=${result.rawMessageCount ?? 0} parsed=${result.messages.length} attachments=${attachmentCount}`,
            );
            if (result.messages.length === 0) {
              deps.logger.debug(
                undefined,
                `weixin polling diagnostics bot=${bot.id} ${(result.rawMessageDiagnostics ?? []).join(" | ")}`,
              );
            }
          }
          for (const inbound of result.messages) {
            if (signal.aborted) {
              return;
            }
            const callbackResult = await deps.processProviderCallback("weixin", {
              botId: bot.id,
              messages: [
                {
                  id: inbound.actor.providerMessageId,
                  text: inbound.text,
                  from: inbound.actor.providerUserId,
                  chatId: inbound.actor.chatId,
                  displayName: inbound.actor.displayName,
                  context_token: inbound.actor.providerContextToken,
                  attachments: inbound.attachments,
                },
              ],
              ...(result.buf ? { buf: result.buf } : {}),
            });
            assertBotCallbackSucceeded("Weixin", callbackResult);
          }
          if (result.buf) {
            await deps.writeWeixinGetUpdatesBuf(bot.id, result.buf);
          }
          deps.statusSink.setRuntimeStatus({
            botId: bot.id,
            provider: "weixin",
            status: "polling",
            message: "Weixin long polling is running.",
            messageId: "bots.runtime.weixinLongPollingRunning",
          });
        }
      } catch (error) {
        if (signal.aborted) {
          return;
        }
        deps.statusSink.setRuntimeStatus({
          botId: bot.id,
          provider: "weixin",
          status: "error",
          message: `Weixin polling failed: ${error instanceof Error ? error.message : String(error)}`,
        });
        await waitFor(5_000, signal);
      } finally {
        await lock.release().catch((error: unknown) => {
          deps.logger.debug(
            undefined,
            `release Weixin polling lock failed bot=${bot.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      }
    }
  }

  async function stopPolling(botId: string): Promise<void> {
    const runtime = runtimes.get(botId);
    runtime?.controller.abort();
    if (runtime) {
      await runtime.done;
      if (runtimes.get(botId) === runtime) {
        runtimes.delete(botId);
      }
    }
    const previous = deps.statusSink.getRuntimeStatus(botId);
    if (previous) {
      deps.statusSink.setRuntimeStatus({
        ...previous,
        status: "idle",
        messageId: "bots.runtime.weixinLongPollingStopped",
        message: "Weixin long polling is stopped.",
      });
    }
  }

  function startPolling(bot: BotConfig, fingerprint: string): void {
    if (runtimes.has(bot.id)) {
      return;
    }
    const controller = new AbortController();
    deps.statusSink.setRuntimeStatus({
      botId: bot.id,
      provider: "weixin",
      status: "polling",
      messageId: "bots.runtime.weixinLongPollingStarting",
      message: "Weixin long polling is starting.",
    });
    const runtime: RuntimeEntry = {
      controller,
      fingerprint,
      done: Promise.resolve(),
    };
    runtime.done = pollBot(bot, controller.signal).finally(() => {
      if (runtimes.get(bot.id) === runtime) {
        runtimes.delete(bot.id);
        const previous = deps.statusSink.getRuntimeStatus(bot.id);
        if (previous?.status === "polling") {
          deps.statusSink.setRuntimeStatus({
            botId: bot.id,
            provider: "weixin",
            status: "idle",
            messageId: "bots.runtime.weixinLongPollingStopped",
            message: "Weixin long polling is stopped.",
          });
        }
      }
    });
    runtimes.set(bot.id, runtime);
  }

  async function reconcile(
    config: BotsConfigFile | undefined,
    isLatest: () => boolean,
  ): Promise<void> {
    await deps.ensureBotStorageMigrated();
    const currentConfig = config ?? (await deps.readConfig());
    if (!isLatest()) {
      return;
    }
    const activeWeixinIds = new Set(
      currentConfig.bots
        .filter(
          (bot) =>
            bot.provider === "weixin" && bot.enabled && bot.credentialRef,
        )
        .map((bot) => bot.id),
    );
    for (const botId of runtimes.keys()) {
      if (!activeWeixinIds.has(botId)) {
        await stopPolling(botId);
        if (!isLatest()) {
          return;
        }
      }
    }
    for (const bot of currentConfig.bots) {
      if (bot.provider === "weixin" && bot.enabled && bot.credentialRef) {
        const fingerprint = await getConnectionFingerprint(bot);
        if (!isLatest()) {
          return;
        }
        const runtime = runtimes.get(bot.id);
        if (runtime && runtime.fingerprint !== fingerprint) {
          await stopPolling(bot.id);
          if (!isLatest()) {
            return;
          }
        }
        startPolling(bot, fingerprint);
      } else if (bot.provider === "weixin" && !bot.enabled) {
        deps.statusSink.setRuntimeStatus({
          botId: bot.id,
          provider: "weixin",
          status: "disabled",
          messageId: "bots.runtime.botDisabled",
          message: "Bot is disabled.",
        });
      }
    }
  }

  function refresh(config?: BotsConfigFile): Promise<void> {
    return refreshQueue.enqueue((isLatest) => reconcile(config, isLatest));
  }

  function scheduleRefresh(config?: BotsConfigFile): void {
    if (deps.runBackgroundTasks === false) {
      return;
    }
    void refresh(config).catch((error: unknown) => {
      deps.logger.warn(
        undefined,
        `refresh Weixin polling failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  async function dispose(): Promise<void> {
    refreshQueue.invalidate();
    const activeRuntimes = [...runtimes.values()];
    for (const runtime of activeRuntimes) {
      runtime.controller.abort();
    }
    await Promise.allSettled(activeRuntimes.map((runtime) => runtime.done));
    for (const [botId, runtime] of runtimes) {
      if (activeRuntimes.includes(runtime)) {
        runtimes.delete(botId);
      }
    }
  }

  return {
    dispose,
    refresh,
    scheduleRefresh,
    stopPolling,
  };
}
