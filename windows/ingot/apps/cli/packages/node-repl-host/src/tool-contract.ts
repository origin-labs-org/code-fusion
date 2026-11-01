export const NODE_REPL_DEFAULT_TIMEOUT_MS = 60_000;

export const NODE_REPL_SERVER_VERSION = "0.6.1";

export const NODE_REPL_SERVER_INSTRUCTIONS =
  "Browser Use and Computer Use only. Use `js` to run JavaScript in a fresh Node-backed kernel only when " +
  "the corresponding official skill instructs you to control a browser or computer. Do not use this server for unrelated tasks, " +
  "including general-purpose JavaScript, filesystem, shell, package inspection, or data processing. " +
  `Calls default to a ${NODE_REPL_DEFAULT_TIMEOUT_MS} ms timeout. ` +
  "Always provide `title` as a short user-facing description in the user's language. " +
  "Every `js` call starts fresh; reconstruct browser wrappers and recover persistent tabs from current BrowserControl facts.";

export const JS_TOOL_DESCRIPTION =
  "Browser Use and Computer Use only. Run JavaScript in a fresh Node-backed kernel with top-level await only as " +
  "instructed by the corresponding official skill to control a browser or computer. Do not use it as a general-purpose JavaScript runtime " +
  "or for filesystem, shell, package inspection, data processing, or other non-browser work. " +
  "Always provide the required `title` as a short " +
  "user-facing description in the user's language without implementation terms. If `timeout_ms` is omitted, execution times out " +
  `after ${NODE_REPL_DEFAULT_TIMEOUT_MS} ms. If the code may take more than 30000 ms including all awaited operations, you MUST set \`timeout_ms\` to at least the estimated total runtime plus 15000 ms; split the work into multiple calls if that exceeds the 120000 ms maximum. Use \`nodeRepl.cwd\`, \`nodeRepl.homeDir\`, \`nodeRepl.tmpDir\`, ` +
  "`nodeRepl.requestMeta`, `nodeRepl.setResponseMeta(meta)`, `nodeRepl.write(value)`, and " +
  "`await nodeRepl.emitImage(imageLike)`. Global bindings and module cache do not persist across calls. " +
  "For Computer Use SDK results, do not console.log/JSON.stringify the complete result or call " +
  "nodeRepl.emitImage yourself; the SDK submits the structured image/state result and you should " +
  "use nodeRepl.write for short text-only status. `get_app_state` is an explicit observation: " +
  "assign it to `const state`, always call `nodeRepl.write(state.text)`, and use " +
  "`state.state_id` plus `state.elements[*].index` for element targets; do not leave " +
  "get_app_state as the final expression or regex state_id from its text. " +
  "Metadata methods such as list_apps and list_windows may not return " +
  "action_sent; a missing field is not a failure, so inspect text or structuredContent. " +
  "Never use screenshot_display.bounds or app/window bounds as raster pixel coordinates; " +
  "x/y must be integer pixels inside the width/height of the returned raster. " +
  "Every Computer Use JavaScript call must start with the complete SDK bootstrap in the same cell " +
  "before agent.computerUse; never split bootstrap and action across calls. Never rely on agent, " +
  "runtime, browser, or imported bindings from an earlier call. " +
  "Import only `node:*` builtins and absolute `file://` URLs built from the official skill root, " +
  'for example `await import(pathToFileURL(join(root, "scripts", "client.mjs")).href)`; ' +
  "bare package specifiers do not resolve. Bootstrap the requested official capability in every call.";
