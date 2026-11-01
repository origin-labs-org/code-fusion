import { expect, inject, test } from "vitest";

declare module "vitest" {
  export interface ProvidedContext {
    semanticMediaRuntime: string;
  }
}

async function identityFixture(rebind: boolean) {
  const frame = document.createElement("iframe");
  frame.width = "800";
  frame.height = "600";
  frame.srcdoc = `<button style="width:120px;height:40px">Save changes</button><script>${inject("semanticMediaRuntime")}
  addEventListener("load",async()=>{
    try{
      const api=globalThis.__zephiumSemanticRuntimeV1;
      const b={n:128,t:16384,w:65536,x:4096,geo:true};
      const observe=(i,g)=>JSON.parse(api.invoke(JSON.stringify({v:1,i,g,s:{k:"initial"},b})));
      const first=observe(1,1), original=first.n.find(n=>n.r==="button");
      const target=document.querySelector("button");
      if(${rebind}){
        const replacement=target.cloneNode(true);target.replaceWith(replacement);
        replacement.addEventListener("click",()=>document.documentElement.dataset.clicked="replacement");
        const f={...(original.ak===undefined?{}:{a:original.ak}),r:7,o:original.o||0,q:1,s:original.s||0,n:original.n??null,vk:0,vt:null,vo:0,vb:false};
        const result=await api.invoke(JSON.stringify({v:1,o:"action_execute",a:1,i:1,g:1,t:original.k,r:"button",k:"click",e:original.b,p:0,z:null,f,of:null}));
        const after=observe(2,2).n.find(n=>n.r==="button");
        document.documentElement.dataset.trace=JSON.stringify({original:original.k,replacement:after.k,result,clicked:document.documentElement.dataset.clicked});
      }else{
        const resumed=observe(2,2).n.find(n=>n.r==="button");
        const paragraph=document.createElement("p");paragraph.textContent="Unrelated observation record";target.before(paragraph);
        const reordered=observe(3,3), same=reordered.n.find(n=>n.r==="button");
        target.replaceWith(target.cloneNode(true));
        const fresh=observe(4,4).n.find(n=>n.r==="button");
        document.documentElement.dataset.trace=JSON.stringify({original:original.k,resumed:resumed.k,reordered:same.k,replacement:fresh.k,firstOrdinal:first.n.indexOf(original),nextOrdinal:reordered.n.indexOf(same)});
      }
    }catch(error){document.documentElement.dataset.error=String(error);}
  });</script>`;
  document.body.append(frame);
  try {
    await expect
      .poll(
        () =>
          frame.contentDocument?.documentElement.dataset.trace ??
          frame.contentDocument?.documentElement.dataset.error,
      )
      .toBeTruthy();
    expect(frame.contentDocument!.documentElement.dataset.error).toBeUndefined();
    return JSON.parse(frame.contentDocument!.documentElement.dataset.trace!) as Record<
      string,
      string | number
    >;
  } finally {
    frame.remove();
  }
}

test("same-document recapture retains native keys while observation ordinals can move", async () => {
  const trace = await identityFixture(false);
  expect(trace.resumed).toBe(trace.original);
  expect(trace.reordered).toBe(trace.original);
  expect(trace.nextOrdinal).not.toBe(trace.firstOrdinal);
  expect(trace.replacement).not.toBe(trace.original);
});

test("the existing stale-target recipe can transfer a native key to a replacement element", async () => {
  const trace = await identityFixture(true);
  expect(JSON.parse(String(trace.result))).toMatchObject({ b: "fixed_semantic_recipe" });
  expect(trace.clicked).toBe("replacement");
  expect(trace.replacement).toBe(trace.original);
});

test("actual PARK resets semantic keys inside the same document and private runtime", async () => {
  const frame = document.createElement("iframe");
  frame.width = "800";
  frame.height = "600";
  frame.srcdoc = `<button>Save changes</button><script>
    let pendingPull=null;let parked=false;
    Object.defineProperty(globalThis,"webkit",{value:{messageHandlers:{zephiumSemanticRuntimeV1:{postMessage(message){
      if(message==="P1")return new Promise(resolve=>pendingPull=resolve);
      if(message==="K1:A"){parked=true;return Promise.resolve("A1");}
      throw new Error("unexpected synthetic channel message");
    }}}}});
  </script><script>${inject("semanticMediaRuntime")}
    addEventListener("load",async()=>{
      try{
        const api=globalThis.__zephiumSemanticRuntimeV1;
        const capture=(i)=>JSON.parse(api.invoke(JSON.stringify({v:1,i,g:i,s:{k:"initial"},b:{n:128,t:16384,w:65536,x:4096,geo:true}}))).n.find(n=>n.r==="button").k;
        const before=capture(1);const original=document.querySelector("button");
        if(!pendingPull)throw new Error("missing native idle pull");
        pendingPull("K1");
        for(let turn=0;turn<20&&!parked;turn++)await Promise.resolve();
        if(!parked)throw new Error("missing park acknowledgement");
        original.replaceWith(original.cloneNode(true));
        const after=capture(2);
        document.documentElement.dataset.trace=JSON.stringify({parked,sameRuntime:api===globalThis.__zephiumSemanticRuntimeV1,reusedKey:before===after,differentNode:original!==document.querySelector("button")});
      }catch(error){document.documentElement.dataset.error=String(error);}
    });</script>`;
  document.body.append(frame);
  try {
    await expect
      .poll(
        () =>
          frame.contentDocument?.documentElement.dataset.trace ??
          frame.contentDocument?.documentElement.dataset.error,
      )
      .toBeTruthy();
    expect(frame.contentDocument!.documentElement.dataset.error).toBeUndefined();
    expect(JSON.parse(frame.contentDocument!.documentElement.dataset.trace!)).toEqual({
      parked: true,
      sameRuntime: true,
      reusedKey: true,
      differentNode: true,
    });
  } finally {
    frame.remove();
  }
});

test("a new document can reuse semantic numbers but not a runtime instance", async () => {
  const frame = document.createElement("iframe");
  frame.width = "800";
  frame.height = "600";
  const body = `<button>Save changes</button><script>${inject("semanticMediaRuntime")}
    addEventListener("load",()=>document.documentElement.dataset.key=String(JSON.parse(globalThis.__zephiumSemanticRuntimeV1.invoke(JSON.stringify({v:1,i:1,g:1,s:{k:"initial"},b:{n:128,t:16384,w:65536,x:4096,geo:true}}))).n.find(n=>n.r==="button").k));</script>`;
  const load = () =>
    new Promise<void>((done) => frame.addEventListener("load", () => done(), { once: true }));
  let loaded = load();
  frame.srcdoc = body;
  document.body.append(frame);
  try {
    await loaded;
    const firstDocument = frame.contentDocument!;
    const firstKey = firstDocument.documentElement.dataset.key;
    const firstRuntime = (frame.contentWindow as unknown as Record<string, unknown>)
      .__zephiumSemanticRuntimeV1;
    loaded = load();
    frame.srcdoc = body;
    await loaded;
    expect(frame.contentDocument === firstDocument).toBe(false);
    expect(
      (frame.contentWindow as unknown as Record<string, unknown>).__zephiumSemanticRuntimeV1 ===
        firstRuntime,
    ).toBe(false);
    expect(frame.contentDocument!.documentElement.dataset.key === firstKey).toBe(true);
  } finally {
    frame.remove();
  }
});
