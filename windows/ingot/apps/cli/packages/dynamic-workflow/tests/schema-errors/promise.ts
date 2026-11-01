interface WithPromise {
  later: Promise<string>;
}

const g = agent("g");
const v = await g.ask<WithPromise>("go"); // error
log(JSON.stringify(v));
