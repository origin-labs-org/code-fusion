interface Address {
  city: string;
  zip?: string;
}

interface Person {
  name: string;
  age: number;
  address: Address;
  nickname?: string;
}

const g = agent("g");
const person = await g.ask<Person>("produce a person");
log(JSON.stringify(person));
