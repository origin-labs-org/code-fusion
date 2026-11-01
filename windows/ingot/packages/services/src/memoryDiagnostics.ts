import type { IDisposable } from "@origin-ai/cf-rpc";
import {
  createMemoryDiagnosticsRegistry,
  type MemoryDiagnosticsProvider,
  type MemoryDiagnosticsRegistry,
} from "@origin-ai/cf-shared";

export const memoryDiagnosticsRegistry: MemoryDiagnosticsRegistry =
  createMemoryDiagnosticsRegistry();

export function registerMemoryDiagnosticsProvider(
  name: string,
  provider: MemoryDiagnosticsProvider,
): IDisposable {
  return memoryDiagnosticsRegistry.register(name, provider);
}

export function collectServiceMemoryDiagnostics(): Record<string, number> {
  return memoryDiagnosticsRegistry.collect();
}
