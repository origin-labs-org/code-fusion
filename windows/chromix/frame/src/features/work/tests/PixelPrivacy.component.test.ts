import { expect, inject, test } from "vitest";

declare module "vitest" {
  export interface ProvidedContext {
    pixelPrivacyRuntime: string;
  }
}
type Proof = { v: number; r: number; c: boolean; w: number; h: number; x: number; y: number };
async function survey(
  body: string,
  change = "",
  privacy = inject("pixelPrivacyRuntime"),
): Promise<[Proof, Proof]> {
  const frame = document.createElement("iframe");
  frame.width = "800";
  frame.height = "600";
  const loaded = new Promise<void>((done) =>
    frame.addEventListener("load", () => done(), { once: true }),
  );
  frame.srcdoc = `<style>body{margin:0}input{width:150px;height:30px}</style>${body}<script>${privacy}${inject("semanticMediaRuntime")}
    addEventListener("load",()=>{
      const api=globalThis.__zephiumSemanticRuntimeV1;
      const before=JSON.parse(api.invoke("P1:privacy"));
      ${change}
      const after=JSON.parse(api.invoke("P1:privacy"));
      document.documentElement.dataset.proofs=JSON.stringify([before,after]);
    });</script>`;
  document.body.append(frame);
  try {
    await loaded;
    return JSON.parse(frame.contentDocument!.documentElement.dataset.proofs!) as [Proof, Proof];
  } finally {
    frame.remove();
  }
}
test("ordinary content has a stable content-free privacy proof", async () => {
  const [before, after] = await survey(
    "<main><h1>Public listing</h1><p>A cabin in the hills.</p></main>",
  );
  expect(before.c).toBe(true);
  expect(after).toEqual(before);
  expect(Object.keys(before).sort()).toEqual(["c", "h", "r", "v", "w", "x", "y"]);
});
test("whole-viewport proof sees credentials outside the requested card", async () => {
  for (const extra of [
    '<input type="password" value="never-export">',
    '<input autocomplete="one-time-code">',
    '<iframe src="about:blank"></iframe>',
    '<private-widget style="display:block;width:150px;height:80px"></private-widget>',
  ]) {
    const [before] = await survey(`<article><h1>Safe card</h1></article>${extra}`);
    expect(before.c).toBe(false);
  }
});
test("DOM and programmatic input changes invalidate an earlier capture proof", async () => {
  const [before, after] = await survey(
    '<input id="public" value="one">',
    'document.getElementById("public").value="two";',
  );
  expect(before.c && after.c).toBe(true);
  expect(after.r).toBeGreaterThan(before.r);
  const [first, last] = await survey(
    "<main><h1>Listing</h1></main>",
    'const p=document.createElement("input");p.type="password";document.body.append(p);',
  );
  expect(first.c).toBe(true);
  expect(last.c).toBe(false);
  expect(last.r).toBeGreaterThan(first.r);
});
test("visible credentials in an open shadow tree are refused", async () => {
  const [, after] = await survey(
    '<div id="host"></div>',
    'document.getElementById("host").attachShadow({mode:"open"}).innerHTML="<input type=password>";',
  );
  expect(after.c).toBe(false);
});

test("offscreen credentials and compositor-only motion cannot authorize pixels", async () => {
  const [hidden] = await survey(
    '<input type="password" value="never-export" style="position:absolute;left:-9999px">',
  );
  expect(hidden.c).toBe(false);
  const [, moving] = await survey(
    '<div id="moving" style="width:100px;height:100px">Overlay</div>',
    'document.getElementById("moving").animate([{transform:"translateX(-900px)"},{transform:"translateX(0)"}],{duration:10000,iterations:Infinity});',
  );
  expect(moving.c).toBe(false);
});

test("a value redacted by semantic byte or character rules refuses pixels", async () => {
  for (const value of ["🚀".repeat(1100), "public\u202Evalue"]) {
    const [, after] = await survey(
      '<input id="value">',
      `document.getElementById("value").value=${JSON.stringify(value)};`,
    );
    expect(after.c).toBe(false);
  }
});

test("exhausting the privacy survey permanently refuses capture for this document", async () => {
  const [before, after] = await survey(
    "<main>Safe page</main>",
    `
    for(let index=0;index<257;index+=1){const host=document.createElement("div");host.style.cssText="width:100px;height:1px";host.attachShadow({mode:"open"}).textContent="safe";document.body.append(host);}
    const exhausted=JSON.parse(api.invoke("P1:privacy"));
    if(exhausted.c) throw new Error("exhausted survey incorrectly authorized pixels");
    document.body.replaceChildren();
  `,
  );
  expect(before.c).toBe(true);
  expect(after.c).toBe(false);
});

test("known secret text split across visible nodes and open shadows refuses pixels", async () => {
  for (const body of [
    "<span>sk-</span><span>fixture-secret-value</span>",
    '<span aria-label="sk-">One</span><span aria-label="fixture-secret-value">Two</span>',
    '<span>Bearer </span><input value="fixture-secret-value">',
    '<div style="width:0;height:0;overflow:visible">sk-fixture-secret-value</div>',
  ]) {
    const [proof] = await survey(body);
    expect(proof.c).toBe(false);
  }
  for (const inner of [
    "<span>sk-</span><span>fixture-secret-value</span>",
    "sk-fixture-secret-value",
  ]) {
    const [, proof] = await survey(
      '<div id="host" style="width:300px;height:30px"></div>',
      `document.getElementById("host").attachShadow({mode:"open"}).innerHTML=${JSON.stringify(inner)};`,
    );
    expect(proof.c).toBe(false);
  }
});

test("exhausted visible text budget never certifies partial pixel coverage", async () => {
  const [, proof] = await survey(
    "<main>Ordinary page</main>",
    `for(let i=0;i<17;i++){const p=document.createElement("p");p.style.cssText="position:absolute;top:0;left:0";p.textContent="a".repeat(4096);document.body.append(p);}`,
  );
  expect(proof.c).toBe(false);
});

test("revision overflow permanently refuses proof after actual change events", async () => {
  const original = inject("pixelPrivacyRuntime");
  const seed = "let revision = 1,";
  expect(original.split(seed)).toHaveLength(2);
  const seeded = original.replace(seed, "let revision = Number.MAX_SAFE_INTEGER - 1,");
  const [, after] = await survey(
    "<main>Safe page</main>",
    `dispatchEvent(new Event("input"));dispatchEvent(new Event("change"));
     const overflow=JSON.parse(api.invoke("P1:privacy"));
     if(overflow.c || overflow.r!==Number.MAX_SAFE_INTEGER)throw new Error("overflow did not close privacy proof");
     document.body.replaceChildren();dispatchEvent(new Event("input"));`,
    seeded,
  );
  expect(after.c).toBe(false);
  expect(after.r).toBe(Number.MAX_SAFE_INTEGER);
});

test("recognized private key formats share the native semantic redaction policy", async () => {
  for (const format of ["OPENSSH", "DSA", "ENCRYPTED", "PGP"]) {
    const suffix = format === "PGP" ? " PRIVATE KEY BLOCK-----" : " PRIVATE KEY-----";
    const [proof] = await survey(`<span>-----BEGIN ${format}</span><span>${suffix}</span>`);
    expect(proof.c).toBe(false);
  }
});
