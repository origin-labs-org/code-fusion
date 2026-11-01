import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { alias } from "../../aliases";

/** Pictures come from the seeded photos, not the native media route. */
const media: Plugin = {
  name: "canvas-bench-media",
  enforce: "pre",
  load(id) {
    if (!id.endsWith("/src/domain/resources/media.ts")) return null;
    return `
      export function pageFrameUrl() { return null; }
      export function mediaUrl(_profile, digest, width = 720) {
        const url = globalThis.__benchPictures.get(digest);
        return url ? url + "?w=" + width : null;
      }
      export function mediaSize(bytes) { return bytes + " B"; }
    `;
  },
};

const PHOTOS = fileURLToPath(new URL("../../node_modules/.canvas-bench/photos", import.meta.url));
const SCALED = fileURLToPath(new URL("../../node_modules/.canvas-bench/scaled", import.meta.url));
/** The widths the native media route makes copies at (desktop/src/media.rs). */
const WIDTHS = [160, 240, 360, 540, 800, 1200, 1600];
/**
 * Serves the photos where they were made instead of copying them into every
 * build, and, as the native media route does with `?w=`, a copy scaled down
 * to the next width it makes when the photo is wider.
 */
const photos: Plugin = {
  name: "canvas-bench-photos",
  configurePreviewServer(server) {
    mkdirSync(SCALED, { recursive: true });
    server.middlewares.use((request, response, next) => {
      const match = /^\/photos\/(photo-\d+\.jpg)(?:\?w=(\d+))?$/u.exec(request.url ?? "");
      const name = match?.[1];
      const source = name ? join(PHOTOS, name) : "";
      if (!name || !existsSync(source)) return next();
      const step = WIDTHS.find((width) => width >= Number(match[2] ?? Infinity));
      let file = source;
      if (step && step < 720) {
        file = join(SCALED, `${step}-${name}`);
        if (!existsSync(file))
          execFileSync("sips", ["-Z", String(step), source, "--out", file], { stdio: "ignore" });
      }
      response.setHeader("Content-Type", "image/jpeg");
      response.end(readFileSync(file));
    });
  },
};

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  publicDir: false,
  resolve: { alias },
  plugins: [media, photos, svelte(), tailwindcss()],
  logLevel: "warn",
  build: {
    target: "es2022",
    outDir: fileURLToPath(new URL("../../node_modules/.canvas-bench-dist", import.meta.url)),
    emptyOutDir: true,
  },
  preview: { port: Number(process.env.CANVAS_BENCH_PORT ?? 4721), strictPort: true },
});
