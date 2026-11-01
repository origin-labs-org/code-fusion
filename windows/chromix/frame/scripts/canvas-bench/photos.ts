import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** What the native media route hands a card: a stored photo scaled to 720 px wide. */
const WIDTH = 720;
const HEIGHT = 480;

/** A 24-bit BMP of a gradient in the index's hues under noise, so it compresses like a photo. */
function bitmap(index: number): Buffer {
  const row = WIDTH * 3;
  const header = Buffer.alloc(54);
  header.write("BM", 0);
  header.writeUInt32LE(54 + row * HEIGHT, 2);
  header.writeUInt32LE(54, 10);
  header.writeUInt32LE(40, 14);
  header.writeInt32LE(WIDTH, 18);
  header.writeInt32LE(HEIGHT, 22);
  header.writeUInt16LE(1, 26);
  header.writeUInt16LE(24, 28);
  header.writeUInt32LE(row * HEIGHT, 34);
  const pixels = Buffer.alloc(row * HEIGHT);
  const from = [(index * 53) % 256, (index * 101 + 80) % 256, (index * 29 + 160) % 256];
  const to = [(index * 17 + 40) % 256, (index * 71) % 256, (index * 37 + 90) % 256];
  let seed = index + 1;
  for (let y = 0; y < HEIGHT; y++)
    for (let x = 0; x < WIDTH; x++) {
      const t = (x / WIDTH + y / HEIGHT) / 2;
      seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff;
      const noise = (seed % 48) - 24;
      for (let channel = 0; channel < 3; channel++) {
        const value = from[channel]! + (to[channel]! - from[channel]!) * t + noise;
        pixels[y * row + x * 3 + channel] = Math.max(0, Math.min(255, Math.round(value)));
      }
    }
  return Buffer.concat([header, pixels]);
}

/** Makes photo-0.jpg … photo-(count - 1).jpg in `dir`, keeping those already there. */
export function ensurePhotos(dir: string, count: number): void {
  mkdirSync(dir, { recursive: true });
  const missing = Array.from({ length: count }, (_, index) => index).filter(
    (index) => !existsSync(join(dir, `photo-${index}.jpg`)),
  );
  if (!missing.length) return;
  const scratch = mkdtempSync(join(tmpdir(), "canvas-bench-"));
  try {
    for (const index of missing) writeFileSync(join(scratch, `photo-${index}.bmp`), bitmap(index));
    execFileSync(
      "sips",
      [
        "-s",
        "format",
        "jpeg",
        "-s",
        "formatOptions",
        "85",
        ...missing.map((index) => join(scratch, `photo-${index}.bmp`)),
        "--out",
        dir,
      ],
      { stdio: "ignore" },
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
