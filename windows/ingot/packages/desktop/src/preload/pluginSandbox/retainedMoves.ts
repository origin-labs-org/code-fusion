
export function enableSandboxRetainedMoves(): boolean {
  if (typeof Element.prototype.moveBefore !== "function") return false;
  const define = customElements.define;
  customElements.define = function (name, constructor, options) {
    if (name === "webview") {
      const prototype = constructor.prototype as HTMLElement & {
        connectedCallback(): void;
        disconnectedCallback(): void;
        connectedMoveCallback?: () => void;
      };
      if (!prototype.connectedMoveCallback) {
        const connect = prototype.connectedCallback,
          disconnect = prototype.disconnectedCallback;
        prototype.connectedMoveCallback = function () {
          if (this.hasAttribute("data-cf-retained-sandbox")) return;
          disconnect.call(this);
          connect.call(this);
        };
      }
      customElements.define = define;
    }
    return define.call(this, name, constructor, options);
  };
  return true;
}
