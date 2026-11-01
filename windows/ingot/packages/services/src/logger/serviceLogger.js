import { formatLogPrefix } from "@origin-ai/cf-shared";
import { isEffectiveDevelopmentNodeEnv } from "#src/runtime-tools/nodeEnv.js";
export function createServiceLogger(scope, options) {
    const pid = options?.pid ?? process.pid;
    const sink = options?.sink ?? console;
    const debugOption = options?.isDebugEnabled;
    const resolveDebugEnabled = typeof debugOption === "function"
        ? debugOption
        : typeof debugOption === "boolean"
            ? () => debugOption
            : () => isEffectiveDevelopmentNodeEnv();
    function write(level, traceId, ...args) {
        if (level === "debug" && !resolveDebugEnabled()) {
            return;
        }
        const source = traceId ? `${scope}][trace:${traceId}` : scope;
        const consoleFn = level === "error"
            ? sink.error
            : level === "warn"
                ? sink.warn
                : level === "debug"
                    ? (sink.debug ?? sink.log)
                    : sink.log;
        consoleFn(formatLogPrefix(source, pid), ...args);
    }
    return {
        debug: (traceId, ...args) => write("debug", traceId, ...args),
        info: (traceId, ...args) => write("info", traceId, ...args),
        warn: (traceId, ...args) => write("warn", traceId, ...args),
        error: (traceId, ...args) => write("error", traceId, ...args),
    };
}
//# sourceMappingURL=serviceLogger.js.map