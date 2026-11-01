const g = agent("g");
const out = await g.ask<string>("go");
report(new Date(out)); // error
