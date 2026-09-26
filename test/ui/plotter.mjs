// Browser test of the Serial Plotter with a simulated board (no hardware needed): navigator.serial
// is replaced by a port that streams "wave:<n>,ramp:<n>" lines like a sketch would.
// Usage: node test/ui/plotter.mjs [screenshot-dir]
import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const shots = process.argv[2];
const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));

await page.addInitScript(() => {
  const port = {
    readable: null,
    writable: null,
    getInfo: () => ({ usbVendorId: 0x2341, usbProductId: 0x0043 }),
    async open() {
      let t = 0;
      let timer;
      const enc = new TextEncoder();
      this.readable = new ReadableStream({
        start(c) {
          c.enqueue(enc.encode("Board ready\r\n")); // text lines must be ignored
          timer = setInterval(() => {
            // Split a line across chunks now and then, as real serial data arrives.
            const line = `wave:${(Math.sin(t / 10) * 100).toFixed(2)},ramp:${t % 50}\r\n`;
            const cut = t % 3 === 0 ? 5 : line.length;
            c.enqueue(enc.encode(line.slice(0, cut)));
            if (cut < line.length) c.enqueue(enc.encode(line.slice(cut)));
            t++;
          }, 20);
        },
        cancel: () => clearInterval(timer),
      });
      this.writable = new WritableStream({ write: (chunk) => (window.__sent += new TextDecoder().decode(chunk)) });
    },
    async close() {
      this.readable = null;
      this.writable = null;
    },
    async setSignals() {},
  };
  window.__sent = "";
  const serial = new EventTarget();
  serial.getPorts = async () => [port];
  serial.requestPort = async () => port;
  Object.defineProperty(navigator, "serial", { value: serial });
});

const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " - " + detail : ""}`);

await page.goto(pathToFileURL(path.join(root, "dist/arduino-ide.html")).href);
await page.click('.tabs button[data-tab="plotter"]');
check("plotter shows its own controls", (await page.isVisible("#plot-canvas")) && (await page.isHidden("#mon-out")) && (await page.isVisible("#plot-pause")));
await page.click("#mon-connect");
await page.waitForFunction(() => document.querySelectorAll("#plot-legend .plot-key").length === 2, null, { timeout: 5000 });
const legend = await page.textContent("#plot-legend");
check("named values become two lines", /wave/.test(legend) && /ramp/.test(legend), legend.replace(/\s+/g, " "));
await page.waitForTimeout(1500); // let a stretch of samples arrive
const drawn = await page.$eval("#plot-canvas", (c) => {
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  let colored = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0 && Math.abs(d[i] - d[i + 1]) > 40) colored++;
  return colored;
});
check("lines are drawn on the canvas", drawn > 200, drawn + " coloured pixels");
if (shots) await page.screenshot({ path: path.join(shots, "plotter.png") });

await page.click("#plot-pause");
await page.waitForTimeout(100); // a redraw queued before the click may still land
const pausedAt = await page.textContent("#plot-legend");
await page.waitForTimeout(300);
check("Pause freezes the graph", (await page.textContent("#plot-legend")) === pausedAt);
await page.click("#plot-pause");
await page.waitForTimeout(300);
check("Resume continues", (await page.textContent("#plot-legend")) !== pausedAt);

await page.click('.tabs button[data-tab="monitor"]');
check("Serial Monitor still shows the text", (await page.textContent("#mon-out")).includes("Board ready") && (await page.isHidden("#plot-canvas")));
await page.click('.tabs button[data-tab="plotter"]');
await page.click("#mon-clear");
check("Clear empties the graph", (await page.$$eval("#plot-legend .plot-key", (k) => k.length)) <= 2);
// Sending from the shared input uses the chosen line ending (was sending a literal backslash-n)
check("line ending shows Newline by default", (await page.$eval("#mon-ending", (s) => s.selectedOptions[0]?.textContent)) === "Newline");
await page.fill("#mon-input", "hi");
await page.press("#mon-input", "Enter");
await page.selectOption("#mon-ending", "both");
await page.fill("#mon-input", "yo");
await page.press("#mon-input", "Enter");
await page.waitForTimeout(200);
const sent = await page.evaluate(() => window.__sent);
check("sent lines end with the chosen line ending", sent === "hi\nyo\r\n", JSON.stringify(sent));
check("no page errors", errs.length === 0, errs.join(" | "));

console.log(results.join("\n"));
await browser.close();
process.exitCode = results.some((r) => r.startsWith("FAIL")) ? 1 : 0;
