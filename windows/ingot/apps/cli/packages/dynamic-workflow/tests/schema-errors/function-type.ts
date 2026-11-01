interface WithMethod {
  transform: (input: string) => number;
}

const g = agent("g");
const v = await g.ask<WithMethod>("go"); // error
log(JSON.stringify(v));
