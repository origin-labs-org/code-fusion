// Probe-only passive event accounting, installed at document start in a private world.
(() => {
  "use strict";
  const expected = __FORM_URL__;
  const owner = document;
  const key = "__zephiumPublicFormSubmitReceiptV1";
  if (Object.prototype.hasOwnProperty.call(globalThis, key)) return;
  let count = 0;
  let uncertain = location.href !== expected || document.readyState !== "loading";
  const listener = event => {
    if (count >= 256) { uncertain = true; return; }
    if (document !== owner || location.href !== expected ||
        !(event.target instanceof HTMLFormElement) || event.target.ownerDocument !== owner) {
      uncertain = true;
      return;
    }
    count += 1;
  };
  try {
    // Passive capture observes even a page handler that prevents navigation and fetches.
    EventTarget.prototype.addEventListener.call(globalThis, "submit", listener, {capture:true, passive:true});
  } catch (_) { uncertain = true; }
  let visited = 0;
  const inspect = root => {
    const pending = [root];
    while (pending.length && !uncertain) {
      if (++visited > 4096) { uncertain = true; break; }
      const node = pending.pop();
      if (node.nodeType === 1 && (node.localName === "iframe" || node.localName === "frame" || node.shadowRoot != null)) {
        uncertain = true;
        break;
      }
      for (let child = node.firstChild; child; child = child.nextSibling) {
        if (pending.length >= 256) { uncertain = true; break; }
        pending.push(child);
      }
    }
  };
  const mutations = records => {
    if (records.length > 256) { uncertain = true; return; }
    for (const record of records) {
      if (uncertain) break;
      // Removed subtrees retain their descendants, so transient frames count too.
      for (const nodes of [record.addedNodes, record.removedNodes]) {
        if (nodes.length > 256) { uncertain = true; break; }
        for (const node of nodes) { inspect(node); if (uncertain) break; }
      }
    }
  };
  let observer;
  try {
    observer = new MutationObserver(mutations);
    observer.observe(owner, {childList:true, subtree:true});
    inspect(owner);
  } catch (_) { uncertain = true; }
  const receipt = () => {
    if (observer) mutations(observer.takeRecords());
    // attachShadow on an existing host does not emit a document mutation.
    inspect(owner);
    if (uncertain || document !== owner || location.href !== expected) return null;
    if (count > 0) return false;
    // Child documents have independent event targets; their activity is not inferred.
    return globalThis.length === 0 && document.querySelector("iframe,frame") === null ? true : null;
  };
  Object.freeze(receipt);
  Object.defineProperty(globalThis, key, {value:receipt, writable:false, configurable:false, enumerable:false});
})();
