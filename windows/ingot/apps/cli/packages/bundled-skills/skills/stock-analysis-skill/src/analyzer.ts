/**
 * analyzer.ts — LLM/VLM Analytics层
 * 七段式决策仪表盘 + 美股可附加股息Analytics
 */

import ZAI from "z-ai-web-dev-sdk";
import { StockData, AnalysisResult, OutputFormat, Market, Verdict, PositionInfo } from "./types";
import { validateStockData } from "./dataFetcher";
import { analyzeDividend, formatDividendMarkdown } from "./dividend";

const MARKET_LABEL: Record<Market, string> = { CN: "A股", HK: "港股", US: "美股" };

// ── 仪表盘 Prompt ─────────────────────────────────────────

function buildDashboardPrompt(
  data: StockData,
  position: PositionInfo | undefined,
  warnings: string[]
): string {
  const warningBlock = warnings.length > 0
    ? `⚠️ Data预警（必须在ReportMedium体现）：\n${warnings.map((w) => `- ${w}`).join("\n")}\n\n`
    : "";

  const positionBlock = position
    ? position.status === "holding"
      ? `User持仓：持仓Medium，成本价 ${position.cost ?? "Unknown"} 元${position.shares ? `，${position.shares} 股` : ""}。请To出盈亏Analyticsand针对性建议。`
      : `User持仓：Current空仓。`
    : `User持仓：未提供（请同时To出空仓者and持仓者两套建议）。`;

  return `${warningBlock}${positionBlock}

StocksData：
\`\`\`json
${JSON.stringify(data, null, 2)}
\`\`\`

请Output以下格式的Complete决策仪表盘（严格按Structures，不增删章节）：

---

## 决策仪表盘 · {Name}({代码}) · {市场}

---

### 📰 重要Letter息速览
**💭 舆情情绪：** One句话描述
**📊 Performance预期：** 结合 PE/ROE/行业简述，Data缺失Label"暂缺"
**🚨 风险警报：**
- 风险1（技术面or宏观）
- 风险2（基本面or行业）
**✨ 利OK催化：**
- 利OK1（技术面）
- 利OK2（基本面or行业）
**📢 最New动态：** 结合行业背景，Supplement1条关键Letter息

---

### 📌 核心结论
**[emoji] 结论：强烈买入 / 买入 / 观望 / 卖出**（四选One，乖离率>5%不得为买入）
**💬 One句话决策：** 核心逻辑
**⏰ 时效性：** 立即行动 / 今日inner / 不急

（根据持仓StatusOutput）
- **🆕 空仓者：** Yes否进场、建仓点位、仓位比例
- **💼 持仓者：** 持有/加仓/减仓/止损建议${position?.status === "holding" && position.cost ? "，含成本盈亏Analytics" : ""}

---

### 📈 当日Market Trends
列出：收盘价、昨收、开盘、Max、最Low、涨跌幅、涨跌额、振幅、成交量、成交额（缺失Label"暂缺"）

---

### 📊 Data透视

**技术面：**
表格（Point toLabel | CountValue | 解读）：MA5、MA10、MA20、乖离率(BIAS20)、RSI（如有）、支撑位、压力位
结论：均线Status + 趋势强度（xx/100）

**基本面（注明Report期）：**
表格（Point toLabel | CountValue | 行业对比）：ROE、毛利率、净利率、资产负债率、PE、PB
Data缺失Label"暂缺"，不得捏造

**资金面：**（A股/港股适用，美股可Omitted）
- 主力净流入：Amount（占比%），One句话解读
- 筹码：获利比例 | 平均成本 | 集Medium度

---

### 🎯 作战Plan

| 点位类型 | 价格 | Description |
|---------|------|------|
| 🎯 理想买入 | xxx | |
| 🔵 times优买入 | xxx | |
| 🛑 止损位   | xxx | |
| 🎊 Target位   | xxx | |

**💰 仓位建议：** x成
**建仓策Omitted：** 分批策Omitted
**风控策Omitted：** 止损纪律

---

### ✅ Check清单
- ✅/⚠️/❌ 均线Status
- ✅/⚠️/❌ 乖离率安全（<5%）
- ✅/⚠️/❌ 量能配合
- ✅/⚠️/❌ 估Value合理
- ✅/⚠️/❌ 资金流向
- ✅/⚠️/❌ 筹码Health

**综合结论：** One句话SummaryCurrentStatusand建议。

---
*以上Analytics仅供参考，不构成Investment建议，据此操作风险自担。*`;
}

// ── 研报 Prompt（PDF/Word）──────────────────────────────

function buildReportPrompt(data: StockData, position: PositionInfo | undefined): string {
  const positionBlock = position?.status === "holding"
    ? `User持仓成本：${position.cost ?? "Unknown"}`
    : "UserCurrent空仓";

  return `${positionBlock}

StocksData：
\`\`\`json
${JSON.stringify(data, null, 2)}
\`\`\`

请生成Structures化研报：

【ResearchReport】{Name}({代码}) · {市场} · {Date}

I.Investment结论（买入/强烈买入/观望/卖出，含Target价、止损价，分空仓/持仓两套建议）
Two、重要Letter息速览（舆情/Performance预期/风险/利OK/最New动态）
Three、Data透视（技术面/基本面/资金面）
四、作战Plan（点位表/仓位/持仓周期）
五、风险Notice（2-3条）

免责声明：本Report由AIAssist生成，仅供参考，不构成Investment建议，据此操作风险自担。`;
}

// ── 提取结论 ──────────────────────────────────────────────

function extractVerdict(text: string): Verdict {
  const patterns = [
    /结论[：:]\s*[💚🟢🟡🔴⚪]?\s*(强烈买入|买入|观望|卖出)/,
    /核心结论[：:]\s*[💚🟢🟡🔴⚪]?\s*(强烈买入|买入|观望|卖出)/,
    /\*\*(强烈买入|买入|观望|卖出)\*\*/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1] as Verdict;
  }
  return "观望";
}

// ── 核心Analytics ──────────────────────────────────────────────

export async function analyzeStock(
  data: StockData,
  outputFormat: OutputFormat = "markdown",
  position?: PositionInfo,
  includeDividend = false
): Promise<AnalysisResult> {
  const { valid, warnings } = validateStockData(data);
  const name = data.name ?? data.code;

  if (!valid) {
    return {
      code: data.code, market: data.market, name,
      verdict: "观望",
      analysis: `## ⚠️ DataFailed to fetch\n\n${data.code} Data无法获取（${data.error ?? "UnknownError"}），建议手动核实。`,
      warnings, outputFormat,
      generatedAt: new Date().toISOString(),
    };
  }

  const zai = await ZAI.create();
  const userPrompt = outputFormat === "markdown"
    ? buildDashboardPrompt(data, position, warnings)
    : buildReportPrompt(data, position);

  let analysisText = "⚠️ LLM 未Backinner容，请Retry。";
  try {
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "system", content: `你YesOne位资深${MARKET_LABEL[data.market]}StocksAnalytics师。Data缺失Label"暂缺"，严禁捏造。乖离率>5%不得建议买入。结论四选One：强烈买入/买入/观望/卖出。Output语言：。` },
        { role: "user", content: userPrompt },
      ],
      thinking: { type: "disabled" },
    });
    analysisText = completion.choices[0]?.message?.content ?? analysisText;
  } catch (err: any) {
    analysisText = `## ⚠️ AnalyticsFailed\n\nLLM 调用出Wrong：${err.message}`;
  }

  // 美股附加股息Analytics
  if (includeDividend && data.market === "US" && outputFormat === "markdown") {
    try {
      const dividend = await analyzeDividend(data.code);
      const dividendMd = formatDividendMarkdown(dividend);
      analysisText += `\n\n${dividendMd}`;
    } catch {}
  }

  return {
    code: data.code, market: data.market, name,
    verdict: extractVerdict(analysisText),
    analysis: analysisText,
    warnings, outputFormat,
    generatedAt: new Date().toISOString(),
  };
}

// ── 批量Analytics ──────────────────────────────────────────────

export async function analyzeMultipleStocks(
  stockDataList: StockData[],
  outputFormat: OutputFormat = "markdown",
  positions?: Record<string, PositionInfo>,
  includeDividend = false
): Promise<AnalysisResult[]> {
  const results: AnalysisResult[] = [];
  for (const data of stockDataList) {
    const position = positions?.[data.code];
    results.push(await analyzeStock(data, outputFormat, position, includeDividend));
  }
  return results;
}

// ── Candlestick图Analytics（VLM）──────────────────────────────────────

export async function analyzeChartImage(
  imageUrlOrBase64: string,
  stockCode: string,
  isBase64 = false
): Promise<string> {
  try {
    const zai = await ZAI.create();
    const imageContent = isBase64
      ? { type: "base64" as const, data: imageUrlOrBase64, mediaType: "image/png" as const }
      : { type: "url" as const, url: imageUrlOrBase64 };

    const completion = await zai.chat.completions.create({
      messages: [
        { role: "system", content: "你Yes技术Analytics专家，擅LongCandlestick形态识别。请用Answer。" },
        {
          role: "user",
          content: [
            { type: "image", image: imageContent },
            { type: "text", text: `This is ${stockCode} 的Candlestick图，请Analytics：\n1. CurrentCandlestick形态\n2. 趋势方向\n3. 关键支撑位and压力位\n4. 成交量配合\n5. 短期操作建议` },
          ],
        },
      ],
    });
    return completion.choices[0]?.message?.content ?? "⚠️ VLM 未Backinner容";
  } catch (err: any) {
    return `Candlestick图AnalyticsFailed：${err.message}`;
  }
}
