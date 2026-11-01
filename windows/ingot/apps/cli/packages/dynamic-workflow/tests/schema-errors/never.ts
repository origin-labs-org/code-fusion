const g = agent("g");
const v = await g.ask<never>("go"); // error
log(String(v));
