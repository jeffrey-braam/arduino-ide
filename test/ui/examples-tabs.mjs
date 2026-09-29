// Browser test of the Examples/Libraries dialog, sketch tabs and autosave, on the built page.
// Usage: node test/ui/examples-tabs.mjs [screenshot-dir]
import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const URL_ = pathToFileURL(path.join(root, "dist/arduino-ide.html")).href;
const shots = process.argv[2]; // optional
const shot = (name) => (shots ? page.screenshot({ path: path.join(shots, name) }) : null);
const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const errs = []; page.on("pageerror", (e) => errs.push(e.message)); page.on("console", (m) => m.type() === "error" && errs.push(m.text()));
let nextPrompt = null; page.on("dialog", (d) => d.accept(d.type() === "prompt" ? nextPrompt : undefined));
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " - " + detail : ""}`);
const tabs = () => page.$$eval("#file-tabs .tab-name", (els) => els.map((e) => e.textContent));
const status = () => page.textContent("#status-text");
// CodeMirror only renders visible lines, so read the active file from the autosave instead.
const editorText = async () => { await page.waitForTimeout(500); return page.evaluate(() => { const s = JSON.parse(localStorage.getItem("arduino-ide.sketch")); return s.files[s.active].code; }); };
async function verify() {
  await page.evaluate(() => (document.getElementById("status-text").textContent = ""));
  await page.click("#btn-verify");
  await page.waitForFunction(() => /Done compiling|failed|too big/i.test(document.getElementById("status-text").textContent), null, { timeout: 60000 });
  return status();
}
await page.goto(URL_);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => /Compiler ready/.test(document.getElementById("output").textContent), null, { timeout: 60000 });

// Examples dialog
await page.click("#btn-examples");
await page.waitForSelector(".ex-item");
const counts = await page.$$eval(".ex-group summary", (s) => s.map((x) => x.textContent));
check("examples dialog lists groups", counts.length > 10, counts.slice(0, 4).join(", ") + " … " + counts.length + " groups");
await shot("ui-examples.png");
check("sensor kit group comes first", counts[0] === "37-in-1 Sensor Kit (37)", counts[0]);
await page.fill("#browser-search", "HW490");
await page.dblclick(".ex-item:not([hidden])");
check("kit example opens and compiles", (await tabs()).join() === "HW490_IR_Receiver.ino" && (await verify()) === "Done compiling");
await page.click("#btn-examples");
await page.fill("#browser-search", "blinkwithout");
const visible = await page.$$eval(".ex-item", (els) => els.filter((e) => !e.hidden).map((e) => e.textContent));
check("search filters examples", visible.length === 1 && visible[0] === "BlinkWithoutDelay", visible.join(","));
await page.click("#example-open");
check("opening an example loads it", (await tabs()).join() === "BlinkWithoutDelay.ino" && (await editorText()).includes("previousMillis"));
check("example compiles", (await verify()) === "Done compiling");

// Multi-file example
await page.click("#btn-examples");
await page.fill("#browser-search", "ReceiveDemo");
await page.click(".ex-item:not([hidden])");
check("preview shows file chips", (await page.$$eval("#example-files .file-chip", (e) => e.map((x) => x.textContent))).length === 2);
await page.dblclick(".ex-item:not([hidden])");
check("multi-file example opens as tabs", (await tabs()).join() === "ReceiveDemo.ino,PinDefinitionsAndMore.h", (await tabs()).join());
check("multi-file example compiles", (await verify()) === "Done compiling");
await page.click("#file-tabs .file-tab:nth-child(2)");
check("switching tabs shows the header", (await editorText()).includes("IR_RECEIVE_PIN"));

// Libraries + Include
nextPrompt = null;
await page.click("#btn-new"); // discard prompt: dialog auto-accepted
await page.click("#btn-libraries");
await page.waitForSelector(".lib-card");
check("libraries listed", (await page.$$eval(".lib-card", (c) => c.length)) === 14);
await shot("ui-libraries.png");
await page.fill("#browser-search", "servo");
await page.click(".lib-card:not([hidden]) button.primary");
check("Include adds the #include", (await editorText()).startsWith("#include <Servo.h>"), JSON.stringify((await editorText()).split("\n").slice(0, 3)));
check("sketch with Servo compiles", (await verify()) === "Done compiling");

// Add a tab, call into it, then put an error in it
nextPrompt = "helpers";
await page.click("#btn-add-tab");
check("new tab added", (await tabs()).includes("helpers.ino"), (await tabs()).join());
await page.click(".cm-content");
await page.keyboard.type("void blinkTwice() {\ndigitalWrite(13, HIGH)\n}\n");
const verr = await verify();
const markers = await page.$$eval(".cm-lintRange-error", (e) => e.length);
check("error in second tab is reported there", verr === "Compilation failed" && (await page.$eval('#file-tabs [aria-selected="true"] .tab-name', (e) => e.textContent)) === "helpers.ino" && markers > 0, verr + ", markers " + markers);
await shot("ui-tabs-error.png");

// Autosave keeps tabs across reload
await page.waitForTimeout(600);
await page.reload();
await page.waitForSelector("#file-tabs .file-tab");
check("autosave restores tabs", (await tabs()).length === 2 && (await tabs())[1] === "helpers.ino", (await tabs()).join());

// Remove tab
await page.click("#file-tabs .file-tab:nth-child(2) .tab-close");
check("tab removed", (await tabs()).length === 1);

// Old (v1) autosave format still loads
await page.evaluate(() => localStorage.setItem("arduino-ide.sketch", JSON.stringify({ name: "Old.ino", code: "void setup(){}\nvoid loop(){}\n", savedCode: "" })));
await page.reload();
await page.waitForSelector("#file-tabs .file-tab");
check("old autosave format loads", (await tabs()).join() === "Old.ino" && (await page.$eval(".file-tab", (e) => e.classList.contains("dirty"))));

// About tab: licenses and the GPL source offer
await page.click("#btn-about");
await page.waitForSelector("#browser-about .license-entry");
check("About opens with the GPL notice", (await page.textContent("#browser-about .gpl-notice")).includes("GNU General Public License") && (await page.isHidden("#browser-search")));
check("About lists compiler sources", (await page.textContent("#browser-about")).includes("Exact sources of the compiler tools"));
const sections = await page.$$eval("#browser-about .about-section", (s) => s.map((x) => x.querySelectorAll(".license-entry").length));
check("About lists components, 14 libraries and editor packages", sections[1] === 8 && sections[2] === 14 && sections[3] > 10, JSON.stringify(sections));
const gcc = page.locator("#browser-about .license-entry", { hasText: "GCC (cc1plus)" });
await gcc.locator("summary").click();
check("opening an entry shows the full license", (await gcc.locator(".license-text").first().textContent()).includes("GNU GENERAL PUBLIC LICENSE"));
const cap = page.locator("#browser-about .license-entry", { hasText: "CapacitiveSensor" });
await cap.locator("summary").click();
await cap.locator(".license-text").first().waitFor(); // the body is added by the toggle event
check("CapacitiveSensor shows its MIT notice and why", (await cap.textContent()).includes("Permission is hereby granted") && (await cap.textContent()).includes("2faac42"));
await shot("ui-about.png");
await page.click("#browser-close");
await page.click("#status-version");
check("version in the status bar opens About", await page.isVisible("#browser-about"));
await page.click("#browser-close");

check("no page errors", errs.length === 0, errs.join(" | "));
console.log(results.join("\n"));
await browser.close();
process.exitCode = results.some((r) => r.startsWith("FAIL")) ? 1 : 0;
