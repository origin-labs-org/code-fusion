/**
 * dataFetcher.ts — All passed finance skill 获取Data
 */

import ZAI from "z-ai-web-dev-sdk";
import { Market, FetchMode, StockData } from "./types";

export function detectMarket(code: string): Market {
  if (/^\d{6}$/.test(code)) return "CN";
  if (/^\d{4,5}\.HK$/i.test(code)) return "HK";
  return "US";
}

const MARKET_LABEL: Record<Market, string> = {
  CN: "A股", HK: "港股", US: "美股",
};

// ── 单只StocksData ──────────────────────────────────────────

export async function fetchStockData(
  code: string,
  mode: FetchMode = "full"
): Promise<StockData> {
  const market = detectMarket(code);
  const zai = await ZAI.create();

  const prompt = mode === "quote"
    ? `Query ${code}（${MARKET_LABEL[market]}）实时股价，只Back JSON，Character段：
       name, price, prev_close, change_pct, change_amount, volume, amount, turnover, volume_ratio, market_cap, pe_ttm, pb。`
    : `获取 ${code}（${MARKET_LABEL[market]}）CompleteStocksData，只Back JSON，包含：
       name, price, prev_close, open, high, low, change_pct, change_amount, amplitude,
       volume, amount, turnover, volume_ratio, market_cap, pe_ttm, pb, high_52w, low_52w, dividend_yield,
       ma5, ma10, ma20, bias_pct（E对MA20乖离率%）,
       trend（"多头排列"/"空头排列"/"震荡整理"）, overbought_warning（bias_pct>5则true）,
       support（支撑位）, resistance（压力位）, rsi,
       kline_recent_10（Recent10日，每项含 date/open/close/high/low/volume）,
       profit_ratio（获利比例%）, avg_cost（平均成本）, chip_concentration（筹码集Medium度）,
       roe, gross_margin, net_margin, debt_ratio, eps, revenue_growth,
       main_net（主力净流入Amount）, main_net_pct（主力净流入占比%）。
       缺失Character段填 null，不得捏造。`;

  try {
    const completion = await zai.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      thinking: { type: "disabled" },
    });
    const raw = completion.choices[0]?.message?.content ?? "";
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
    return { code, market, timestamp: new Date().toISOString(), ...parsed };
  } catch (err: any) {
    return { code, market, timestamp: new Date().toISOString(), error: err.message };
  }
}

// ── 批量抓取（串行）──────────────────────────────────────

export async function fetchMultipleStocks(
  codes: string[],
  mode: FetchMode = "full"
): Promise<StockData[]> {
  const results: StockData[] = [];
  for (let i = 0; i < codes.length; i++) {
    results.push(await fetchStockData(codes[i], mode));
    if (i < codes.length - 1) await new Promise((r) => setTimeout(r, 300));
  }
  return results;
}

// ── 全球宏观 ──────────────────────────────────────────────

export async function fetchGlobalMacro(): Promise<string> {
  const zai = await ZAI.create();
  try {
    const completion = await zai.chat.completions.create({
      messages: [{
        role: "user",
        content: `请获取今日全球市场关键Letter息，简洁 Markdown Output，包含：
- 美股Three大Point toCount昨收涨跌（道Point to/纳Point to/Label普）
- US DollarPoint toCount、Chinese Yuan汇率动向
- 黄金、原油最New价格
- 美联储最New政策动向（如有）
- 影响 A股/港股的1-2条关键宏观Events
控制在150Character以inner。`,
      }],
      thinking: { type: "disabled" },
    });
    return completion.choices[0]?.message?.content ?? "全球宏观DataFailed to fetch";
  } catch (err: any) {
    return `全球宏观DataFailed to fetch：${err.message}`;
  }
}

// ── 大盘复盘 ──────────────────────────────────────────────

export async function fetchMarketOverview(): Promise<string> {
  const zai = await ZAI.create();
  try {
    const completion = await zai.chat.completions.create({
      messages: [{
        role: "user",
        content: `请获取今日 A股大盘Data，Markdown Output，包含：
- 上证/深证/创业板/科创50 最New点位and涨跌幅
- 今日上涨/下跌/涨停/跌停家Count，成交额
- 领涨板块 TOP3 and领跌板块 TOP3
- 北向资金净流入
- One句话后市展望and仓位策Omitted
控制在200Character以inner。`,
      }],
      thinking: { type: "disabled" },
    });
    return completion.choices[0]?.message?.content ?? "大盘DataFailed to fetch";
  } catch (err: any) {
    return `大盘DataFailed to fetch：${err.message}`;
  }
}

// ── Data校验 ──────────────────────────────────────────────

export function validateStockData(data: StockData): {
  valid: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];
  if (data.error) return { valid: false, warnings: [`DataFailed to fetch：${data.error}`] };
  if (!data.price) warnings.push("价格Data缺失");
  if (!data.ma5 && !data.ma20) warnings.push("技术面Data缺失");
  if (data.overbought_warning) warnings.push(`⚠️ 乖离率 ${data.bias_pct}% 超过5%，严禁追High`);
  if (!data.roe && !data.pe_ttm) warnings.push("基本面Data不Complete");
  return { valid: !!data.price, warnings };
}
