import { expect, inject, test } from "vitest";

declare module "vitest" {
  export interface ProvidedContext {
    humanWallSurvey: string;
  }
}

const content =
  "<h1>Your workspace</h1><p>Here are the recent messages from your project team.</p>";
const links =
  "<main><a href='/a'>First account</a><a href='/b'>Second account</a><a href='/c'>Third account</a></main>";

async function survey(html: string): Promise<boolean> {
  const frame = document.createElement("iframe");
  frame.width = "640";
  frame.height = "480";
  const loaded = new Promise<void>((resolve) =>
    frame.addEventListener("load", () => resolve(), { once: true }),
  );
  frame.srcdoc = `${html}<script>document.addEventListener("DOMContentLoaded", () => { const result = ${inject("humanWallSurvey")}\ndocument.documentElement.dataset.wallClear = String(result); });</script>`;
  document.body.append(frame);
  try {
    await loaded;
    const result = frame.contentDocument?.documentElement.dataset.wallClear;
    expect(Array.from({ length: 24 }, (_, code) => String(code))).toContain(result);
    return result === "0";
  } finally {
    frame.remove();
  }
}

test("a loaded shell, credential field, chooser or check cannot prove wall clearance", async () => {
  for (const html of [
    "<main><div role='progressbar'>Loading</div></main>",
    `${content}<input type='password' value='never-return-this-secret'>`,
    `${content}<input autocomplete='one-time-code'>`,
    "<h1>Find your workspace</h1><input placeholder='Workspace URL'><button>Continue</button>",
    `<h1>Choose an account</h1>${links}`,
    `<h1>Select your workspace</h1>${links}`,
    `<h1>Verify you are human</h1>${links}`,
    `<main aria-label="Sign in"><input type="email"><button>Continue</button>${links}</main>`,
    `<main aria-label="Choose an account">${links}</main>`,
    `<main><input autocomplete="username"><button>Continue</button>${links}</main>`,
    `<main><h1>Connectez-vous</h1><p>Identifiez-vous avec votre adresse professionnelle pour continuer.</p><form><input type="email"><button>Continuer</button></form></main>`,
    `${content}<iframe title='hCaptcha challenge' width='300'></iframe>`,
  ])
    expect(await survey(html), html).toBe(false);
});

test("visible app content clears a wall, while optional sign-in and hidden controls do not block it", async () => {
  expect(await survey(content)).toBe(true);
  expect(await survey(`${content}<button>Sign in</button>`)).toBe(true);
  expect(await survey(`${content}<input type='password' hidden>`)).toBe(true);
  expect(
    await survey(`${content}<form><input type="email"><button>Subscribe</button></form>`),
  ).toBe(true);
});

test("an accessible inbox can resume without paragraphs or native anchor links", async () => {
  const inbox = `<section role="main"><h2>Inbox</h2><div role="grid">
    <div role="row"><span role="link">Project update from the engineering team</span></div>
    <div role="row"><span role="link">Meeting notes for next week's review</span></div>
    <div role="row"><span role="link">Your saved research draft is available</span></div>
  </div></section>`;
  expect(await survey(inbox)).toBe(true);
  expect(
    await survey(`${inbox}<aside><div role="progressbar">Loading a preview</div></aside>`),
  ).toBe(true);
  expect(
    await survey(
      '<main><div role="grid"><div role="row"></div><div role="row"></div></div></main>',
    ),
  ).toBe(false);
});

test("email and MFA transitions remain walls before or without editable controls", async () => {
  for (const html of [
    "<main><h1>Check your email</h1><p>We sent a sign-in link. Open your email to continue.</p></main>",
    "<main><h1>Enter your confirmation code</h1><p>Use the six-digit code from your email.</p><input inputmode='numeric' name='confirmation_code'><button>Continue</button></main>",
    "<main><h1>Approve sign-in on your phone</h1><p>Open your authenticator to continue.</p><a href='/help'>Help</a><a href='/terms'>Terms</a><a href='/privacy'>Privacy</a></main>",
    "<main><h1>Sign in</h1><p>Your sign-in form is loading.</p></main><footer><a href='/help'>Help</a><a href='/terms'>Terms</a><a href='/privacy'>Privacy</a></footer>",
    "<main><div role='progressbar'>Loading</div></main><footer><a href='/help'>Help</a><a href='/terms'>Terms</a><a href='/privacy'>Privacy</a></footer>",
  ])
    expect(await survey(html), html).toBe(false);
});

test("a verification screen clears only after it is replaced by account content", async () => {
  const waiting =
    "<main><h1>Enter the code from your email</h1><p>Use the message we sent to finish signing in.</p><div role='textbox' aria-label='Confirmation code' contenteditable='true'></div></main>";
  expect(await survey(waiting)).toBe(false);
  expect(await survey(content)).toBe(true);
});

test("unlabelled segmented verification controls and lower-level headings remain held", async () => {
  for (const html of [
    `<main><h4>Check your email</h4><p>Use the code we sent to continue.</p>${"<input type='text' maxlength='1' inputmode='numeric'>".repeat(6)}</main>`,
    `<main><h1>Continue to your workspace</h1><p>Complete the next step to open your account.</p><input type='text' name='code'><button>Continue</button></main>`,
    `<main><h5>Check your inbox</h5><p>Follow the link to continue to your workspace.</p></main>`,
  ])
    expect(await survey(html), html).toBe(false);
});

test("native HTML inbox items are account content without ARIA row attributes", async () => {
  const items =
    "<main><h1>Inbox</h1><ul><li>Prepare the release checklist</li><li>Review the project proposal</li><li>Read the integration notes</li></ul></main>";
  expect(await survey(items)).toBe(true);
  expect(
    await survey(
      `${items}<div role='dialog'><h2>Continue</h2><input name='code'><button>Continue</button></div>`,
    ),
  ).toBe(false);
});

test("native table rows can establish loaded inbox content", async () => {
  expect(
    await survey(
      "<main><h1>Inbox</h1><table><tbody><tr><td>Review the project proposal</td></tr><tr><td>Confirm the planning meeting</td></tr><tr><td>Read the engineering report</td></tr></tbody></table></main>",
    ),
  ).toBe(true);
});

test("an inbox of sibling card buttons clears without main or list landmarks", async () => {
  const cards =
    "<div aria-label='Main Content'><h1>Inbox</h1><div><button>Task: Prepare the project checklist</button><button>Task: Review the integration notes</button><button>Task: Read the planning report</button></div></div>";
  expect(await survey(cards)).toBe(true);
  const wrapped =
    "<div><h1>Inbox</h1><section>" +
    ["Prepare the project checklist", "Review the integration notes", "Read the planning report"]
      .map((label) => `<div><div><div><button>Task: ${label}</button></div></div></div>`)
      .join("") +
    "</section></div>";
  expect(await survey(wrapped)).toBe(true);
  expect(
    await survey(
      `${cards}<div role='dialog'><h2>Continue</h2><input name='code'><button>Continue</button></div>`,
    ),
  ).toBe(false);
  expect(
    await survey(
      "<h1>Welcome</h1><div><button>Continue with Google</button><button>Continue with Microsoft</button><button>Continue with Apple</button></div>",
    ),
  ).toBe(false);
  expect(
    await survey(
      "<h1>Welcome</h1><footer><button>Accessibility settings</button><button>Privacy preferences</button><button>Support information</button></footer>",
    ),
  ).toBe(false);
});

test("conversation search is not an identity entry field", async () => {
  for (const field of [
    "<input type='search' aria-label='Channel or user name'>",
    "<input role='searchbox' aria-label='Workspace search'>",
  ])
    expect(await survey(`${content}${field}`)).toBe(true);
  expect(await survey(`${content}<input type='text' aria-label='User name'>`)).toBe(false);
  for (const field of [
    "<input role='searchbox' type='email'>",
    "<input role='searchbox' type='password'>",
    "<input role='searchbox' autocomplete='one-time-code'>",
    "<form><input type='search' aria-label='User name'></form>",
  ])
    expect(await survey(`${content}${field}`)).toBe(false);
});

test("a multiline composer beside loaded conversation content can resume", async () => {
  const conversation =
    "<div><h1>Project channel</h1><div role='list'><div>Welcome to the project channel and its recent discussion.</div><button>Start from a template</button><button>Review channel details</button><button>Browse conversation history</button></div><div role='textbox' aria-multiline='true' contenteditable='true' aria-label='Message to project channel'></div></div>";
  expect(await survey(conversation)).toBe(true);
  for (const wall of [
    "<input type='password'>",
    "<input type='email'>",
    "<input autocomplete='one-time-code'>",
    "<div role='dialog'><h2>Continue</h2><input name='code'></div>",
  ])
    expect(await survey(conversation + wall)).toBe(false);
  expect(
    await survey(
      "<h1>Continue</h1><p>Enter the requested code to continue to your account.</p><textarea></textarea>",
    ),
  ).toBe(false);
  expect(
    await survey(
      "<h1>Continue</h1><form><div role='list'><button>Continue with Google</button><button>Continue with Microsoft</button><button>Continue with Apple</button></div><textarea></textarea></form>",
    ),
  ).toBe(false);
});

test("rich editor descendants remain one editable host and never become page content", async () => {
  const conversation =
    "<div><h1>Project channel</h1><div role='list'><div>Welcome to the project channel and its recent discussion.</div><button>Start from a template</button><button>Review channel details</button><button>Browse conversation history</button></div><div role='textbox' aria-multiline='true' contenteditable='true' aria-label='Message to project channel'><p><br></p></div></div>";
  expect(await survey(conversation)).toBe(true);
  expect(
    await survey(
      conversation.replace(
        "<p><br></p>",
        "<h2>Sign in to your account</h2><p>Draft text stays inside the editor.</p>",
      ),
    ),
  ).toBe(true);
  expect(
    await survey(
      conversation.replace(
        "<p><br></p>",
        "<span contenteditable='false'><h2>Sign in to your account</h2></span>",
      ),
    ),
  ).toBe(true);
  for (const control of [
    "<input type='password'>",
    "<input autocomplete='one-time-code'>",
    "<iframe title='hCaptcha challenge' width='300'></iframe>",
  ]) {
    expect(await survey(conversation.replace("<p><br></p>", control))).toBe(false);
  }
});

test("a short accessible list name does not hide its populated conversation", async () => {
  const conversation =
    "<div><h1>Project channel</h1><div role='list' aria-label='Project channel'><div>Welcome to the project channel and its recent discussion.</div><button>Start from a template</button><button>Review channel details</button><button>Browse conversation history</button></div><div role='textbox' aria-multiline='true' contenteditable='true' aria-label='Message to project channel'></div></div>";
  expect(await survey(conversation)).toBe(true);
  expect(
    await survey(
      conversation.replace(
        "<div>Welcome to the project channel and its recent discussion.</div><button>Start from a template</button><button>Review channel details</button><button>Browse conversation history</button>",
        "<div></div>",
      ),
    ),
  ).toBe(false);
});

test("non-text input controls do not impersonate credential entry", async () => {
  for (const type of ["range", "checkbox", "radio", "button", "submit", "reset", "image"]) {
    expect(
      await survey(`${content}<input type='${type}' aria-label='Sidebar control'>`),
      type,
    ).toBe(true);
  }
  for (const type of ["text", "number", "tel", "email", "password", "file", "date"]) {
    expect(await survey(`${content}<input type='${type}' aria-label='Required entry'>`), type).toBe(
      false,
    );
  }
});

test("nested conversation logs and feeds supply visible content without shallow text scanning", async () => {
  for (const role of ["list", "log", "feed"]) {
    const nested =
      "<div>".repeat(40) +
      "<p>A source-backed message is visible in this conversation.</p>" +
      "</div>".repeat(40);
    const page = `<div><h1>Project channel</h1><div role='${role}' aria-label='Project'>${nested}</div><div><button>Review channel details</button><button>Browse conversation history</button><button>Open message settings</button></div><div role='textbox' aria-multiline='true' contenteditable='true'><p><br></p></div></div>`;
    expect(await survey(page), role).toBe(true);
    expect(await survey(page.replace(nested, "<div></div>")), role).toBe(false);
    expect(await survey(page + "<input autocomplete='one-time-code'>"), role).toBe(false);
  }
});

test("visible external ARIA-owned conversation content needs unique bounded acyclic references", async () => {
  const controls =
    "<h1>Project channel</h1><div><button>Review channel details</button><button>Browse conversation history</button><button>Open message settings</button></div><div role='textbox' aria-multiline='true' contenteditable='true'><p><br></p></div>";
  const owner =
    "<div id='history' role='list' aria-label='Project' aria-owns='message' style='min-height:20px'></div>";
  const message =
    "<div id='message'><p>A visible source-backed conversation message is here.</p></div>";
  expect(await survey(controls + owner + message)).toBe(true);
  expect(
    await survey(
      controls +
        owner.replace("'message'", "'group'") +
        "<div id='group' aria-owns='message' style='min-height:20px'></div>" +
        message,
    ),
  ).toBe(true);
  for (const changed of [
    owner,
    owner + message + "<div id='message'></div>",
    owner + message.replace("id='message'", "id='message' hidden"),
    owner + `<div style='opacity:0'>${message}</div>`,
    owner.replace("aria-owns='message'", "aria-owns='history'") + message,
    owner + "<div id='message' aria-owns='history' style='min-height:20px'></div>",
    owner +
      "<div id='message' aria-owns='history' style='min-height:20px'><p>Visible content cannot validate a cyclic owner.</p></div>",
    owner + "<iframe srcdoc=\"<p id='message'>Content in another document</p>\"></iframe>",
    "<div id='message'>" + owner + "<p>Visible text cannot break an ownership cycle.</p></div>",
    owner + message + "<input autocomplete='one-time-code'>",
    owner + message + "<input type='password'>",
  ])
    expect(await survey(controls + changed)).toBe(false);
  expect(
    await survey(
      controls +
        owner.replace(
          "aria-owns='message'",
          `aria-owns='${Array.from({ length: 33 }, (_, i) => "id" + i).join(" ")}'`,
        ) +
        message,
    ),
  ).toBe(false);
  expect(
    await survey(
      controls +
        owner +
        message +
        Array.from({ length: 8193 }, (_, i) => `<div id='extra${i}'></div>`).join(""),
    ),
  ).toBe(false);
  const deep = Array.from(
    { length: 18 },
    (_, i) =>
      `<div id='chain${i}' aria-owns='${i === 17 ? "message" : "chain" + (i + 1)}' style='min-height:20px'></div>`,
  ).join("");
  expect(await survey(controls + owner.replace("'message'", "'chain0'") + deep + message)).toBe(
    false,
  );
});

test("an exhausted visibility ancestry check cannot clear a wall", async () => {
  expect(
    await survey(content + "<div>".repeat(66) + "<input type='password'>" + "</div>".repeat(66)),
  ).toBe(false);
});

test("a Fastmail-like inbox uses populated message cards rather than site-specific markup", async () => {
  const messages = [
    ["Avery", "Quarterly planning notes are ready"],
    ["Morgan", "Updated schedule for the design review"],
    ["Casey", "Research questions for the next meeting"],
  ]
    .map(
      ([sender, subject]) =>
        `<div><button><span>${sender}</span><span>${subject}</span></button></div>`,
    )
    .join("");
  const inbox = (items: string) => `<main aria-label="Mail">
    <h1>Inbox</h1><form role="search"><input type="search" aria-label="Search mail"></form>
    <section aria-label="Messages">${items}</section>
  </main>`;
  expect(await survey(inbox(messages))).toBe(true);
  expect(await survey(inbox("<div><button>Open</button></div>".repeat(3)))).toBe(false);
  expect(await survey(inbox(`<div style="opacity:0">${messages}</div>`))).toBe(false);
  expect(
    await survey(
      inbox(messages) +
        '<dialog open aria-modal="true"><h2>Enter your verification code</h2><input autocomplete="one-time-code"></dialog>',
    ),
  ).toBe(false);
});

test("a Discord-like conversation resolves deeply nested log and feed messages", async () => {
  const message =
    "<div>".repeat(40) +
    '<article><div role="listitem"><span>Jordan shared the release checklist with the room.</span></div></article>' +
    "</div>".repeat(40);
  for (const role of ["log", "feed"]) {
    const conversation = (history: string) => `<section role="main">
      <h1>Release room</h1><div role="${role}" aria-label="Messages" aria-live="polite">${history}</div>
      <div role="toolbar"><button>Browse pinned messages</button><button>Show room participants</button><button>Manage notifications</button></div>
      <div role="textbox" aria-label="Message the room" aria-multiline="true" contenteditable="true"><p><br></p></div>
      <aside><div role="status">Loading older messages</div></aside>
    </section>`;
    expect(await survey(conversation(message)), role).toBe(true);
    expect(await survey(conversation("<div></div>")), role).toBe(false);
    expect(await survey(conversation(`<div hidden>${message}</div>`)), role).toBe(false);
    expect(await survey(conversation(message) + '<input type="password">'), role).toBe(false);
  }
});

test("a Discord-like portal history requires valid external ARIA ownership", async () => {
  const shell = `<main><h1>Planning room</h1>
    <div id="chat-history" role="log" aria-label="Messages" aria-live="polite" aria-owns="portal-post" style="min-height:20px"></div>
    <div role="toolbar"><button>Browse pinned messages</button><button>Show room participants</button><button>Manage notifications</button></div>
    <div role="textbox" aria-label="Message the room" aria-multiline="true" contenteditable="true"><p><br></p></div>
  </main>`;
  const post =
    '<section id="portal-post"><article><div role="listitem"><span>Sam shared the agenda for the planning meeting.</span></div></article></section>';
  expect(await survey(shell + post)).toBe(true);
  expect(
    await survey(
      shell.replace('aria-owns="portal-post"', 'aria-owns="portal-group"') +
        '<section id="portal-group" aria-owns="portal-post" style="min-height:20px"></section>' +
        post,
    ),
  ).toBe(true);
  for (const page of [
    shell,
    shell.replace('aria-owns="portal-post"', "") + post,
    shell + post + '<div id="portal-post"></div>',
    shell + `<section aria-hidden="true">${post}</section>`,
    shell + post.replace('id="portal-post"', 'id="portal-post" aria-owns="chat-history"'),
    shell + post + '<input autocomplete="one-time-code">',
  ])
    expect(await survey(page)).toBe(false);
});
