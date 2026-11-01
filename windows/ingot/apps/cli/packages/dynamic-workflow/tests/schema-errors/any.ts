interface WithAny {
  blob: any;
}

const g = agent("g");
const v = await g.ask<WithAny>("go"); // error
log(JSON.stringify(v));
