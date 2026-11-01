import { Server } from "@modelcontextprotocol/server";
import { type NodeReplRequestMeta, type NodeReplRunResult } from "@origin-ai/cf-core/repl";
import { type ComputerUseRuntime } from "@origin-ai/cf-cua";
import { type NodeReplCuaBrokerConnection } from "./cua-bridge.js";
import { installNodeReplProcessGuards, installNodeReplShutdownTriggers } from "./process-lifecycle.js";
export declare const NODE_REPL_MCP_PROCESS_TITLE = "cf-node-repl-mcp";
export interface NodeReplExecuteInput {
    code: string;
    requestMeta: NodeReplRequestMeta;
    signal: AbortSignal;
    syncTimeoutMs: number;
    cuaBroker?: NodeReplCuaBrokerConnection;
}
export type NodeReplExecutor = (input: NodeReplExecuteInput) => Promise<NodeReplRunResult>;
export interface NodeReplMcpRuntime {
    dispose(): void;
    server: Server;
}
export declare function setNodeReplMcpProcessTitle(target?: {
    title: string;
}): void;

export declare function createInProcessNodeReplExecutor(): NodeReplExecutor;
export declare function createNodeReplMcpRuntime(input?: {
    executeJs?: NodeReplExecutor;
    cuaRuntime?: ComputerUseRuntime;
}): NodeReplMcpRuntime;
export { installNodeReplProcessGuards, installNodeReplShutdownTriggers };
export declare function main(): Promise<void>;
export declare function captureComputerUseRuntimeFromEnvironment(env?: NodeJS.ProcessEnv): ComputerUseRuntime | undefined;
//# sourceMappingURL=server.d.ts.map