// End-to-end test against a real Uno: drives dist/arduino-ide.html in Edge (or Chrome), with
// navigator.serial bridged to a physical COM port through node-serialport, since automated
// browsers can't click through the port chooser. Everything above navigator.serial is real.
//
// Usage: node test/hardware/e2e.mjs [COM3] [--chrome] [--headed]
// WARNING: overwrites the sketch on the connected board.
import { chromium } from "playwright-core";
import { SerialPort } from "serialport";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const portPath = process.argv.slice(2).find((a) => !a.startsWith("--")) || "COM3";
const channel = process.argv.includes("--chrome") ? "chrome" : "msedge";
const fixture = (n) => readFileSync(path.join(root, "test/fixtures", n), "utf8");

let sp = null;
let rxBuf = [];

async function bridge(page) {
  await page.exposeFunction("__spOpen", async (baudRate) => {
    // A real browser closes a page's ports when it reloads; the bridge must do the same.
    if (sp?.isOpen) await new Promise((r) => sp.close(() => r()));
    return new Promise((res, rej) => {
      rxBuf = [];
      sp = new SerialPort({ path: portPath, baudRate, autoOpen: false });
      sp.on("data", (d) => rxBuf.push(...d));
      sp.open((e) => (e ? rej(new Error(e.message)) : res()));
    });
  });
  await page.exposeFunction("__spClose", () => new Promise((res) => (sp?.isOpen ? sp.close(() => res()) : res())));
  await page.exposeFunction("__spWrite", (bytes) =>
    new Promise((res, rej) => sp.write(Buffer.from(bytes), (e) => (e ? rej(e) : sp.drain(() => res())))));
  await page.exposeFunction("__spRead", async () => {
    if (!rxBuf.length) await new Promise((r) => setTimeout(r, 5));
    return rxBuf.splice(0);
  });
  await page.exposeFunction("__spSignals", (s) =>
    new Promise((res, rej) => sp.set({ dtr: s.dataTerminalReady, rts: s.requestToSend }, (e) => (e ? rej(e) : res()))));

  await page.addInitScript(() => {
    const port = {
      readable: null,
      writable: null,
      getInfo: () => ({ usbVendorId: 0x2341, usbProductId: 0x0043 }),
      async open({ baudRate }) {
        if (this.readable) throw new DOMException("The port is already open.", "InvalidStateError");
        await window.__spOpen(baudRate);
        let open = true;
        this.readable = new ReadableStream({
          async pull(c) {
            while (open) {
              const b = await window.__spRead();
              if (b.length) return c.enqueue(new Uint8Array(b));
            }
            c.close();
          },
          cancel() {
            open = false;
          },
        });
        this.writable = new WritableStream({ write: (chunk) => window.__spWrite(Array.from(chunk)) });
        this._stop = () => (open = false);
      },
      async setSignals(s) {
        await window.__spSignals(s);
      },
      async close() {
        if (!this.readable) throw new DOMException("The port is already closed.", "InvalidStateError");
        this._stop();
        this.readable = null;
        this.writable = null;
        await window.__spClose();
      },
    };
    const serial = new EventTarget();
    serial.getPorts = async () => [port];
    serial.requestPort = async () => port;
    Object.defineProperty(navigator, "serial", { value: serial });

    // Stand-in for the file picker: tests put the next file on window.__nextFile.
    window.showOpenFilePicker = async () => {
      const f = window.__nextFile;
      if (!f) throw new DOMException("cancelled", "AbortError");
      window.__nextFile = null;
      return [{ getFile: async () => new File([f.text], f.name) }];
    };
  });
}

const results = [];
async function step(name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push(`PASS ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)${detail ? " - " + detail : ""}`);
  } catch (e) {
    results.push(`FAIL ${name} - ${e.message.split("\n").slice(0, 12).join("\n      ")}`);
    const state = await page
      .evaluate(() => ({ status: document.getElementById("status-text").textContent, monitor: document.getElementById("mon-out").textContent.slice(-300) }))
      .catch(() => ({}));
    results.push("     status: " + JSON.stringify(state.status) + "  monitor tail: " + JSON.stringify(state.monitor));
    throw e;
  }
}

const browser = await chromium.launch({ channel, headless: !process.argv.includes("--headed") });
const page = await browser.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
page.on("dialog", (d) => d.accept());
await bridge(page);

const outputText = () => page.$eval("#output", (el) => el.innerText);
const monitorText = () => page.$eval("#mon-out", (el) => el.textContent);

async function uploadHex(name) {
  await page.evaluate((f) => {
    window.__nextFile = f;
    document.getElementById("status-text").textContent = ""; // so we wait for this upload's result
  }, { name, text: fixture(name) });
  await page.click("#btn-upload-hex");
  await page.waitForFunction(() => /Upload (complete|failed)/.test(document.getElementById("status-text").textContent), null, { timeout: 60000 });
  const status = await page.textContent("#status-text");
  const out = (await outputText()).trim().split("\n");
  if (status !== "Upload complete") throw new Error(out.slice(-3).join(" | "));
  return out.at(-1);
}

try {
  await step("page loads", async () => {
    await page.goto(pathToFileURL(path.join(root, "dist/arduino-ide.html")).href);
    await page.waitForSelector(".cm-editor");
    await page.waitForFunction(() => document.getElementById("btn-port").textContent.includes("Arduino Uno"));
    return await page.textContent("#btn-port");
  });

  await step("upload Blink.ino.hex", () => uploadHex("Blink.ino.hex"));
  await step("upload SerialEcho.ino.hex", () => uploadHex("SerialEcho.ino.hex"));

  await step("serial monitor receives output", async () => {
    await page.click('.tabs button[data-tab="monitor"]');
    await page.selectOption("#mon-baud", "9600");
    await page.click("#mon-connect");
    await page.waitForFunction(() => document.getElementById("mon-out").textContent.includes("SerialEcho ready"), null, { timeout: 10000 });
    await page.waitForFunction(() => /tick 1/.test(document.getElementById("mon-out").textContent), null, { timeout: 10000 });
    return JSON.stringify((await monitorText()).trim().split("\n").slice(0, 3));
  });

  await step("serial monitor sends a line", async () => {
    await page.fill("#mon-input", "hello uno");
    await page.press("#mon-input", "Enter");
    await page.waitForFunction(() => document.getElementById("mon-out").textContent.includes("echo:hello uno"), null, { timeout: 5000 });
  });

  await step("upload while monitor is open pauses and resumes it", async () => {
    await page.click("#mon-clear");
    const r = await uploadHex("SerialEcho.ino.hex");
    await page.waitForFunction(() => document.getElementById("mon-connect").textContent === "Disconnect", null, { timeout: 5000 });
    await page.waitForFunction(() => document.getElementById("mon-out").textContent.includes("SerialEcho ready"), null, { timeout: 10000 });
    return r;
  });

  await step("compile in the browser and upload with the Upload button", async () => {
    const stamp = "built-in-browser-" + Date.now().toString(36);
    const code = fixture("SerialEcho.ino").replace("SerialEcho ready", stamp);
    // Load the sketch the way autosave would, then reload so the editor picks it up.
    await page.evaluate((c) => localStorage.setItem("arduino-ide.sketch", JSON.stringify({ name: "BrowserBuilt.ino", code: c, savedCode: c })), code);
    await page.reload();
    await page.waitForFunction(() => /Compiler ready/.test(document.getElementById("output").textContent), null, { timeout: 60000 });
    await page.evaluate(() => (document.getElementById("status-text").textContent = ""));
    await page.click("#btn-upload");
    await page.waitForFunction(() => /Upload (complete|failed)|Compilation failed/.test(document.getElementById("status-text").textContent), null, { timeout: 90000 });
    const out = (await outputText()).trim().split("\n");
    if ((await page.textContent("#status-text")) !== "Upload complete") throw new Error(out.slice(-4).join(" | "));
    await page.click('.tabs button[data-tab="monitor"]');
    await page.click("#mon-connect");
    await page.waitForFunction((s) => document.getElementById("mon-out").textContent.includes(s), stamp, { timeout: 10000 });
    return out.filter((l) => /Sketch uses|Done/.test(l)).join(" / ");
  });

  await step("serial plotter graphs named values from the board", async () => {
    await page.click('.tabs button[data-tab="monitor"]');
    if ((await page.textContent("#mon-connect")) === "Disconnect") await page.click("#mon-connect");
    const code = [
      "void setup() { Serial.begin(9600); }",
      "void loop() {",
      "  static int t = 0;",
      '  Serial.print("wave:"); Serial.print(sin(t * 0.1) * 100);',
      '  Serial.print(",ramp:"); Serial.println(t % 50);',
      "  t++; delay(20);",
      "}",
    ].join("\n");
    await page.evaluate((c) => localStorage.setItem("arduino-ide.sketch", JSON.stringify({ name: "PlotTest.ino", code: c, savedCode: c })), code);
    await page.reload();
    await page.waitForFunction(() => /Compiler ready/.test(document.getElementById("output").textContent), null, { timeout: 60000 });
    await page.evaluate(() => (document.getElementById("status-text").textContent = ""));
    await page.click("#btn-upload");
    await page.waitForFunction(() => /Upload (complete|failed)|Compilation failed/.test(document.getElementById("status-text").textContent), null, { timeout: 90000 });
    if ((await page.textContent("#status-text")) !== "Upload complete") throw new Error(await page.textContent("#status-text"));
    await page.click('.tabs button[data-tab="plotter"]');
    await page.selectOption("#mon-baud", "9600");
    await page.click("#mon-connect");
    await page.waitForFunction(() => document.querySelectorAll("#plot-legend .plot-key").length === 2, null, { timeout: 10000 });
    const first = await page.textContent("#plot-legend");
    await page.waitForTimeout(1000);
    const later = await page.textContent("#plot-legend");
    if (first === later) throw new Error("plotted values aren't updating");
    if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, "plotter.png") });
    return later.replace(/\s+/g, " ").trim();
  });

  await step("monitor disconnects cleanly", async () => {
    await page.click('.tabs button[data-tab="monitor"]');
    await page.click("#mon-connect");
    await page.waitForFunction(() => document.getElementById("mon-connect").textContent === "Connect", null, { timeout: 5000 });
  });

  await step("no page errors", async () => {
    if (pageErrors.length) throw new Error(pageErrors.join("; "));
  });
} catch {
  // recorded in results
} finally {
  console.log(results.join("\n"));
  console.log("\n--- Output panel ---\n" + (await outputText().catch(() => "")));
  await browser.close();
  if (sp?.isOpen) sp.close();
}
process.exitCode = results.some((r) => r.startsWith("FAIL")) ? 1 : 0;
