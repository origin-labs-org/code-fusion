/**
 * index.ts — Skill 主入口
 *
 * 支持Command：
 *   run()              — 个股Analytics（主流程）
 *   runDividend()      — 股息Analytics
 *   runRumorScan()     — 传闻扫描
 *   runWatchlistAdd()  — Add自选股
 *   runWatchlistList() — View自选股
 *   runWatchlistCheck()— Check提醒
 *   runWatchlistRemove()— Delete自选股
 *   runChartAnalysis() — Candlestick图Analytics
 */

import ZAI from "z-ai-web-dev-sdk";
import { fetchMultipleStocks, fetchMarketOverview, fetchGlobalMacro } from "./dataFetcher";
import { analyzeMultipleStocks, analyzeChartImage } from "./analyzer";
import { analyzeDividends, formatDividendMarkdown } from "./dividend";
import { scanRumors, formatRumorMarkdown } from "./rumorScanner";
import {
  addToWatchlist, removeFromWatchlist,
  listWatchlist, checkAlerts,
  formatWatchlistMarkdown, formatAlertsMarkdown,
} from "./watchlist";
import { SkillInput, StockInput, OutputFormat, AnalysisResult, PositionInfo, Verdict } from "./types";

// ── Input解析 ──────────────────────────────────────────────

function parseInput(raw: unknown): {
  stocks: string[];
  positions: Record<string, PositionInfo>;
  outputFormat: OutputFormat;
  mode: "full" | "quote";
  includeMarketReview: boolean;
  includeGlobalMacro: boolean;
  includeDividend: boolean;
} {
  const stocks: string[] = [];
  const positions: Record<string, PositionInfo> = {};
  let outputFormat: OutputFormat = "markdown";
  let mode: "full" | "quote" = "full";
  let includeMarketReview = false;
  let includeGlobalMacro = true;
  let includeDividend = false;

  if (typeof raw === "string") {
    raw.split(/[,，\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean).forEach((c) => stocks.push(c));
  } else if (typeof raw === "object" && raw !== null) {
    const input = raw as any;
    const rawStocks: (string | StockInput)[] = input.stocks ?? (input.stock ? [input.stock] : []);
    for (const s of rawStocks) {
      if (typeof s === "string") stocks.push(s.trim().toUpperCase());
      else if (s.code) {
        const code = s.code.trim().toUpperCase();
        stocks.push(code);
        if (s.position) positions[code] = s.position;
      }
    }
    outputFormat = input.outputFormat ?? input.format ?? "markdown";
    mode = input.mode ?? "full";
    includeMarketReview = input.includeMarketReview ?? false;
    includeGlobalMacro = input.includeGlobalMacro ?? true;
    includeDividend = input.includeDividend ?? false;
  }

  return { stocks, positions, outputFormat, mode, includeMarketReview, includeGlobalMacro, includeDividend };
}

function log(msg: string) { console.log(`[${new Date().toISOString()}] ${msg}`); }

// ── Report组装 ──────────────────────────────────────────────

function buildFullReport(
  results: AnalysisResult[],
  globalMacro?: string,
  marketOverview?: string
): string {
  const date = new Date().toLocaleDateString("zh-CN");
  const buy   = results.filter((r) => ["买入", "强烈买入"].includes(r.verdict)).length;
  const watch = results.filter((r) => r.verdict === "观望").length;
  const sell  = results.filter((r) => r.verdict === "卖出").length;

  let output = `# 📈 Stocks智能AnalyticsReport
**生成时间：** ${date}　｜　**Analytics ${results.length} 只**　｜　🟢买入/强烈买入 ${buy}　🟡观望 ${watch}　🔴卖出 ${sell}

`;
  if (globalMacro) output += `---\n\n## 🌍 全球宏观速览\n\n${globalMacro}\n\n`;
  if (marketOverview) output += `---\n\n## 🎯 大盘复盘\n\n${marketOverview}\n\n`;
  output += `---\n\n## 📊 个股决策仪表盘\n\n`;
  output += results.map((r) => {
    const warn = r.warnings.length > 0 ? `\n> ⚠️ **预警：** ${r.warnings.join(" | ")}\n` : "";
    return `${warn}\n${r.analysis}\n\n---\n`;
  }).join("\n");

  return output;
}

// ── 调用 pdf/docx skill ───────────────────────────────────

async function exportToFormat(content: string, format: "pdf" | "word"): Promise<string> {
  const zai = await ZAI.create();
  const isPDF = format === "pdf";
  const completion = await zai.chat.completions.create({
    messages: [{
      role: "user",
      content: isPDF
        ? `请创建One份 PDF Document，inner容Yes以下Stocks研报。要求：A4Pages，Font，每只Stocks独立分页，结论用颜色Label注，末尾附免责声明。\n\n${content}`
        : `请创建One份 Word (.docx) Documentation，inner容Yes以下Stocks研报。要求：Retain title层级，每只Stocks独立分页，作战Plan用表格，末尾附免责声明。\n\n${content}`,
    }],
    thinking: { type: "disabled" },
  });
  return completion.choices[0]?.message?.content ?? `${isPDF ? "PDF" : "Word"} 生成Completed`;
}

// ══════════════════════════════════════════════════════════
// 主流程：个股Analytics
// ══════════════════════════════════════════════════════════

export async function run(rawInput: unknown): Promise<{
  success: boolean; format: OutputFormat; content: string;
  summary: { total: number; buy: number; watch: number; sell: number; errors: number };
  error?: string;
}> {
  let parsed: ReturnType<typeof parseInput>;
  try { parsed = parseInput(rawInput); }
  catch (err: any) {
    return { success: false, format: "markdown", content: `❌ Input解析Failed：${err.message}`,
      summary: { total: 0, buy: 0, watch: 0, sell: 0, errors: 0 }, error: err.message };
  }

  const { stocks, positions, outputFormat, mode, includeMarketReview, includeGlobalMacro, includeDividend } = parsed;
  if (!stocks.length) return { success: false, format: outputFormat, content: "❌ 未提供Stocks代码",
    summary: { total: 0, buy: 0, watch: 0, sell: 0, errors: 0 } };

  log(`Analytics ${stocks.length} 只：${stocks.join(", ")} | 格式：${outputFormat}`);

  // 并行获取宏观Data
  let globalMacro: string | undefined;
  let marketOverview: string | undefined;
  await Promise.all([
    includeGlobalMacro ? fetchGlobalMacro().then((r) => { globalMacro = r; }) : Promise.resolve(),
    includeMarketReview ? fetchMarketOverview().then((r) => { marketOverview = r; }) : Promise.resolve(),
  ]);

  // 抓取个股Data
  let stockDataList;
  try {
    stockDataList = await fetchMultipleStocks(stocks, mode);
    log(`DataCompleted：${stockDataList.filter((d) => !d.error).length}/${stocks.length}`);
  } catch (err: any) {
    return { success: false, format: outputFormat, content: `❌ Data抓取Failed：${err.message}`,
      summary: { total: stocks.length, buy: 0, watch: 0, sell: 0, errors: stocks.length }, error: err.message };
  }

  // LLM Analytics
  const analysisResults = await analyzeMultipleStocks(stockDataList, outputFormat, positions, includeDividend);

  // Check自选股LetterNumber变化（如有）
  const signals: Record<string, Verdict> = {};
  for (const r of analysisResults) signals[r.code] = r.verdict;
  await checkAlerts(signals).catch(() => {}); // 静默更New，不阻塞主流程

  // 生成Report
  let content: string;
  try {
    const markdown = buildFullReport(analysisResults, globalMacro, marketOverview);
    if (outputFormat === "pdf") content = await exportToFormat(markdown, "pdf");
    else if (outputFormat === "word") content = await exportToFormat(markdown, "word");
    else content = markdown;
  } catch (err: any) {
    return { success: false, format: outputFormat, content: `❌ Report生成Failed：${err.message}`,
      summary: { total: stocks.length, buy: 0, watch: 0, sell: 0, errors: stocks.length }, error: err.message };
  }

  const summary = {
    total: analysisResults.length,
    buy: analysisResults.filter((r) => ["买入", "强烈买入"].includes(r.verdict)).length,
    watch: analysisResults.filter((r) => r.verdict === "观望").length,
    sell: analysisResults.filter((r) => r.verdict === "卖出").length,
    errors: stockDataList.filter((d) => d.error).length,
  };

  log(`Completed ✅ 买入:${summary.buy} 观望:${summary.watch} 卖出:${summary.sell}`);
  return { success: true, format: outputFormat, content, summary };
}

// ══════════════════════════════════════════════════════════
// 股息Analytics
// ══════════════════════════════════════════════════════════

export async function runDividend(tickers: string | string[]): Promise<string> {
  const codes = Array.isArray(tickers) ? tickers : tickers.split(/[,，\s]+/).filter(Boolean);
  log(`股息Analytics：${codes.join(", ")}`);
  const results = await analyzeDividends(codes.map((c) => c.toUpperCase()));

  let output = `# 💰 股息AnalyticsReport\n**生成时间：** ${new Date().toLocaleDateString("zh-CN")}\n\n---\n\n`;
  for (const r of results) output += formatDividendMarkdown(r) + "\n\n---\n\n";
  output += "_以上Data仅供参考，不构成Investment建议。_";
  return output;
}

// ══════════════════════════════════════════════════════════
// 传闻扫描
// ══════════════════════════════════════════════════════════

export async function runRumorScan(): Promise<string> {
  log("Start传闻扫描...");
  const result = await scanRumors();
  return formatRumorMarkdown(result);
}

// ══════════════════════════════════════════════════════════
// 自选股Manage
// ══════════════════════════════════════════════════════════

export async function runWatchlistAdd(
  ticker: string,
  opts: { targetPrice?: number; stopPrice?: number; alertOnSignal?: boolean; notes?: string } = {}
): Promise<string> {
  const result = await addToWatchlist(ticker, opts);
  return result.message;
}

export async function runWatchlistRemove(ticker: string): Promise<string> {
  const result = await removeFromWatchlist(ticker);
  return result.message;
}

export async function runWatchlistList(): Promise<string> {
  const data = await listWatchlist();
  return formatWatchlistMarkdown(data);
}

export async function runWatchlistCheck(): Promise<string> {
  const result = await checkAlerts();
  return formatAlertsMarkdown(result);
}

// ══════════════════════════════════════════════════════════
// Candlestick图Analytics
// ══════════════════════════════════════════════════════════

export async function runChartAnalysis(
  stockCode: string,
  imageUrlOrBase64: string,
  isBase64 = false
): Promise<{ success: boolean; content: string }> {
  try {
    const result = await analyzeChartImage(imageUrlOrBase64, stockCode, isBase64);
    return { success: true, content: result };
  } catch (err: any) {
    return { success: false, content: `Candlestick图AnalyticsFailed：${err.message}` };
  }
}

// ══════════════════════════════════════════════════════════
// CLI 调试
// ══════════════════════════════════════════════════════════

async function cli() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd || cmd === "--help") {
    console.log(`
Stock Analysis Skill CLI

Command：
  analyze <代码,...> [markdown|pdf|word] [--market-review] [--dividend]
  dividend <代码,...>
  rumors
  watch add <代码> [--target 价格] [--stop 价格] [--signal]
  watch remove <代码>
  watch list
  watch check

Example：
  ts-node src/index.ts analyze 600519,00700.HK,AAPL
  ts-node src/index.ts analyze AAPL --dividend
  ts-node src/index.ts dividend JNJ PG KO
  ts-node src/index.ts rumors
  ts-node src/index.ts watch add AAPL --target 200 --stop 150
  ts-node src/index.ts watch list
    `);
    process.exit(0);
  }

  if (cmd === "analyze") {
    const codes = (args[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const format = (["markdown", "pdf", "word"].find((f) => args.includes(f)) as OutputFormat) ?? "markdown";
    const includeMarketReview = args.includes("--market-review");
    const includeDividend = args.includes("--dividend");
    const result = await run({ stocks: codes, outputFormat: format, includeMarketReview, includeDividend });
    console.log(result.content);
    console.log("\n📊 Summary:", result.summary);

  } else if (cmd === "dividend") {
    const codes = args.slice(1).filter((a) => !a.startsWith("--"));
    console.log(await runDividend(codes));

  } else if (cmd === "rumors") {
    console.log(await runRumorScan());

  } else if (cmd === "watch") {
    const sub = args[1];
    if (sub === "add") {
      const ticker = args[2];
      const targetIdx = args.indexOf("--target");
      const stopIdx = args.indexOf("--stop");
      console.log(await runWatchlistAdd(ticker, {
        targetPrice: targetIdx >= 0 ? Number(args[targetIdx + 1]) : undefined,
        stopPrice: stopIdx >= 0 ? Number(args[stopIdx + 1]) : undefined,
        alertOnSignal: args.includes("--signal"),
      }));
    } else if (sub === "remove") {
      console.log(await runWatchlistRemove(args[2]));
    } else if (sub === "list") {
      console.log(await runWatchlistList());
    } else if (sub === "check") {
      console.log(await runWatchlistCheck());
    }
  }
}

if (require.main === module) {
  cli().catch((err) => { console.error(err); process.exit(1); });
}
