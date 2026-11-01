/**
 * dividend.ts
 * 股息Analytics模块（适配 finance skill）
 * 移植原版评分逻辑：安全评分 / CAGR / 连续增Long年Count / 派息可持续性
 */

import ZAI from "z-ai-web-dev-sdk";
import { DividendAnalysis, PayoutStatus, IncomeRating } from "./types";

// ── 核心评分逻辑（与原版完全One致）──────────────────────────

function calcPayoutStatus(payoutRatio: number | null): PayoutStatus {
  if (payoutRatio === null) return "unknown";
  if (payoutRatio < 40) return "safe";
  if (payoutRatio < 60) return "moderate";
  if (payoutRatio < 80) return "high";
  return "unsustainable";
}

function calcSafetyScore(data: {
  payoutRatio: number | null;
  dividendGrowth5y: number | null;
  consecutiveYears: number | null;
  dividendYield: number | null;
}): { score: number; factors: string[] } {
  let score = 50;
  const factors: string[] = [];

  // 派息率（±20）
  if (data.payoutRatio !== null) {
    if (data.payoutRatio < 40) { score += 20; factors.push(`派息率Health（${data.payoutRatio.toFixed(0)}%）`); }
    else if (data.payoutRatio < 60) { score += 10; factors.push(`派息率适Medium（${data.payoutRatio.toFixed(0)}%）`); }
    else if (data.payoutRatio < 80) { score -= 10; factors.push(`派息率偏High（${data.payoutRatio.toFixed(0)}%）`); }
    else { score -= 20; factors.push(`派息率不可持续（${data.payoutRatio.toFixed(0)}%）`); }
  }

  // 5年增Long率（±15）
  if (data.dividendGrowth5y !== null) {
    if (data.dividendGrowth5y > 10) { score += 15; factors.push(`股息增Long强劲（${data.dividendGrowth5y.toFixed(1)}% CAGR）`); }
    else if (data.dividendGrowth5y > 5) { score += 10; factors.push(`股息增Long良OK（${data.dividendGrowth5y.toFixed(1)}% CAGR）`); }
    else if (data.dividendGrowth5y > 0) { score += 5; factors.push(`股息小幅增Long（${data.dividendGrowth5y.toFixed(1)}% CAGR）`); }
    else { score -= 15; factors.push(`股息下降（${data.dividendGrowth5y.toFixed(1)}% CAGR）`); }
  }

  // 连续增Long年Count（±15）
  if (data.consecutiveYears !== null) {
    if (data.consecutiveYears >= 25) { score += 15; factors.push(`股息贵族（连续${data.consecutiveYears}年增Long）`); }
    else if (data.consecutiveYears >= 10) { score += 10; factors.push(`Long期稳定股息（${data.consecutiveYears}年）`); }
    else if (data.consecutiveYears >= 5) { score += 5; factors.push(`股息稳定（${data.consecutiveYears}年）`); }
  }

  // High收益率风险（-10）
  if (data.dividendYield !== null) {
    if (data.dividendYield > 8) { score -= 10; factors.push(`收益率过High（${data.dividendYield.toFixed(1)}%），需核实可持续性`); }
    else if (data.dividendYield < 1) { factors.push(`收益率偏Low（${data.dividendYield.toFixed(2)}%）`); }
  }

  return { score: Math.max(0, Math.min(100, score)), factors };
}

function calcIncomeRating(safetyScore: number): IncomeRating {
  if (safetyScore >= 80) return "excellent";
  if (safetyScore >= 60) return "good";
  if (safetyScore >= 40) return "moderate";
  return "poor";
}

// ── Passed finance skill 获取股息Data ──────────────────────

async function fetchDividendData(ticker: string): Promise<Record<string, any>> {
  const zai = await ZAI.create();

  const completion = await zai.chat.completions.create({
    messages: [{
      role: "user",
      content: `请Query ${ticker} 的股息Data，只Back JSON，包含：
name（公司Name）, currentPrice（Current股价）,
dividendYield（年化股息率%）, annualDividend（Annual每股股息）,
trailingEps（过去12月每股收益）,
exDividendDate（除权日 YYYY-MM-DD 格式）,
paymentFrequency（"monthly"/"quarterly"/"annual"，根据派息频率判断）,
dividendHistory（近5年Annual股息Array，每项含 year and total，从New到OldSort）,
consecutiveYears（连续股息增Long年Count，整Count）,
dividendGrowth5y（近5年股息 CAGR %）。
缺失Character段填 null，不得捏造。`,
    }],
    thinking: { type: "disabled" },
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  return JSON.parse(raw.replace(/```json|```/g, "").trim());
}

// ── 主Analytics函Count ────────────────────────────────────────────

export async function analyzeDividend(ticker: string): Promise<DividendAnalysis> {
  ticker = ticker.toUpperCase();

  let raw: Record<string, any> = {};
  try {
    raw = await fetchDividendData(ticker);
  } catch (err: any) {
    return {
      ticker, name: ticker, currentPrice: null,
      dividendYield: null, annualDividend: null,
      payoutRatio: null, payoutStatus: "unknown",
      dividendGrowth5y: null, consecutiveYears: null,
      exDividendDate: null, paymentFrequency: null,
      safetyScore: 0, safetyFactors: [`DataFailed to fetch：${err.message}`],
      incomeRating: "poor", dividendHistory: [],
      summary: `${ticker} 股息DataFailed to fetch。`,
    };
  }

  // 无股息
  if (!raw.annualDividend || raw.annualDividend === 0) {
    return {
      ticker, name: raw.name ?? ticker,
      currentPrice: raw.currentPrice ?? null,
      dividendYield: null, annualDividend: null,
      payoutRatio: null, payoutStatus: "no_dividend",
      dividendGrowth5y: null, consecutiveYears: null,
      exDividendDate: null, paymentFrequency: null,
      safetyScore: 0, safetyFactors: ["该Stocks不派息"],
      incomeRating: "no_dividend", dividendHistory: [],
      summary: `${ticker} 目前不派发股息。`,
    };
  }

  // 计算派息率
  const payoutRatio = (raw.trailingEps && raw.trailingEps > 0 && raw.annualDividend)
    ? parseFloat(((raw.annualDividend / raw.trailingEps) * 100).toFixed(1))
    : null;

  const payoutStatus = calcPayoutStatus(payoutRatio);
  const { score: safetyScore, factors: safetyFactors } = calcSafetyScore({
    payoutRatio,
    dividendGrowth5y: raw.dividendGrowth5y ?? null,
    consecutiveYears: raw.consecutiveYears ?? null,
    dividendYield: raw.dividendYield ?? null,
  });

  const incomeRating = calcIncomeRating(safetyScore);

  // 生成Summary
  const parts: string[] = [];
  if (raw.dividendYield) parts.push(`收益率 ${Number(raw.dividendYield).toFixed(2)}%`);
  if (payoutRatio) parts.push(`派息率 ${payoutRatio.toFixed(0)}%`);
  if (raw.dividendGrowth5y) parts.push(`5年增Long ${Number(raw.dividendGrowth5y) > 0 ? "+" : ""}${Number(raw.dividendGrowth5y).toFixed(1)}%`);
  if (raw.consecutiveYears && raw.consecutiveYears >= 5) parts.push(`连续增Long ${raw.consecutiveYears} 年`);

  const ratingLabel: Record<IncomeRating, string> = {
    excellent: "优秀", good: "良OK", moderate: "One般", poor: "较差", no_dividend: "无股息",
  };

  return {
    ticker,
    name: raw.name ?? ticker,
    currentPrice: raw.currentPrice ?? null,
    dividendYield: raw.dividendYield ? Number(Number(raw.dividendYield).toFixed(2)) : null,
    annualDividend: raw.annualDividend ?? null,
    payoutRatio,
    payoutStatus,
    dividendGrowth5y: raw.dividendGrowth5y ? Number(Number(raw.dividendGrowth5y).toFixed(2)) : null,
    consecutiveYears: raw.consecutiveYears ?? null,
    exDividendDate: raw.exDividendDate ?? null,
    paymentFrequency: raw.paymentFrequency ?? null,
    safetyScore,
    safetyFactors,
    incomeRating,
    dividendHistory: raw.dividendHistory ?? [],
    summary: `${ticker}（${raw.name ?? ""}）：${parts.join("，")}。评级：${ratingLabel[incomeRating]}`,
  };
}

// ── 格式化Output（Markdown 仪表盘）─────────────────────────

export function formatDividendMarkdown(analysis: DividendAnalysis): string {
  if (analysis.incomeRating === "no_dividend") {
    return `### 💰 股息Analytics · ${analysis.ticker}\n\n该Stocks目前不派发股息。`;
  }

  const ratingEmoji: Record<IncomeRating, string> = {
    excellent: "🏆", good: "✅", moderate: "⚠️", poor: "❌", no_dividend: "—",
  };

  const payoutLabel: Record<string, string> = {
    safe: "✅ 安全", moderate: "⚠️ 适Medium", high: "⚠️ 偏High", unsustainable: "❌ 不可持续", unknown: "暂缺",
  };

  let md = `### 💰 股息Analytics · ${analysis.ticker}（${analysis.name}）

| Point toLabel | CountValue |
|------|------|
| 股息收益率 | ${analysis.dividendYield ? `${analysis.dividendYield}%` : "暂缺"} |
| Annual每股股息 | ${analysis.annualDividend ? `$${analysis.annualDividend}` : "暂缺"} |
| 派息频率 | ${analysis.paymentFrequency ?? "暂缺"} |
| 除权日 | ${analysis.exDividendDate ?? "暂缺"} |
| 派息率 | ${analysis.payoutRatio ? `${analysis.payoutRatio}%（${payoutLabel[analysis.payoutStatus]}）` : "暂缺"} |
| 5年股息增Long | ${analysis.dividendGrowth5y ? `${analysis.dividendGrowth5y > 0 ? "+" : ""}${analysis.dividendGrowth5y}%` : "暂缺"} |
| 连续增Long年Count | ${analysis.consecutiveYears ?? "暂缺"} |

**安全评分：${analysis.safetyScore}/100　${ratingEmoji[analysis.incomeRating]} 收入评级：${analysis.incomeRating.toUpperCase()}**

评分依据：
${analysis.safetyFactors.map((f) => `- ${f}`).join("\n")}
`;

  if (analysis.dividendHistory.length > 0) {
    md += `\n近年股息历史：\n`;
    md += analysis.dividendHistory.slice(0, 5).map((h) => `- ${h.year}年：$${h.total}`).join("\n");
  }

  return md;
}

// ── 批量Analytics ──────────────────────────────────────────────

export async function analyzeDividends(tickers: string[]): Promise<DividendAnalysis[]> {
  const results: DividendAnalysis[] = [];
  for (const ticker of tickers) {
    results.push(await analyzeDividend(ticker));
    await new Promise((r) => setTimeout(r, 200));
  }
  return results;
}
