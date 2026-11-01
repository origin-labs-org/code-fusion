import { AccountProviderService, ProviderConfigMap } from "@origin-ai/cf-provider";
import { NodeProviderRegistryRuntime } from "../../src/provider-registry-runtime.js";

let account!: AccountProviderService;
const runtime = new NodeProviderRegistryRuntime({
  cfBuiltinFilePath: process.argv[2]!,
  personalFilePath: process.argv[3]!,
  personalPollingIntervalMs: false,
  createAccountSource(configSource) {
    account = new AccountProviderService({
      configSource,
      resolve: async () => ({ providers: ProviderConfigMap.empty(), states: {} }),
    });
    return account;
  },
});
function report() {
  const snapshot = runtime.registryService.getSnapshot()!;
  process.send?.({
    pid: process.pid,
    builtin: snapshot.config.cfBuiltinRevision,
    account: snapshot.account.basedOnCfBuiltinRevision,
  });
}
runtime.registryService.onDidChange(report);
await runtime.start();
report();
process.on("message", () => {
  runtime.dispose();
  account.dispose();
  process.disconnect();
});
process.on("disconnect", () => {
  runtime.dispose();
  account.dispose();
});
