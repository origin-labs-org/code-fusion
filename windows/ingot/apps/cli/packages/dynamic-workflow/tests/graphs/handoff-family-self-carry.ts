interface Finding { id: string; title: string; }
interface ResearchResult { findings: Finding[]; }
interface Report { markdown: string; }

const ANGLES = [
  { key: "history", name: "research-history", brief: "history" },
  { key: "frontier", name: "research-frontier", brief: "frontier" },
  { key: "safety", name: "research-safety", brief: "safety" },
  { key: "critique", name: "research-critique", brief: "critique" },
];

phase("并行调研");
const wrapped = await Promise.all(
  ANGLES.map(async (a) => ({
    key: a.key,
    result: await agent(a.name, { system: "researcher" }).ask<ResearchResult>(`Research ${a.brief}`),
  })),
);
const corpus = wrapped.map((w) => `${w.key}: ${JSON.stringify(w.result.findings)}`).join("\n");

phase("撰写终稿");
const out = await agent("writer", { system: "writer" }).ask<Report>(`合成 ${corpus}`);
return out.markdown;
