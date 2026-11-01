import { expect, inject, test } from "vitest";
import { userEvent } from "vitest/browser";

declare module "vitest" {
  export interface ProvidedContext {
    semanticMediaRuntime: string;
  }
}

async function editorFixture(cdp: boolean) {
  const frame = document.createElement("iframe");
  frame.width = "800";
  frame.height = "600";
  frame.srcdoc = `<div contenteditable="true" aria-label="Document body" style="width:400px;height:80px">Draft</div><script>${inject("semanticMediaRuntime")}
  addEventListener("load", async()=>{
    try {
      const target=document.querySelector("div");
      let saves=0;
      target.addEventListener("input",()=>document.documentElement.dataset.saves=String(++saves));
      if(!${cdp})target.addEventListener("keydown",e=>{
        if(e.key!=="Backspace")return;
        e.preventDefault();target.textContent="Draf";
        target.dispatchEvent(new Event("input",{bubbles:true}));
      });
      target.focus();
      const range=document.createRange();range.selectNodeContents(target);range.collapse(false);
      const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
      const api=globalThis.__zephiumSemanticRuntimeV1;
      const snapshot=JSON.parse(api.invoke(JSON.stringify({v:1,i:1,g:1,s:{k:"initial"},b:{n:128,t:16384,w:65536,x:4096,geo:true}})));
      const node=snapshot.n.find(n=>n.r==="textbox");
      if(!node)throw new Error("missing editor");
      const f={...(node.ak===undefined?{}:{a:node.ak}),r:8,o:node.o||0,q:node.q==="sensitive"?2:1,s:node.s||0,n:node.n??null,vk:node.v?.k==="text"?1:0,vt:node.v?.value??null,vo:0,vb:false};
      const request=JSON.stringify({v:1,o:"action_execute",a:1,i:1,g:1,t:node.k,r:node.r,k:"press",pk:"backspace",e:node.b,p:0,z:null,f,of:null});
      document.documentElement.dataset.result=await (${cdp}?api.prepareCdpAction(request):api.invoke(request));
    }catch(error){document.documentElement.dataset.error=String(error);}
  });</script>`;
  document.body.append(frame);
  await expect
    .poll(
      () =>
        frame.contentDocument?.documentElement.dataset.result ??
        frame.contentDocument?.documentElement.dataset.error,
    )
    .toBeTruthy();
  const fixtureDocument = frame.contentDocument!;
  expect(fixtureDocument.documentElement.dataset.error).toBeUndefined();
  return { frame, fixtureDocument, result: fixtureDocument.documentElement.dataset.result! };
}

test("fixed JS Backspace reaches a synthetic autosaving editor key handler", async () => {
  const { frame, fixtureDocument, result } = await editorFixture(false);
  try {
    expect(JSON.parse(result)).toMatchObject({ b: "fixed_semantic_recipe" });
    expect(fixtureDocument.querySelector("div")!.textContent).toBe("Draf");
    expect(fixtureDocument.documentElement.dataset.saves).toBe("1");
  } finally {
    frame.remove();
  }
});

test("CDP native Backspace mutates the same synthetic editor and emits input", async () => {
  const { frame, fixtureDocument, result } = await editorFixture(true);
  try {
    expect(result.startsWith("P2:"), result).toBe(true);
    const down = JSON.parse(result.slice(3)) as { a: number; p: { type: string; key: string } };
    expect(down.p).toMatchObject({ type: "keyDown", key: "Backspace" });
    const api = (
      frame.contentWindow as unknown as {
        __zephiumSemanticRuntimeV1: {
          nextCdpAction(attempt: number, index: number, abort: boolean): string | Promise<string>;
        };
      }
    ).__zephiumSemanticRuntimeV1;
    await userEvent.keyboard("{Backspace>}");
    expect(fixtureDocument.querySelector("div")!.textContent).toBe("Draf");
    expect(fixtureDocument.documentElement.dataset.saves).toBe("1");
    const up = await api.nextCdpAction(down.a, 1, false);
    expect(up.startsWith("P2:"), up).toBe(true);
    await userEvent.keyboard("{/Backspace}");
    expect(JSON.parse(await api.nextCdpAction(down.a, 2, false))).toMatchObject({
      b: "engine_native_input",
    });
  } finally {
    frame.remove();
  }
});

test("checkbox-backed switches retain native checkbox activation semantics", async () => {
  const frame = document.createElement("iframe");
  frame.width = "800";
  frame.height = "600";
  const loaded = new Promise<void>((done) =>
    frame.addEventListener("load", () => done(), { once: true }),
  );
  frame.srcdoc = `<input type="checkbox" role="switch" aria-label="Delete saved items"><button role="switch">Delete selected item</button><script>${inject("semanticMediaRuntime")}
    addEventListener("load",()=>document.documentElement.dataset.capture=globalThis.__zephiumSemanticRuntimeV1.invoke(JSON.stringify({v:1,i:1,g:1,s:{k:"initial"},b:{n:128,t:16384,w:65536,x:4096,geo:true}})));</script>`;
  document.body.append(frame);
  try {
    await loaded;
    const result = JSON.parse(frame.contentDocument!.documentElement.dataset.capture!) as {
      n: { r: string; n?: string; o?: number }[];
    };
    expect(result.n.find((node) => node.n === "Delete saved items")).toMatchObject({
      r: "checkbox",
    });
    expect(result.n.find((node) => node.n === "Delete selected item")).toMatchObject({
      r: "button",
    });
  } finally {
    frame.remove();
  }
});
