import { expect, inject, test } from "vitest";

declare module "vitest" {
  export interface ProvidedContext {
    semanticMediaRuntime: string;
  }
}
type Snapshot = { c: string; n: { k: number; r: string; t?: string; n?: string }[] };
async function search(body: string, query: string): Promise<Snapshot> {
  const frame = document.createElement("iframe");
  frame.width = "800";
  frame.height = "600";
  const loaded = new Promise<void>((done) =>
    frame.addEventListener("load", () => done(), { once: true }),
  );
  frame.srcdoc = `<style>pre{white-space:pre-wrap}</style>${body}<script>${inject("semanticMediaRuntime")}
    addEventListener("load",()=>{
      const api=globalThis.__zephiumSemanticRuntimeV1;
      const b={n:128,t:16384,w:65536,x:4096,geo:true};
      const first=JSON.parse(api.invoke(JSON.stringify({v:1,i:1,g:1,s:{k:"initial"},b})));
      document.documentElement.dataset.capture=api.invoke(JSON.stringify({v:1,i:2,g:2,s:{k:"text_search",a:first.n[0].k,q:${JSON.stringify(query)}},b}));
    });</script>`;
  document.body.append(frame);
  try {
    await loaded;
    return JSON.parse(frame.contentDocument!.documentElement.dataset.capture!) as Snapshot;
  } finally {
    frame.remove();
  }
}
const content = (snapshot: Snapshot) => snapshot.n.map((node) => node.t ?? "").join("\n");

test("text search finds a bounded contiguous passage beyond a long node's initial prefix", async () => {
  const snapshot = await search(
    `<pre>Overview. ${"Background material. ".repeat(400)} The named license is Apache-2.0. It permits redistribution.</pre>`,
    "Apache",
  );
  expect(content(snapshot)).toContain(
    "The named license is Apache-2.0. It permits redistribution.",
  );
  for (const node of snapshot.n)
    expect(new TextEncoder().encode(node.t ?? "").length).toBeLessThanOrEqual(4096);
  expect(new TextEncoder().encode(content(snapshot)).length).toBeLessThanOrEqual(8192);
});

test("deep text search preserves Unicode and actual whole-word matching", async () => {
  const snapshot = await search(
    `<pre>${"界 🚀 ".repeat(1000)} Copyright belongs to the Example Foundation. License terms follow.</pre>`,
    "Foundation",
  );
  expect(content(snapshot)).toContain("Copyright belongs to the Example Foundation.");
  expect(content(snapshot)).not.toContain("\uFFFD");
  const absent = await search(
    `<pre>${"boundary ".repeat(700)} preFoundationSuffix</pre>`,
    "Foundation",
  );
  expect(content(absent)).not.toContain("preFoundationSuffix");
});

test("a bounded search cannot claim facts beyond its raw scan limit", async () => {
  const snapshot = await search(
    `<pre>${"background ".repeat(14000)} UnobservedTailFact</pre>`,
    "UnobservedTailFact",
  );
  expect(content(snapshot)).not.toContain("UnobservedTailFact");
  expect(snapshot.c).not.toBe("complete");
});

test("hidden and editable text stays excluded from deep source search", async () => {
  const snapshot = await search(
    `<main><pre>${"public material ".repeat(400)}</pre><p hidden>HiddenLicenseFact</p><div contenteditable>EditableLicenseFact</div></main>`,
    "HiddenLicenseFact EditableLicenseFact",
  );
  expect(content(snapshot)).not.toContain("HiddenLicenseFact");
  expect(content(snapshot)).not.toContain("EditableLicenseFact");
});

test("symbol-only searches reach exact deep source passages without regex matching", async () => {
  const snapshot = await search(
    `<pre>${"ordinary material ".repeat(500)} The listed price is $42 for one item.</pre>`,
    "$42",
  );
  expect(content(snapshot)).toContain("The listed price is $42 for one item.");
  const symbol = await search(
    `<pre>${"ordinary material ".repeat(500)} The currency marker is $ here.</pre>`,
    "$",
  );
  expect(content(symbol)).toContain("The currency marker is $ here.");
});
