// Extracts the hero orbit clip into a scrub-ready webp frame sequence
// and copies the two background clips into assets/video.
// Usage: node scripts/extract-frames.mjs
import { execFileSync } from "node:child_process";
import { readdirSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ffmpeg from "ffmpeg-static";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "assets", "source");
const framesDir = join(root, "assets", "frames", "hero");
const videoDir = join(root, "assets", "video");

const FPS = 24;          // 8s clip -> 192 frames
const WIDTH = 1600;      // scrub canvas source width
const QUALITY = "78";    // webp quality

rmSync(framesDir, { recursive: true, force: true });
mkdirSync(framesDir, { recursive: true });
mkdirSync(videoDir, { recursive: true });

execFileSync(ffmpeg, [
  "-y", "-loglevel", "error",
  "-i", join(src, "hero_orbit.mp4"),
  "-vf", `fps=${FPS},scale=${WIDTH}:-2`,
  "-c:v", "libwebp", "-quality", QUALITY,
  join(framesDir, "frame_%04d.webp"),
]);

const frames = readdirSync(framesDir).filter((f) => f.endsWith(".webp")).sort();
writeFileSync(
  join(framesDir, "manifest.json"),
  JSON.stringify({ count: frames.length, pattern: "frame_%04d.webp", width: WIDTH, height: Math.round(WIDTH * 9 / 16) })
);

for (const clip of ["builder.mp4", "closer.mp4"]) {
  copyFileSync(join(src, clip), join(videoDir, clip));
}

console.log(`extracted ${frames.length} hero frames -> assets/frames/hero, copied background clips -> assets/video`);
