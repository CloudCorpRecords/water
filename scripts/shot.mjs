// Render gate: serves dist/, screenshots the demo in headless Chrome,
// and asserts the frame is non-blank, animated, and error-free.
// Usage: npm run shot  (builds first)
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const PORT = 5199;
const root = new URL("..", import.meta.url);
mkdirSync(new URL("shots/", root), { recursive: true });
// Optional A/B: SHOT_VARIANT="detail=0" SHOT_SUFFIX="-gerstner" npm run shot
const variant = process.env.SHOT_VARIANT || "";
const suffix = process.env.SHOT_SUFFIX || "";
const pageUrl = `http://localhost:${PORT}/${variant ? "?" + variant : ""}`;

const preview = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"]
});
let out = "";
preview.stdout.on("data", (d) => {
  out += d;
});
await new Promise((resolve, reject) => {
  const to = setTimeout(() => reject(new Error("preview timeout: " + out)), 30000);
  const iv = setInterval(() => {
    if (out.includes("Local:")) {
      clearTimeout(to);
      clearInterval(iv);
      resolve();
    }
  }, 200);
});

const errors = [];
const browser = await chromium.launch({
  channel: "chrome",
  args: ["--enable-unsafe-swiftshader"]
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text());
  });
  await page.goto(pageUrl, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `shots/ocean-1${suffix}.png` });
  const stats = await page.evaluate(async () => {
    const grab = () => {
      const src = document.querySelector("canvas");
      const c = document.createElement("canvas");
      c.width = 64;
      c.height = 36;
      const g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(src, 0, 0, 64, 36);
      return Array.from(g.getImageData(0, 0, 64, 36).data);
    };
    const a = grab();
    await new Promise((r) => setTimeout(r, 1500));
    const b = grab();
    const n = a.length / 4;
    let mean = 0;
    const lum = [];
    for (let i = 0; i < a.length; i += 4) {
      const l = (a[i] + a[i + 1] + a[i + 2]) / 3;
      lum.push(l);
      mean += l;
    }
    mean /= n;
    let v = 0;
    let diff = 0;
    for (let i = 0; i < n; i++) {
      v += (lum[i] - mean) * (lum[i] - mean);
      diff += Math.abs(a[4 * i] - b[4 * i]) + Math.abs(a[4 * i + 1] - b[4 * i + 1]) + Math.abs(a[4 * i + 2] - b[4 * i + 2]);
    }
    return { mean, std: Math.sqrt(v / n), diff: diff / (3 * n) };
  });
  await page.screenshot({ path: `shots/ocean-2${suffix}.png` });
  console.log("render stats:", JSON.stringify(stats));
  const rects = await page.evaluate(() => {
    const rect = (id) => {
      const e = document.getElementById(id).getBoundingClientRect();
      return { x: Math.round(e.x), y: Math.round(e.y), w: Math.round(e.width), h: Math.round(e.height) };
    };
    const c = document.querySelector("canvas").getBoundingClientRect();
    return {
      hud: rect("hud"),
      hint: rect("hint"),
      canvas: { x: Math.round(c.x), y: Math.round(c.y), w: Math.round(c.width), h: Math.round(c.height) }
    };
  });
  console.log("layout:", JSON.stringify(rects));
  const failures = [];
  if (!(stats.mean > 5 && stats.mean < 250)) failures.push(`suspicious mean ${stats.mean}`);
  if (stats.std < 8) failures.push(`flat frame std ${stats.std}`);
  if (stats.diff < 0.5) failures.push(`static frame diff ${stats.diff}`);
  if (rects.hint.y < 360) failures.push(`hint not at bottom: ${JSON.stringify(rects.hint)}`);
  if (rects.hud.y > 200) failures.push(`hud not at top: ${JSON.stringify(rects.hud)}`);
  if (rects.canvas.w < 1200 || rects.canvas.h < 660) failures.push(`canvas small: ${JSON.stringify(rects.canvas)}`);
  failures.push(...errors);
  if (failures.length > 0) {
    console.error("SHOT FAIL:\n- " + failures.join("\n- "));
    process.exitCode = 1;
  } else {
    console.log("SHOT OK");
  }
} finally {
  await browser.close();
  preview.kill();
}
