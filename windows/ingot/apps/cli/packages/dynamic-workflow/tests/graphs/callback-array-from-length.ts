// Callback invocation family (docs/analysis.md), the motivating
// script: a fan-out written as `Array.from({ length: TOTAL }, (_, i) => agent(...).ask(...))`.
// The mapper is a per-element callback per the registry, so its body is a `fanout` region
// INSIDE phase#1 (not a detached body swept to the end under `unphased`), the worker lane
// carries `within=fan-out#1`, and the summarizer's ask follows the join. Cardinality is
// absent: `{ length: TOTAL }` is not an array literal (the card renders as `many`).
interface Item {
  
  id: number;
  
  fact: string;
  
  funScore: number;
}

interface WorkflowReport {
  
  conclusion: string;
  
  items: Item[];
  
  verified: string[];
  
  notCovered: string[];
}

phase("并发发起 50 个独立 worker");
const TOTAL = 50;
log(`fan-out: ${TOTAL} 个独立 worker，One次性All发出`);

const items = await Promise.all(
  Array.from({ length: TOTAL }, (_, i) =>
    agent(`worker-${i}`, {
      system: "You are a micro worker in a parallel stress test. Only respond with the single number assigned to you; do not provide unnecessary context.",
    }).ask<Item>(
      `To出关于CountCharacter ${i} 的One个有趣Count学事实（One句话），并To它 1-5 的趣味评分。CountCharacter本身也要放进Back的 id Character段。`,
    ),
  ),
);

phase("Aggregate outputs from 50 workers");
const summary = await agent("summarizer", {
  system: "You aggregate results from parallel workers, outputting only a concise summary in Chinese.",
}).ask<string>(
  `以下Yes ${TOTAL} 个并行 worker 各自Back的CountCharacter事实（JSON Array）。写 2-3 句Summary：覆盖了哪些CountCharacter、平均趣味评分大About多少、最有意思的几条Yes什么。\n${JSON.stringify(items)}`,
);

const avg = items.reduce((s, it) => s + (it.funScore || 0), 0) / Math.max(items.length, 1);
const result: WorkflowReport = {
  conclusion: `50 个 worker AllConcurrencyCompleted，平均趣味评分 ${avg.toFixed(1)}。Summary者点评：${summary}`,
  items,
  verified: [`All ${items.length}/${TOTAL} 个 worker 都Back了带 id、fact、funScore 的产物`],
  notCovered: ["这是纯并行度演示，worker 结果未做独立复核"],
};
return result;
