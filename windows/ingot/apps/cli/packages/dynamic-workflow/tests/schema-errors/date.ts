interface WithDate {
  createdAt: Date;
}

const g = agent("g");
const v = await g.ask<WithDate>("go"); // error
log(JSON.stringify(v));
