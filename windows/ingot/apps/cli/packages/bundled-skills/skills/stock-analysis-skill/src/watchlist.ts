/**
 * watchlist.ts
 * 自选股Manage + 价格提醒（使用平台 storage Persistence）
 * 移植原版Three种提醒类型：Target价 / 止损价 / LetterNumber变化
 */

import ZAI from "z-ai-web-dev-sdk";
import { WatchlistItem, WatchlistAlert, Market, Verdict } from "./types";

const STORAGE_KEY = "watchlist-data";

// ── Storage 封装 ──────────────────────────────────────────

async function loadWatchlist(): Promise<WatchlistItem[]> {
  try {
    const result = await (window as any).storage?.get(STORAGE_KEY);
    if (result?.value) return JSON.parse(result.value) as WatchlistItem[];
  } catch {}
  return [];
}

async function saveWatchlist(items: WatchlistItem[]): Promise<void> {
  try {
    await (window as any).storage?.set(STORAGE_KEY, JSON.stringify(items));
  } catch (err: any) {
    console.error("[watchlist] SaveFailed:", err.message);
  }
}

// ── 获取Current价格 ──────────────────────────────────────────

async function fetchCurrentPrice(ticker: string): Promise<number | null> {
  try {
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [{
        role: "user",
        content: `Query ${ticker} Current股价，只BackOne个 JSON：{"price": CountCharacter}，不要Otherinner容。`,
      }],
      thinking: { type: "disabled" },
    });
    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
    return typeof parsed.price === "number" ? parsed.price : null;
  } catch {
    return null;
  }
}

function detectMarket(code: string): Market {
  if (/^\d{6}$/.test(code)) return "CN";
  if (/^\d{4,5}\.HK$/i.test(code)) return "HK";
  return "US";
}

// ── Add自选股 ────────────────────────────────────────────

export async function addToWatchlist(
  ticker: string,
  opts: {
    targetPrice?: number;
    stopPrice?: number;
    alertOnSignal?: boolean;
    notes?: string;
  } = {}
): Promise<{ success: boolean; action: string; message: string; item?: WatchlistItem }> {
  ticker = ticker.toUpperCase();
  const currentPrice = await fetchCurrentPrice(ticker);

  if (currentPrice === null) {
    return { success: false, action: "error", message: `无法获取 ${ticker} 的价格，Please confirm代码正确` };
  }

  const watchlist = await loadWatchlist();
  const existingIdx = watchlist.findIndex((i) => i.ticker === ticker);

  if (existingIdx >= 0) {
    // 更New已有记录
    const existing = watchlist[existingIdx];
    if (opts.targetPrice !== undefined) existing.targetPrice = opts.targetPrice;
    if (opts.stopPrice !== undefined) existing.stopPrice = opts.stopPrice;
    if (opts.alertOnSignal !== undefined) existing.alertOnSignal = opts.alertOnSignal;
    if (opts.notes !== undefined) existing.notes = opts.notes;
    watchlist[existingIdx] = existing;
    await saveWatchlist(watchlist);

    return { success: true, action: "updated", message: `已更New ${ticker} 的自选股Settings`, item: existing };
  }

  // New增
  const item: WatchlistItem = {
    ticker,
    market: detectMarket(ticker),
    addedAt: new Date().toISOString(),
    priceAtAdd: currentPrice,
    targetPrice: opts.targetPrice ?? null,
    stopPrice: opts.stopPrice ?? null,
    alertOnSignal: opts.alertOnSignal ?? false,
    lastSignal: null,
    lastCheck: null,
    notes: opts.notes ?? null,
  };

  watchlist.push(item);
  await saveWatchlist(watchlist);

  const alertDesc = [
    opts.targetPrice ? `Target价 $${opts.targetPrice}` : null,
    opts.stopPrice ? `止损价 $${opts.stopPrice}` : null,
    opts.alertOnSignal ? "LetterNumber变化提醒" : null,
  ].filter(Boolean).join("，");

  return {
    success: true, action: "added",
    message: `已Add ${ticker} 到自选股（Current价 $${currentPrice}${alertDesc ? `，Settings了：${alertDesc}` : ""}）`,
    item,
  };
}

// ── Delete自选股 ────────────────────────────────────────────

export async function removeFromWatchlist(
  ticker: string
): Promise<{ success: boolean; message: string }> {
  ticker = ticker.toUpperCase();
  const watchlist = await loadWatchlist();
  const filtered = watchlist.filter((i) => i.ticker !== ticker);

  if (filtered.length === watchlist.length) {
    return { success: false, message: `${ticker} 不在自选股listMedium` };
  }

  await saveWatchlist(filtered);
  return { success: true, message: `已从自选股MediumDelete ${ticker}` };
}

// ── View自选股list ────────────────────────────────────────

export async function listWatchlist(): Promise<{
  items: Array<WatchlistItem & {
    currentPrice: number | null;
    changePct: number | null;
    toTargetPct: number | null;
    toStopPct: number | null;
  }>;
  count: number;
}> {
  const watchlist = await loadWatchlist();
  if (!watchlist.length) return { items: [], count: 0 };

  const items = await Promise.all(watchlist.map(async (item) => {
    const currentPrice = await fetchCurrentPrice(item.ticker);

    const changePct = currentPrice && item.priceAtAdd
      ? parseFloat((((currentPrice - item.priceAtAdd) / item.priceAtAdd) * 100).toFixed(2))
      : null;

    const toTargetPct = currentPrice && item.targetPrice
      ? parseFloat((((item.targetPrice - currentPrice) / currentPrice) * 100).toFixed(2))
      : null;

    const toStopPct = currentPrice && item.stopPrice
      ? parseFloat((((item.stopPrice - currentPrice) / currentPrice) * 100).toFixed(2))
      : null;

    return { ...item, currentPrice, changePct, toTargetPct, toStopPct };
  }));

  return { items, count: items.length };
}

// ── Check提醒 ──────────────────────────────────────────────

export async function checkAlerts(
  currentSignals?: Record<string, Verdict>
): Promise<{ alerts: WatchlistAlert[]; count: number }> {
  const watchlist = await loadWatchlist();
  const alerts: WatchlistAlert[] = [];
  const now = new Date().toISOString();

  for (const item of watchlist) {
    const currentPrice = await fetchCurrentPrice(item.ticker);
    if (currentPrice === null) continue;

    // Target价提醒
    if (item.targetPrice && currentPrice >= item.targetPrice) {
      alerts.push({
        ticker: item.ticker,
        alertType: "target_hit",
        message: `🎯 ${item.ticker} 已触达Target价！Current $${currentPrice.toFixed(2)} ≥ Target $${item.targetPrice}`,
        currentPrice,
        triggerValue: item.targetPrice,
        timestamp: now,
      });
    }

    // 止损价提醒
    if (item.stopPrice && currentPrice <= item.stopPrice) {
      alerts.push({
        ticker: item.ticker,
        alertType: "stop_hit",
        message: `🛑 ${item.ticker} 已触达止损价！Current $${currentPrice.toFixed(2)} ≤ 止损 $${item.stopPrice}`,
        currentPrice,
        triggerValue: item.stopPrice,
        timestamp: now,
      });
    }

    // LetterNumber变化提醒
    if (item.alertOnSignal && currentSignals?.[item.ticker]) {
      const newSignal = currentSignals[item.ticker];
      if (item.lastSignal && newSignal !== item.lastSignal) {
        alerts.push({
          ticker: item.ticker,
          alertType: "signal_change",
          message: `📊 ${item.ticker} LetterNumber变化：${item.lastSignal} → ${newSignal}`,
          currentPrice,
          triggerValue: `${item.lastSignal} → ${newSignal}`,
          timestamp: now,
        });
      }
      // 更New最NewLetterNumber
      item.lastSignal = newSignal;
    }

    item.lastCheck = now;
  }

  // Save更New后的 lastSignal and lastCheck
  await saveWatchlist(watchlist);

  return { alerts, count: alerts.length };
}

// ── 格式化自选股list（Markdown）─────────────────────────

export function formatWatchlistMarkdown(data: Awaited<ReturnType<typeof listWatchlist>>): string {
  if (data.count === 0) {
    return `## 📋 自选股list\n\n_自选股为空。使用 \`/stock_watch AAPL\` AddStocks。_\n`;
  }

  let md = `## 📋 自选股list（共 ${data.count} 只）\n\n`;
  md += `| 代码 | Current价 | 较买入 | Target价 | 止损价 | 距Target | 最NewLetterNumber |\n`;
  md += `|------|--------|--------|--------|--------|--------|----------|\n`;

  for (const item of data.items) {
    const price = item.currentPrice ? `$${item.currentPrice.toFixed(2)}` : "暂缺";
    const change = item.changePct !== null
      ? `${item.changePct > 0 ? "🟢+" : "🔴"}${item.changePct.toFixed(2)}%`
      : "—";
    const target = item.targetPrice ? `$${item.targetPrice}` : "—";
    const stop = item.stopPrice ? `$${item.stopPrice}` : "—";
    const toTarget = item.toTargetPct !== null ? `${item.toTargetPct > 0 ? "+" : ""}${item.toTargetPct.toFixed(1)}%` : "—";
    const signal = item.lastSignal ?? "—";

    md += `| ${item.ticker} | ${price} | ${change} | ${target} | ${stop} | ${toTarget} | ${signal} |\n`;
  }

  // 已触发的提醒
  const triggered = data.items.filter(
    (i) => (i.targetPrice && i.currentPrice && i.currentPrice >= i.targetPrice) ||
            (i.stopPrice && i.currentPrice && i.currentPrice <= i.stopPrice)
  );

  if (triggered.length > 0) {
    md += `\n### ⚡ 已触发提醒\n`;
    for (const item of triggered) {
      if (item.targetPrice && item.currentPrice && item.currentPrice >= item.targetPrice) {
        md += `- 🎯 **${item.ticker}** 已达Target价 $${item.targetPrice}\n`;
      }
      if (item.stopPrice && item.currentPrice && item.currentPrice <= item.stopPrice) {
        md += `- 🛑 **${item.ticker}** 已触止损 $${item.stopPrice}\n`;
      }
    }
  }

  return md;
}

// ── 格式化提醒Result（Markdown）────────────────────────────

export function formatAlertsMarkdown(result: Awaited<ReturnType<typeof checkAlerts>>): string {
  if (result.count === 0) {
    return `## 🔔 自选股提醒Check\n\n_Current没有触发任何提醒。_\n`;
  }

  let md = `## 🔔 自选股提醒（${result.count} 条触发）\n\n`;
  for (const alert of result.alerts) {
    md += `- ${alert.message}\n`;
  }
  return md;
}
