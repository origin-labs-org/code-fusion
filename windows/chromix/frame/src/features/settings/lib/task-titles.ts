import { commands } from "$shared/ipc/bindings";
import { observe } from "$shared/lib/observe";

const TIMEOUT = 6000;
const MAX_CACHED = 200;
const MAX_CONCURRENT = 3;
const MAX_CHARS = 80;

const known = new Map<string, string>();
const asking = new Map<string, Promise<string | null>>();
const waiting: Array<() => void> = [];
let active = 0;

/** At most a few reads at once: the history may list dozens of tasks. */
async function turn<T>(read: () => Promise<T>): Promise<T> {
  // A finished read hands its place straight to the next in line.
  if (active >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve));
  else active += 1;
  try {
    return await read();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active -= 1;
  }
}

function cut(text: string): string | null {
  const line = text.replace(/\s+/gu, " ").trim();
  if (!line) return null;
  return line.length > MAX_CHARS ? `${line.slice(0, MAX_CHARS - 1).trimEnd()}…` : line;
}

async function read(profile: string, work: string): Promise<string | null> {
  try {
    const response = await observe(
      Promise.resolve().then(() =>
        commands.workCall(profile, {
          kind: "query",
          request: { version: 1, query: { kind: "projection", work } },
        }),
      ),
      TIMEOUT,
    );
    if (response.state !== "received" || response.value.profile !== profile) return null;
    const reply = response.value.reply;
    if (reply.kind !== "projection") return null;
    const named = [...reply.projection.executions]
      .reverse()
      .map((execution) => cut(execution.title ?? ""))
      .find(Boolean);
    return named ?? cut(reply.projection.work.objective);
  } catch {
    return null;
  }
}

/**
 * The name of a Work task, read from this computer's own store: the title its
 * finish gave it, else what was asked. Null when it is gone. The service never
 * sees a task, so this is the only place a call becomes a name.
 */
export function taskTitle(profile: string, work: string): Promise<string | null> {
  const key = `${profile}:${work}`;
  const kept = known.get(key);
  if (kept !== undefined) return Promise.resolve(kept);
  const inflight = asking.get(key);
  if (inflight) return inflight;
  const request = turn(() => read(profile, work)).then((title) => {
    asking.delete(key);
    // A failed read may be a timeout: only a name is kept.
    if (title !== null) {
      if (known.size >= MAX_CACHED) known.delete(known.keys().next().value!);
      known.set(key, title);
    }
    return title;
  });
  asking.set(key, request);
  return request;
}
