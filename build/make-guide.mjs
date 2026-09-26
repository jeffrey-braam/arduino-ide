// Renders docs/student-guide.html to docs/student-guide.pdf (one US Letter page) with Edge/Chrome.
// Usage: node build/make-guide.mjs
import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = path.join(root, "docs/student-guide.html");
const pdf = path.join(root, "docs/student-guide.pdf");

const browser = await chromium.launch({ channel: process.env.BROWSER || "msedge" });
const page = await browser.newPage();
await page.goto(pathToFileURL(html).href);
await page.emulateMedia({ media: "print" });
await page.pdf({ path: pdf, format: "Letter", printBackground: true, preferCSSPageSize: true });
// A Letter page minus the @page margins is 10.1in tall; warn if the guide spills onto a second page.
const heightIn = await page.evaluate(() => document.documentElement.scrollHeight / 96);
await browser.close();
console.log(`Wrote ${path.relative(root, pdf)} (content ${heightIn.toFixed(1)}in tall${heightIn > 10.1 ? " - MORE THAN ONE PAGE" : ", fits on one page"})`);
