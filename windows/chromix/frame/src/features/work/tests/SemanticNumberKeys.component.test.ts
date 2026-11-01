import { expect, inject, test } from "vitest";
import { userEvent } from "vitest/browser";

declare module "vitest" {
  export interface ProvidedContext {
    semanticMediaRuntime: string;
  }
}

type Trace = { fill: string; press: string; before: string; after: string; events: string[] };

type Options = {
  preventDefault?: boolean;
  cdp?: boolean;
  handledIncrement?: boolean;
  attributes?: string;
  fill?: string;
  key?: "arrow_up" | "arrow_down";
  mutation?:
    | "type"
    | "replace"
    | "readonly"
    | "disabled"
    | "step"
    | "value"
    | "input_value"
    | "change_value"
    | "keyup_value";
  beforePress?: "readonly" | "disabled" | "stale";
};
async function numberFixture(options: Options = {}) {
  const frame = document.createElement("iframe");
  frame.width = "800";
  frame.height = "600";
  frame.srcdoc = `<label>Quantity<input type="number" aria-label="Quantity" ${options.attributes ?? ""}></label><script>${inject("semanticMediaRuntime")}
    addEventListener("load", async () => {
      try {
        const api=globalThis.__zephiumSemanticRuntimeV1;
        const target=document.querySelector("input");
        const options=${JSON.stringify(options)};
        const events=[];
        for(const type of ["keydown","keyup","beforeinput","input","change"])
          target.addEventListener(type,e=>{
            events.push(type);document.documentElement.dataset.events=JSON.stringify(events);
            if(type==="keydown"){
              if(options.preventDefault)e.preventDefault();
              if(options.handledIncrement){e.preventDefault();target.value="18";}
              if(options.mutation==="type")target.type="text";
              if(options.mutation==="replace")target.replaceWith(target.cloneNode(true));
              if(options.mutation==="readonly")target.readOnly=true;
              if(options.mutation==="disabled")target.disabled=true;
              if(options.mutation==="step")target.step="2";
              if(options.mutation==="value")target.value="30";
            }
            if(((type==="input"&&options.mutation==="input_value")||(type==="change"&&options.mutation==="change_value")||(type==="keyup"&&options.mutation==="keyup_value"))&&events.includes("keydown"))target.value="30";
          });
        const b={n:128,t:16384,w:65536,x:4096,geo:true};
        let checkpoint=0;
        const observe=()=>JSON.parse(api.invoke(JSON.stringify({v:1,i:++checkpoint,g:checkpoint,s:{k:"initial"},b})));
        const action=async(kind,text=null)=>{
          const snapshot=observe();
          const node=snapshot.n.find(n=>n.r==="spinbutton");
          if(!node)throw new Error("missing spinbutton");
          const f={...(node.ak===undefined?{}:{a:node.ak}),r:16,o:node.o||0,q:node.q==="sensitive"?2:1,s:node.s||0,n:node.n??null,vk:node.v?.k==="text"?1:0,vt:node.v?.value??null,vo:0,vb:false};
          const request={v:1,o:"action_execute",a:checkpoint,i:checkpoint,g:checkpoint,t:node.k,r:node.r,k:kind,e:node.b,p:0,z:text,f,of:null,...(kind==="press"?{pk:options.key??"arrow_up"}:{})};
          if(kind==="press"&&options.beforePress==="stale")observe();
          return await (kind==="press"&&options.cdp?api.prepareCdpAction(JSON.stringify(request)):api.invoke(JSON.stringify(request)));
        };
        const fill=await action("fill",options.fill??"17");
        const before=target.value;
        events.length=0;
        if(options.beforePress==="readonly")target.readOnly=true;
        if(options.beforePress==="disabled")target.disabled=true;
        const press=await action("press");
        document.documentElement.dataset.trace=JSON.stringify({fill,press,before,after:document.querySelector("input").value,events});
      }catch(error){document.documentElement.dataset.error=String(error);}
    });</script>`;
  document.body.append(frame);
  await expect
    .poll(
      () =>
        frame.contentDocument?.documentElement.dataset.trace ??
        frame.contentDocument?.documentElement.dataset.error,
    )
    .toBeTruthy();
  const fixtureDocument = frame.contentDocument!;
  expect(fixtureDocument.documentElement.dataset.error).toBeUndefined();
  const trace = JSON.parse(fixtureDocument.documentElement.dataset.trace!) as Trace;
  return { frame, target: fixtureDocument.querySelector("input")!, trace };
}

test("number fill then semantic ArrowUp performs one default increment", async () => {
  const { frame, trace } = await numberFixture();
  try {
    expect(trace.fill.startsWith("{"), trace.fill).toBe(true);
    expect(trace.press.startsWith("{"), trace.press).toBe(true);
    expect(trace.before).toBe("17");
    expect(trace.after).toBe("18");
    expect(trace.events).toContain("input");
  } finally {
    frame.remove();
  }
});

test("cancelled number keydown prevents the default increment", async () => {
  const { frame, trace } = await numberFixture({ preventDefault: true });
  try {
    expect(trace.before).toBe("17");
    expect(trace.after).toBe("17");
    expect(trace.events).toEqual(["keydown", "keyup"]);
  } finally {
    frame.remove();
  }
});

test("real browser ArrowUp control increments the same synthetic number input", async () => {
  const { frame, target, trace } = await numberFixture();
  try {
    expect(trace.before).toBe("17");
    target.value = "17";
    target.focus();
    await userEvent.keyboard("{ArrowUp}");
    expect(target.value).toBe("18");
    const events = JSON.parse(frame.contentDocument!.documentElement.dataset.events!) as string[];
    expect([
      ["keydown", "input", "change", "keyup"],
      ["keydown", "beforeinput", "input", "change", "keyup"],
    ]).toContainEqual(events.slice(trace.events.length));
  } finally {
    frame.remove();
  }
});

test.each([
  { label: "decrement", options: { key: "arrow_down" }, value: "16" },
  { label: "empty", options: { fill: "" }, value: "1" },
  { label: "step alignment", options: { attributes: 'min="10" step="2"' }, value: "18" },
  { label: "maximum", options: { attributes: 'max="17"' }, value: "17" },
  { label: "minimum", options: { attributes: 'min="17"', key: "arrow_down" }, value: "17" },
] as const)("native number stepping preserves $label", async ({ options, value }) => {
  const { frame, trace } = await numberFixture(options);
  try {
    expect(trace.press.startsWith("{"), trace.press).toBe(true);
    expect(trace.after).toBe(value);
    expect(trace.events).toEqual(
      value === trace.before ? ["keydown", "keyup"] : ["keydown", "input", "change", "keyup"],
    );
  } finally {
    frame.remove();
  }
});

test.each([
  "type",
  "replace",
  "readonly",
  "disabled",
  "step",
  "value",
  "input_value",
  "change_value",
  "keyup_value",
] as const)("handler mutation %s cannot authorize a later numeric default", async (mutation) => {
  const { frame, trace } = await numberFixture({ mutation });
  try {
    expect(trace.press).toBe("E2:applied_unverified_postcondition");
    expect(trace.after).toBe(mutation === "value" || mutation.endsWith("_value") ? "30" : "17");
    expect(trace.events.filter((event) => event === "change")).toHaveLength(
      mutation === "change_value" || mutation === "keyup_value" ? 1 : 0,
    );
  } finally {
    frame.remove();
  }
});

test.each(["readonly", "disabled", "stale"] as const)(
  "pre-dispatch %s refuses stepping",
  async (beforePress) => {
    const { frame, trace } = await numberFixture({ beforePress });
    try {
      expect(trace.press).toBe(
        beforePress === "stale" ? "E2:target_changed" : "E2:target_disabled",
      );
      expect(trace.after).toBe("17");
      expect(trace.events).toEqual([]);
    } finally {
      frame.remove();
    }
  },
);

test("unhandled step any remains uncertain after dispatched key events", async () => {
  const { frame, trace } = await numberFixture({ attributes: 'step="any"' });
  try {
    expect(trace.press).toBe("E2:applied_unverified_postcondition");
    expect(trace.after).toBe("17");
    expect(trace.events).toEqual(["keydown", "keyup"]);
  } finally {
    frame.remove();
  }
});

test("step any preserves a cancelled keydown handled by the page", async () => {
  const { frame, trace } = await numberFixture({
    attributes: 'step="any"',
    handledIncrement: true,
  });
  try {
    expect(trace.press.startsWith("{"), trace.press).toBe(true);
    expect(trace.after).toBe("18");
    expect(trace.events).toEqual(["keydown", "keyup"]);
  } finally {
    frame.remove();
  }
});

test("CDP preparation delegates exactly one native key pair without a second fixed default", async () => {
  const { frame, target, trace } = await numberFixture({ cdp: true });
  try {
    expect(trace.before).toBe("17");
    expect(trace.after).toBe("17");
    expect(trace.events).toEqual([]);
    expect(trace.press.startsWith("P2:"), trace.press).toBe(true);
    const down = JSON.parse(trace.press.slice(3)) as {
      a: number;
      i: number;
      k: string;
      p: { type: string; key: string };
    };
    expect(down.k).toBe("key");
    expect(down.p).toMatchObject({ type: "keyDown", key: "ArrowUp" });
    const api = (
      frame.contentWindow as unknown as {
        __zephiumSemanticRuntimeV1: {
          nextCdpAction(attempt: number, index: number, abort: boolean): string | Promise<string>;
        };
      }
    ).__zephiumSemanticRuntimeV1;
    await userEvent.keyboard("{ArrowUp>}");
    expect(target.value).toBe("18");
    const up = await api.nextCdpAction(down.a, 1, false);
    expect(up.startsWith("P2:"), up).toBe(true);
    expect(JSON.parse(up.slice(3))).toMatchObject({
      k: "key",
      p: { type: "keyUp", key: "ArrowUp" },
    });
    await userEvent.keyboard("{/ArrowUp}");
    const result = await api.nextCdpAction(down.a, 2, false);
    expect(JSON.parse(result)).toMatchObject({ b: "engine_native_input" });
    expect(target.value).toBe("18");
  } finally {
    frame.remove();
  }
});
