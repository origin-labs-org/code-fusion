

import { CELL_STREAMS_BOOTSTRAP } from "./child-cell-streams.js";
import type { ChildPayload } from "./protocol.js";

export interface ChildVmModule {
  createContext(sandbox: object, options?: { name?: string }): object;
  runInContext(code: string, sandbox: object, options?: { filename?: string }): unknown;
}

export interface ChildReadlineInterface {
  on(event: "line", listener: (line: string) => void): unknown;
  close(): void;
}

export interface ChildMainDeps {
  vm: ChildVmModule;
  createInterface(options: { input: NodeJS.ReadableStream }): ChildReadlineInterface;
  
  stdin: NodeJS.ReadableStream;
  
  stdout: { write(chunk: string): unknown };
  
  payload: ChildPayload;
  
  streamsBootstrap: string;
}

export function childMain(deps: ChildMainDeps): Promise<void> {
  
  const BOOTSTRAP = String.raw`
"use strict";

var __nextLocal = 0;
var __nextReq = 0;
var __pending = new Map();
var __fills = new Map();

function __emit(obj) {
  __send(JSON.stringify(obj));
}

function __createActor(siteId, name, persona) {
  var localId = "local#" + (++__nextLocal);
  __emit({ kind: "create-actor", localId: localId, siteId: siteId, name: name, persona: persona });
  return localId;
}

function __ask(siteId, actor, instructions) {
  var id = "r" + (++__nextReq);
  return new Promise(function (resolve, reject) {
    __pending.set(id, { resolve: resolve, reject: reject });
    __emit({ kind: "request", id: id, type: "ask", siteId: siteId, actor: actor, instructions: instructions });
  });
}

function __worldRead(siteId, op, args) {
  var id = "r" + (++__nextReq);
  return new Promise(function (resolve, reject) {
    __pending.set(id, { resolve: resolve, reject: reject });
    __emit({ kind: "request", id: id, type: "world-read", siteId: siteId, op: op, args: args });
  });
}

function __evaluateFill(evaluate, code) {
  return Promise.resolve().then(function () {
    return evaluate(code)();
  });
}

function __hole(siteId, name, prompt, evaluate, body) {
  if (body !== undefined) {
    try {
      return Promise.resolve(body());
    } catch (e) {
      return Promise.reject(e);
    }
  }
  var remembered = __fills.get(siteId);
  if (remembered !== undefined) return __evaluateFill(evaluate, remembered);
  var id = "r" + (++__nextReq);
  return new Promise(function (resolve, reject) {
    __pending.set(id, { resolve: resolve, reject: reject });
    __emit({ kind: "request", id: id, type: "hole", siteId: siteId, name: name, prompt: prompt });
  }).then(function (answer) {
    __fills.set(siteId, answer.code);
    return __evaluateFill(evaluate, answer.code);
  });
}

function __log(message) {
  __emit({ kind: "event", type: "log", message: String(message) });
}

function __enterPhase(name) {
  __emit({ kind: "event", type: "phase-entered", name: String(name) });
}

function __publishArtifact(siteId, op, args) {
  var id = "r" + (++__nextReq);
  return new Promise(function (resolve, reject) {
    __pending.set(id, { resolve: resolve, reject: reject });
    __emit({ kind: "request", id: id, type: "publish-artifact", siteId: siteId, artifactOp: op, args: args });
  });
}

function __declareArtifact(siteId, op, args) {
  __emit({ kind: "event", type: "declare-artifact", siteId: siteId, op: op, args: args });
}

function __report(siteId, item, artifactId) {
  __emit({ kind: "event", type: "report", siteId: siteId, item: item, artifactId: artifactId });
}

var __args = Object.freeze(JSON.parse(__argsJson));

globalThis.__host = {
  args: __args,
  createActor: __createActor,
  ask: __ask,
  worldRead: __worldRead,
  publishArtifact: __publishArtifact,
  declareArtifact: __declareArtifact,
  report: __report,
  log: __log,
  enterPhase: __enterPhase,
  hole: __hole,
};

globalThis.__deliver = function (line) {
  var msg = JSON.parse(line);
  if (msg.kind !== "response") return;
  var waiter = __pending.get(msg.id);
  if (!waiter) return;
  __pending.delete(msg.id);
  if (msg.ok) {
    waiter.resolve(msg.value);
    return;
  }
  var e = msg.error || {};
  var err = new Error(e.message || "workflow host error");
  if (e.name) err.name = e.name;
  if (e.code !== undefined) err.code = e.code;
  if (e.violations !== undefined) err.violations = e.violations;
  if (e.finalText !== undefined) err.finalText = e.finalText;
  waiter.reject(err);
};

var __settled = false;

function __complete(ok, payload) {
  if (__settled) return;
  __settled = true;
  if (ok) {
    __emit({ kind: "complete", ok: true, value: payload });
    return;
  }
  var wire;
  if (payload instanceof Error) {
    wire = {
      name: payload.name,
      message: payload.message,
      stack: payload.stack,
      code: payload.code,
      violations: payload.violations,
      finalText: payload.finalText,
    };
  } else {
    wire = { name: "Error", message: String(payload) };
  }
  __emit({ kind: "complete", ok: false, error: wire });
}

globalThis.__execute = async function (runFn) {
  try {
    var value = await runFn(globalThis.__host);
    __complete(true, value);
  } catch (e) {
    __complete(false, e);
  }
};

var __NativeDate = Date;
class __WorkflowDate extends __NativeDate {
  constructor() {
    if (arguments.length === 0) throw new Error("argless new Date() is disabled in workflows");
    super(...arguments);
  }
  static now() {
    throw new Error("Date.now() is disabled in workflows");
  }
  static parse(value) {
    return __NativeDate.parse(value);
  }
  static UTC() {
    return __NativeDate.UTC.apply(__NativeDate, arguments);
  }
}
globalThis.Date = __WorkflowDate;
Math.random = function () {
  throw new Error("Math.random() is disabled in workflows");
};
`;

  const payload = deps.payload;

  const sandbox = {
    __argsJson: JSON.stringify(payload.args ?? {}),
  } as {
    __send: (line: string) => void;
    __argsJson: string;
    __deliver: (line: string) => void;
    __execute: (runFn: unknown) => Promise<void>;
    __checkStalled: () => boolean;
  };
  sandbox.__send = (line) => {
    deps.stdout.write(`${line}\n`);
  };
  deps.vm.createContext(sandbox, { name: "workflow-sandbox" });
  deps.vm.runInContext(BOOTSTRAP, sandbox, { filename: "workflow-bootstrap.js" });
  deps.vm.runInContext(deps.streamsBootstrap, sandbox, { filename: "workflow-streams.js" });

  let runFn: unknown;
  try {
    runFn = deps.vm.runInContext(`(async (__host) => {\n${payload.lowered}\n})`, sandbox, {
      filename: "workflow-script.js",
    });
  } catch (error) {
    const err = error as { name?: string; message?: string; stack?: string } | undefined;
    deps.stdout.write(
      `${JSON.stringify({
        kind: "complete",
        ok: false,
        error: {
          name: err?.name ?? "SyntaxError",
          message: err?.message ?? String(error),
          stack: err?.stack,
        },
      })}\n`,
    );
    return Promise.resolve();
  }

  const reader = deps.createInterface({ input: deps.stdin });
  reader.on("line", (line: string) => {
    if (!line.trim()) return;
    sandbox.__deliver(line);
    setImmediate(() => {
      if (sandbox.__checkStalled()) reader.close();
    });
  });

  const execution = sandbox.__execute(runFn).then(
    () => reader.close(),
    () => reader.close(),
  );
  setImmediate(() => {
    if (sandbox.__checkStalled()) reader.close();
  });
  return execution;
}

function safeRunId(runId: string): string {
  return runId.replace(/[^A-Za-z0-9._-]/g, "_");
}

export function renderChildEntry(payload: ChildPayload, meta: { runId: string }): string {
  const runId = safeRunId(meta.runId);
  return `// cf dynamic workflow run ${runId}
// Generated by @origin-ai/cf-dynamic-workflow-runtime before every launch; safe to delete once the run has settled.
import { realpathSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { setFlagsFromString } from "node:v8";
import vm from "node:vm";

export const payload = ${JSON.stringify(payload)};

export const streamsBootstrap = ${JSON.stringify(CELL_STREAMS_BOOTSTRAP)};

const main = ${childMain.toString()};

export const start = (deps) => main({ ...deps, payload, streamsBootstrap });

if (
  typeof payload.maxOldSpaceSizeMb === "number" &&
  Number.isFinite(payload.maxOldSpaceSizeMb) &&
  payload.maxOldSpaceSizeMb > 0 &&
  !process.execArgv.some((arg) => arg.startsWith("--max-old-space-size"))
) {
  try {
    setFlagsFromString("--max-old-space-size=" + Math.trunc(payload.maxOldSpaceSizeMb));
  } catch {
  }
}

let isProcessEntry = false;
try {
  isProcessEntry =
    process.argv[1] !== undefined &&
    realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
} catch {
  isProcessEntry = false;
}
if (isProcessEntry) {
  void start({ vm, createInterface, stdin: process.stdin, stdout: process.stdout });
}
`;
}
