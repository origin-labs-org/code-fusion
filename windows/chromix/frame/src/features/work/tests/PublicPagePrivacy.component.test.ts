import { expect, inject, test } from "vitest";

type Proof = {
  v: number;
  r: number;
  c: boolean;
  a?: boolean;
  w: number;
  h: number;
  x: number;
  y: number;
};

/** Fixed programs, synthetic document/URL only. Native store/owner authority is
 * tested separately; an account-negative DOM result never grants images. */
async function inspect(body: string, url = "https://public.test/"): Promise<[Proof, Proof, Proof]> {
  const frame = document.createElement("iframe");
  frame.width = "800";
  frame.height = "600";
  const loaded = new Promise<void>((done) =>
    frame.addEventListener("load", () => done(), { once: true }),
  );
  frame.srcdoc = `<style>body{margin:0}input{width:40px;height:30px}</style>${body}<script>
    (function(location){${inject("pixelPrivacyRuntime")}})(Object.freeze({href:${JSON.stringify(url)}}));
    ${inject("semanticMediaRuntime")}
    addEventListener("load",()=>{
      const api=globalThis.__zephiumSemanticRuntimeV1;
      const before=JSON.parse(api.invoke("P1:privacy"));
      const publicProof=JSON.parse(api.invoke("P1:public"));
      const after=JSON.parse(api.invoke("P1:privacy"));
      document.documentElement.dataset.proofs=JSON.stringify([before,publicProof,after]);
    });</script>`;
  document.body.append(frame);
  try {
    await loaded;
    const [before, result, after] = JSON.parse(
      frame.contentDocument!.documentElement.dataset.proofs!,
    ) as [Proof, Proof, Proof];
    expect(after).toEqual(before);
    expect(result.c).toBe(before.c);
    expect(Object.keys(before).sort()).toEqual(["c", "h", "r", "v", "w", "x", "y"]);
    expect(Object.keys(result).sort()).toEqual(["a", "c", "h", "r", "v", "w", "x", "y"]);
    return [before, result, after];
  } finally {
    frame.remove();
  }
}

test("public content and a footer sign-in link keep the extra negative survey separate", async () => {
  for (const body of [
    "<main><h1>Public listing</h1><p>A cabin in the hills.</p></main>",
    '<main><h1>Public chart</h1><p>Yearly rainfall</p></main><footer><a href="/login">Sign in</a></footer>',
  ]) {
    const [privacy, extra] = await inspect(body);
    expect(privacy.c).toBe(true);
    expect(extra.a).toBe(true);
  }
});

test("generic code, segmented fields and editable code widgets are never public", async () => {
  for (const [index, body] of [
    '<main><h1>Continue to your workspace</h1><p>Complete next step to open your account.</p><input name="code"><button>Continue</button></main>',
    `<main><h1>Continue</h1>${'<input maxlength="1" inputmode="numeric">'.repeat(6)}</main>`,
    '<main><div contenteditable="true" aria-label="Code" style="width:100px;height:30px"></div></main>',
    '<main><div contenteditable="true" name="otp" style="width:100px;height:30px"></div></main>',
    '<main><h1>Find your workspace</h1><input placeholder="Workspace URL"></main>',
    '<main><input type="email"></main>',
  ].entries()) {
    const [privacy, extra] = await inspect(body);
    expect(extra.a).toBe(false);
    if (index < 4) expect(privacy.c).toBe(false);
  }
});

test("email, MFA and loading states remain non-public without credential values", async () => {
  for (const body of [
    "<main><h1>Check your email</h1><p>We sent a sign-in link. Open your email to continue.</p></main>",
    "<main><p><span>Check </span><span> your </span><span> email</span></p></main>",
    "<main><p><span>Approve </span><span> the </span><span> request</span></p><p>on your device</p></main>",
    "<main><p><span>Check </span><span>your </span><span> phone</span></p></main>",
    "<main><p>Waiting for a push notification</p></main>",
    "<main><p>Use your authenticator</p></main>",
    "<main><h1>Loading</h1></main>",
    '<main aria-busy="true"><h1>Welcome</h1></main>',
    '<div role="progressbar" style="width:100px;height:30px"></div>',
    "<main><button>Your account</button></main>",
    '<main><a href="/logout">Sign out</a></main>',
  ])
    expect((await inspect(body))[1].a).toBe(false);
});

test("auth URLs and existing privacy refusals cannot become a public proof", async () => {
  for (const url of ["https://public.test/account", "https://public.test/?code=synthetic"]) {
    expect((await inspect("<main><h1>Welcome</h1></main>", url))[1].a).toBe(false);
  }
  for (const body of [
    '<input type="password" value="synthetic">',
    "<main><span>-----BEGIN </span><span>PRIVATE KEY-----</span></main>",
    "<iframe></iframe>",
  ]) {
    const [privacy, extra] = await inspect(body);
    expect(privacy.c).toBe(false);
    expect(extra.a).toBe(false);
  }
});
