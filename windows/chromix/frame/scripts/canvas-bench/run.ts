/* eslint-disable no-console -- a measuring tool prints its readings. */
// The Work canvas at scale on the system WebKit, production build:
//   node scripts/canvas-bench/run.ts [--items=50,200,500] [--zoom=1,0.35] [--mix=mixed]
//     [--css='…'] [--no-build]
// Builds scripts/canvas-bench, serves it, opens it in a WKWebView window (the
// work-memory host) and, for each case, prints open cost, frames while panning
// and pinching, what stays drawn, what wakes at rest, and the WebContent and
// GPU processes' footprint after opening, after a sweep over everything and
// back and at rest, with the CPU the page, GPU, host and WindowServer
// processes spend while it pans and pinches. The window must stay visible:
// WebKit throttles an occluded page.
import { execFile, execFileSync, spawn } from "node:child_process";
import { connect } from "node:net";
import { fileURLToPath } from "node:url";
import { ensurePhotos } from "./photos.ts";

const frame = fileURLToPath(new URL("../..", import.meta.url));
const config = "scripts/canvas-bench/vite.config.ts";
const port = Number(process.env.CANVAS_BENCH_PORT ?? 4721);
const vite = fileURLToPath(new URL("../../node_modules/vite/bin/vite.js", import.meta.url));
const arg = (name: string, fallback: string) =>
  process.argv.find((one) => one.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const list = (name: string, fallback: string) => arg(name, fallback).split(",").map(Number);

if (!process.argv.includes("--no-build"))
  execFileSync(process.execPath, [vite, "build", "--config", config], {
    cwd: frame,
    stdio: "ignore",
  });
// Every photo the largest case shows: two in six items, and the run objects' pictures.
ensurePhotos(
  fileURLToPath(new URL("../../node_modules/.canvas-bench/photos", import.meta.url)),
  Math.max(...list("items", "50,200,500")) * 2,
);

// A server left on the port by an interrupted run would answer with its old config.
const taken = await new Promise<boolean>((done) => {
  const probe = connect(port, "localhost", () => {
    probe.destroy();
    done(true);
  });
  probe.on("error", () => done(false));
});
if (taken) throw new Error(`port ${port} is already served; stop that server first`);
const server = spawn(process.execPath, [vite, "preview", "--config", config], {
  cwd: frame,
  stdio: "ignore",
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    server.kill();
    process.exit(1);
  });

type Reply = Record<string, unknown>;
function nativeHost() {
  const binary = fileURLToPath(new URL("../../node_modules/.canvas-bench/host", import.meta.url));
  const source = fileURLToPath(new URL("../work-memory/host/main.swift", import.meta.url));
  execFileSync("swiftc", ["-O", source, "-o", binary], { stdio: "ignore" });
  const child = spawn(binary, [], { stdio: ["pipe", "pipe", "inherit"] });
  const waiting: ((reply: Reply) => void)[] = [];
  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    for (let cut = buffer.indexOf("\n"); cut >= 0; cut = buffer.indexOf("\n")) {
      const line = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 1);
      waiting.shift()?.(JSON.parse(line) as Reply);
    }
  });
  let queue: Promise<unknown> = new Promise((done) => waiting.push(done));
  const send = (command: string) => {
    const reply = queue.then(
      () =>
        new Promise<Reply>((done) => {
          waiting.push(done);
          child.stdin.write(`${command}\n`);
        }),
    );
    queue = reply.catch(() => {});
    return reply;
  };
  return {
    started: Date.now(),
    load: (url: string) => send(`load ${url}`),
    async evaluate<T>(body: string): Promise<T> {
      const reply = await send(`eval ${body.replaceAll("\n", " ")}`);
      if ("error" in reply) throw new Error(String(reply.error));
      return reply.ok as T;
    },
    pid: async () => Number((await send("pid")).pid),
    shot: (path: string) => send(`shot ${path}`),
    process: child.pid ?? 0,
    close: () => child.kill(),
  };
}

/** The highest page plus GPU footprint seen, sampled every 250 ms until stopped. */
function peak(pids: number[]) {
  let highest = 0;
  let going = true;
  const one = (pid: number) =>
    new Promise<number>((done) =>
      execFile("footprint", ["-f", "bytes", String(pid)], (error, out) =>
        done(error ? 0 : Number(/phys_footprint:\s+(\d+)/u.exec(out)?.[1] ?? 0) / 1048576),
      ),
    );
  const loop = (async () => {
    while (going) {
      const sizes = await Promise.all(pids.map(one));
      highest = Math.max(highest, Math.round(sizes.reduce((sum, size) => sum + size, 0)));
      await new Promise((done) => setTimeout(done, 250));
    }
  })();
  return async () => {
    going = false;
    await loop;
    return highest;
  };
}
const footprintMB = (pid: number) => {
  const out = execFileSync("footprint", ["-f", "bytes", String(pid)]).toString();
  return Math.round(Number(/phys_footprint:\s+(\d+)/u.exec(out)?.[1] ?? 0) / 1048576);
};
/** The host's GPU process: the system WebKit's, started after the host was. */
function gpuPid(since: number): number | null {
  const rows = execFileSync("ps", ["-axww", "-o", "pid=,lstart=,command="]).toString().split("\n");
  for (const line of rows) {
    const match = /^\s*(\d+)\s+(\w{3} \w{3}\s+\d+ [\d:]+ \d{4})\s+(.*)$/u.exec(line);
    if (
      match &&
      /com\.apple\.WebKit\.GPU/u.test(match[3]!) &&
      Date.parse(match[2]!) >= since - 1000
    )
      return Number(match[1]);
  }
  return null;
}

const seconds = (pid: number) => {
  try {
    const time = execFileSync("ps", ["-o", "time=", "-p", String(pid)])
      .toString()
      .trim();
    return time.split(":").reduce((sum, part) => sum * 60 + Number(part), 0);
  } catch {
    return 0;
  }
};
/** CPU each process spends from now until the returned function is called, in ms. */
function cpu(pids: Record<string, number | null>) {
  const start = Object.entries(pids).map(
    ([name, pid]) => [name, pid, pid ? seconds(pid) : 0] as const,
  );
  return () =>
    Object.fromEntries(
      start.map(([name, pid, from]) => [
        name,
        pid ? Math.round((seconds(pid) - from) * 1000) : null,
      ]),
    );
}
const windowServer = Number(
  execFileSync("pgrep", ["-x", "WindowServer"]).toString().trim().split("\n")[0],
);

const host = nativeHost();
try {
  for (let tries = 0; ; tries++) {
    const reply = await host.load(`http://localhost:${port}/`);
    if (String(reply.loaded ?? "").startsWith("http")) {
      const ready = await host.evaluate<boolean>("return 'bench' in window;").catch(() => false);
      if (ready) break;
    }
    if (tries > 50) throw new Error("the bench page did not load");
    await new Promise((done) => setTimeout(done, 300));
  }
  const content = await host.pid();
  const memory = () => {
    const gpu = gpuPid(host.started);
    return { content: footprintMB(content), gpu: gpu ? footprintMB(gpu) : null };
  };
  const mix = arg("mix", "mixed");
  const css = arg("css", "");
  for (const items of list("items", "50,200,500"))
    for (const zoom of list("zoom", "1,0.35")) {
      await host.load(`http://localhost:${port}/`);
      await new Promise((done) => setTimeout(done, 1500));
      const before = memory();
      const open = await host.evaluate(
        `return await window.bench.open(${JSON.stringify({ items, zoom, mix })});`,
      );
      const opened = memory();
      if (process.env.CANVAS_BENCH_PROBE)
        console.log(JSON.stringify(await host.evaluate(process.env.CANVAS_BENCH_PROBE)));
      const idle = await host.evaluate("return await window.bench.idle();");
      if (css) await host.evaluate(`window.bench.css(${JSON.stringify(css)}); return true;`);
      const gpu = gpuPid(host.started);
      const busy = cpu({ content, gpu, ui: host.process, windowServer });
      const peaking = peak(gpu ? [content, gpu] : [content]);
      const pan = await host.evaluate("return await window.bench.pan();");
      const panCpu = busy();
      // While the person is at the canvas: its layers are held.
      const moving = memory();
      const pinchBusy = cpu({ content, gpu, ui: host.process, windowServer });
      const pinch = await host.evaluate("return await window.bench.pinch();");
      const pinchCpu = pinchBusy();
      const movingPeak = await peaking();
      // Once motion has stopped for a moment: what the canvas keeps between gestures.
      await new Promise((done) => setTimeout(done, 2500));
      const settled = memory();
      // --shots=<dir>: this window as the compositor drew it once a pinch to 100% has settled.
      const shots = arg("shots", "");
      if (shots) {
        const reached = await host.evaluate("return await window.bench.zoomTo(1);");
        await new Promise((done) => setTimeout(done, 2000));
        await host.shot(`${shots}/pinched-${items}-${zoom}-${css ? "css" : "base"}.png`);
        console.log(JSON.stringify({ reached }));
      }
      await host.evaluate("window.bench.css(''); return true;");
      const lift = await host.evaluate("return await window.bench.lift();");
      const swept = await host.evaluate("return await window.bench.sweep();");
      const sweptMemory = memory();
      const back = await host.evaluate("return await window.bench.back();");
      const backMemory = memory();
      // Past the canvas layer's hold (layers.ts), when an idle canvas gives its layer back.
      await new Promise((done) => setTimeout(done, 14_000));
      const restMemory = memory();
      await host.evaluate("window.bench.close(); return true;");
      console.log(
        JSON.stringify({
          items,
          zoom,
          mix,
          ...(css ? { css } : {}),
          open,
          idle,
          pan: { ...(pan as object), cpuMs: panCpu },
          pinch: { ...(pinch as object), cpuMs: pinchCpu },
          lift,
          swept,
          back,
          memoryMB: {
            before,
            open: opened,
            moving,
            movingPeak,
            settled,
            swept: sweptMemory,
            back: backMemory,
            rest: restMemory,
          },
        }),
      );
    }
} finally {
  host.close();
  server.kill();
}
