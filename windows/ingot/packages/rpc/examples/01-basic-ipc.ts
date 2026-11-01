

import {
  Emitter,
  Event,
  IServerChannel,
  ChannelServer,
  ChannelClient,
  createQueuePair,
} from "../src/index.js";

// ============================================================================
// ============================================================================

class CalculatorService {
  private readonly _onDidCompute = new Emitter<{ op: string; result: number }>();
  readonly onDidCompute = this._onDidCompute.event;

  add(a: number, b: number): number {
    const result = a + b;
    this._onDidCompute.fire({ op: `${a} + ${b}`, result });
    return result;
  }

  multiply(a: number, b: number): number {
    const result = a * b;
    this._onDidCompute.fire({ op: `${a} * ${b}`, result });
    return result;
  }

  async divide(a: number, b: number): Promise<number> {
    if (b === 0) {
      throw new Error("Division by zero");
    }
    const result = a / b;
    this._onDidCompute.fire({ op: `${a} / ${b}`, result });
    return result;
  }
}

// ============================================================================
// ============================================================================

class CalculatorChannel implements IServerChannel {
  constructor(private service: CalculatorService) {}

  call(_ctx: string, command: string, arg?: any): Promise<any> {
    switch (command) {
      case "add":
        return Promise.resolve(this.service.add(arg[0], arg[1]));
      case "multiply":
        return Promise.resolve(this.service.multiply(arg[0], arg[1]));
      case "divide":
        return this.service.divide(arg[0], arg[1]);
      default:
        throw new Error(`Unknown command: ${command}`);
    }
  }

  listen(_ctx: string, event: string): Event<any> {
    switch (event) {
      case "onDidCompute":
        return this.service.onDidCompute;
      default:
        throw new Error(`Unknown event: ${event}`);
    }
  }
}

// ============================================================================
// ============================================================================

async function main() {
  const [protocolA, protocolB] = createQueuePair();

  const service = new CalculatorService();
  const server = new ChannelServer(protocolB, "server-ctx");
  server.registerChannel("calculator", new CalculatorChannel(service));

  const client = new ChannelClient(protocolA);

  await Event.toPromise(client.onDidInitialize);

  const calculator = client.getChannel("calculator");

  const disposable = calculator.listen<{ op: string; result: number }>("onDidCompute")((e) => {
    console.log(`  [event] ${e.op} = ${e.result}`);
  });

  console.log("--- Basic IPC Demo ---");

  const sum = await calculator.call<number>("add", [10, 20]);
  console.log(`add(10, 20) = ${sum}`);

  const product = await calculator.call<number>("multiply", [6, 7]);
  console.log(`multiply(6, 7) = ${product}`);

  const quotient = await calculator.call<number>("divide", [100, 3]);
  console.log(`divide(100, 3) = ${quotient}`);

  try {
    await calculator.call("divide", [1, 0]);
  } catch (err: any) {
    console.log(`divide(1, 0) → Error: ${err.message}`);
  }

  disposable.dispose();
  client.dispose();
  server.dispose();

  console.log("\nDone!");
}

main().catch(console.error);
