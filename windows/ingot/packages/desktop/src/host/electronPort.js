
export function wrapElectronPort(port) {
    return {
        addEventListener(_type, listener) {
            port.on("message", listener);
        },
        removeEventListener(_type, listener) {
            port.off("message", listener);
        },
        postMessage(data) {
            port.postMessage(data);
        },
        start() {
            port.start();
        },
        close() {
            port.close();
        },
    };
}
//# sourceMappingURL=electronPort.js.map