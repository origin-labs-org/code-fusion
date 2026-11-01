interface Finding {
  path: string;
  note: string;
}

const scout = agent("scout");
log("scanning");
const paths = await files.glob("src/**/*.ts");
report({ phase: "scanned", total: paths.length });

const findings: Finding[] = [];
for (const path of paths) {
  const note = await scout.ask<string>(`review ${path}`);
  report({ path, note });
  findings.push({ path, note });
}

log("done");
report({ phase: "done", total: findings.length });
return findings;
