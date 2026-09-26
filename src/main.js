import { createEditor } from "./editor.js";
import { PortManager } from "./serial/ports.js";
import { SerialMonitor, BAUD_RATES } from "./monitor.js";
import { uploadStk500 } from "./upload/stk500.js";
import { parseIntelHex } from "./upload/intelhex.js";
import { BOARDS, DEFAULT_BOARD } from "./boards.js";
import { OutputLog } from "./log.js";
import * as storage from "./storage.js";
import * as files from "./files.js";
import { compilerAvailable, compile, startCompiler } from "./compiler.js";
import { browserAvailable, setupBrowser } from "./browser.js";
import { makeSketch, newSketch, isDirty, markSaved, toStorage, fromStorage, validateTabName, orderOpenedFiles, baseName } from "./sketch.js";

const $ = (id) => document.getElementById(id);

// ---------- State ----------
const settings = storage.loadSettings({
  board: DEFAULT_BOARD,
  baud: 9600,
  lineEnding: "\n",
  autoscroll: true,
  timestamps: false,
  bottomHeight: 240,
  tab: "output",
});
if (!BOARDS[settings.board]) settings.board = DEFAULT_BOARD;
const persistSettings = () => storage.saveSettings(settings);

let sketch = fromStorage(storage.loadSketch()) ?? newSketch();
const activeFile = () => sketch.files[sketch.active];
const mainName = () => sketch.files[0].name;
let lastDiagnostics = []; // from the last compile, for re-marking a tab when it's shown again

let busy = false;
const log = new OutputLog($("output"));
const ports = new PortManager();
const monitor = new SerialMonitor(ports, { out: $("mon-out"), settings });

// ---------- Editor, tabs & autosave ----------
let autosaveTimer = 0;
function autosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => storage.saveSketch(toStorage(sketch)), 400);
}

const editor = createEditor($("editor"), {
  doc: activeFile().code,
  onChange(text) {
    activeFile().code = text;
    renderTabs();
    autosave();
  },
});

function renderTabs() {
  $("file-tabs").replaceChildren(
    ...sketch.files.map((f, i) => {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "file-tab" + (i === 0 ? " main" : "") + (f.code !== f.savedCode ? " dirty" : "");
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(i === sketch.active));
      const label = document.createElement("span");
      label.className = "tab-name";
      label.textContent = f.name;
      tab.append(label);
      tab.addEventListener("click", () => switchTab(i));
      if (i > 0) {
        const close = document.createElement("span");
        close.className = "tab-close";
        close.textContent = "✕";
        close.title = "Remove " + f.name + " from the sketch";
        close.addEventListener("click", (e) => {
          e.stopPropagation();
          removeTab(i);
        });
        tab.append(close);
      }
      return tab;
    }),
  );
  document.title = mainName() + (isDirty(sketch) ? " ●" : "") + " — Arduino IDE";
}

function showActiveDiagnostics() {
  editor.showDiagnostics(lastDiagnostics.filter((d) => tabIndexFor(d.file) === sketch.active));
}

function switchTab(i) {
  sketch.active = i;
  editor.show(activeFile().name, activeFile().code);
  showActiveDiagnostics();
  renderTabs();
  autosave();
  editor.focus();
}

function loadSketch(next) {
  sketch = next;
  lastDiagnostics = [];
  editor.reset();
  switchTab(sketch.active);
}

function addTab() {
  const input = prompt("Name for the new tab (for example helpers.ino or pins.h):");
  if (input === null) return;
  const { name, error } = validateTabName(input, sketch);
  if (error) {
    alert(error);
    return;
  }
  sketch.files.push({ name, code: "", savedCode: null });
  switchTab(sketch.files.length - 1);
}

function removeTab(i) {
  const f = sketch.files[i];
  if (f.code.trim() && !confirm(`Remove “${f.name}” from the sketch? Its code will be deleted.`)) return;
  sketch.files.splice(i, 1);
  sketch.removed.push(f.name);
  editor.forget(f.name);
  lastDiagnostics = lastDiagnostics.filter((d) => d.file !== f.name);
  switchTab(Math.min(sketch.active > i ? sketch.active - 1 : sketch.active, sketch.files.length - 1));
}

const confirmDiscard = () => !isDirty(sketch) || confirm(`“${mainName()}” has unsaved changes. Discard them?`);

// ---------- Status bar & tabs ----------
function setStatus(text) {
  $("status-text").textContent = text;
}

function setProgress(fraction) {
  const p = $("progress");
  p.hidden = fraction === null;
  if (fraction !== null) p.value = fraction;
}

function showTab(name) {
  for (const b of document.querySelectorAll(".tabs button")) b.setAttribute("aria-selected", String(b.dataset.tab === name));
  $("panel-output").hidden = name !== "output";
  $("panel-monitor").hidden = name !== "monitor";
  settings.tab = name;
  persistSettings();
}

function setBusy(value) {
  busy = value;
  for (const id of ["btn-verify", "btn-upload", "btn-upload-hex", "btn-port", "board-select", "mon-connect"]) $(id).disabled = value;
  if (!ports.supported) for (const id of ["btn-upload", "btn-upload-hex", "btn-port", "mon-connect"]) $(id).disabled = true;
}

function renderPort() {
  $("btn-port").textContent = ports.port ? ports.label : "Select port";
  $("status-port").textContent = ports.port ? "on " + ports.label : "no port selected";
}

function renderMonitorState() {
  const btn = $("mon-connect");
  btn.textContent = monitor.connected ? "Disconnect" : "Connect";
  btn.classList.toggle("connected", monitor.connected);
}

// ---------- File actions ----------
async function runFileAction(fn) {
  try {
    await fn();
  } catch (e) {
    log.error(e.message);
    showTab("output");
  }
}

function afterSave(message) {
  markSaved(sketch);
  renderTabs();
  autosave();
  setStatus(message);
}

const actions = {
  newSketch: () =>
    runFileAction(async () => {
      if (!confirmDiscard()) return;
      loadSketch(newSketch());
      setStatus("New sketch");
    }),

  open: () =>
    runFileAction(async () => {
      if (!confirmDiscard()) return;
      const opened = await files.openSketchFiles();
      if (!opened.length) return;
      const ordered = orderOpenedFiles(opened.map((f) => ({ name: f.name, code: f.text, handle: f.handle })));
      const next = makeSketch(ordered);
      next.files.forEach((f, i) => (f.handle = ordered[i].handle));
      loadSketch(next);
      setStatus("Opened " + ordered.map((f) => f.name).join(", "));
    }),

  // Writes back to where the sketch came from: its folder, or each file's own handle.
  save: () =>
    runFileAction(async () => {
      if (sketch.dirHandle) {
        await files.writeFolder(sketch.dirHandle, sketch.files, sketch.removed);
        return afterSave(`Saved ${sketch.files.length} files to ${sketch.dirHandle.name}`);
      }
      if (sketch.files.every((f) => f.handle) && !sketch.removed.length) {
        for (const f of sketch.files) await files.writeToHandle(f.handle, f.code);
        return afterSave("Saved " + sketch.files.map((f) => f.name).join(", "));
      }
      return actions.saveAs();
    }),

  saveAs: () =>
    runFileAction(async () => {
      if (sketch.files.length === 1) {
        const main = sketch.files[0];
        const suggested = /\.\w+$/.test(main.name) ? main.name : main.name + ".ino";
        const r = await files.saveAs(suggested, main.code);
        if (!r) return;
        editor.rename(main.name, r.name);
        main.name = r.name;
        main.handle = r.handle;
        sketch.dirHandle = null;
        return afterSave(r.handle ? "Saved " + r.name : "Downloaded " + r.name);
      }
      const r = await files.saveFolderAs(baseName(mainName()), sketch.files);
      if (!r) return;
      sketch.dirHandle = r.dirHandle;
      for (const f of sketch.files) f.handle = null;
      afterSave(r.dirHandle ? `Saved ${sketch.files.length} files to folder ${r.dirHandle.name}` : `Downloaded ${sketch.files.length} files`);
    }),

  async selectPort() {
    try {
      const port = await ports.request();
      if (port) setStatus("Using " + ports.label);
    } catch (e) {
      log.error("Couldn't choose a port: " + e.message);
      showTab("output");
    }
  },

  async verify() {
    if (busy) return;
    setBusy(true);
    try {
      await compileSketch();
    } finally {
      setBusy(false);
    }
  },

  async upload() {
    if (busy) return;
    setBusy(true);
    let result;
    try {
      result = await compileSketch();
    } finally {
      setBusy(false);
    }
    if (result) await uploadImage(result.image, mainName());
  },

  async uploadHex() {
    if (busy) return;
    let f;
    try {
      f = await files.openHexFile();
    } catch (e) {
      log.error("Couldn't open the file: " + e.message);
      showTab("output");
      return;
    }
    if (!f) return;
    let image;
    try {
      image = parseIntelHex(f.text);
    } catch (e) {
      showTab("output");
      log.error(`“${f.name}” isn't a valid .hex file: ${e.message}`);
      return;
    }
    await uploadImage(image, f.name);
  },
};

// The compiler needs a .ino name for the main file; a sketch opened as .txt or .cpp still compiles.
const compileName = (i) => (i === 0 && !/\.ino$/i.test(sketch.files[0].name) ? baseName(sketch.files[0].name) + ".ino" : sketch.files[i].name);

// Which tab a compiler message is about (-1 for library files).
const tabIndexFor = (file) => sketch.files.findIndex((f, i) => compileName(i) === file);

function goToLocation(file, line, column) {
  const i = tabIndexFor(file);
  if (i < 0) return;
  if (i !== sketch.active) switchTab(i);
  editor.goTo(line, column);
}

// Compiles the sketch, reporting to the Output panel and editor. Resolves with the result or null.
async function compileSketch() {
  showTab("output");
  if (!compilerAvailable) {
    log.warn("This copy of the IDE was built without the compiler. Use “Upload .hex” to upload an already-compiled sketch.");
    return null;
  }
  const board = BOARDS[settings.board];
  lastDiagnostics = [];
  editor.showDiagnostics([]);
  log.info(`Compiling ${mainName()} for ${board.name}…`);
  setStatus("Compiling…");
  const onLocation = goToLocation;
  const t0 = performance.now();
  try {
    const r = await compile(sketch.files.map((f, i) => ({ name: compileName(i), code: f.code })), { log: (m) => log.muted(m) });
    if (r.output.trim()) log.compilerOutput(r.output, { onLocation });
    lastDiagnostics = r.warnings.filter((d) => tabIndexFor(d.file) >= 0);
    showActiveDiagnostics();

    const flashMax = board.upload.maxSize;
    const ramMax = board.ramSize;
    const pct = (n, max) => Math.round((n / max) * 100);
    log.info(`Sketch uses ${r.flash} bytes (${pct(r.flash, flashMax)}%) of program storage space. Maximum is ${flashMax} bytes.`);
    log.info(`Global variables use ${r.ram} bytes (${pct(r.ram, ramMax)}%) of dynamic memory, leaving ${ramMax - r.ram} bytes for local variables. Maximum is ${ramMax} bytes.`);
    if (r.flash > flashMax) {
      log.error("Sketch too big: it doesn't fit on the board. Try removing code or libraries you don't need.");
      setStatus("Sketch too big");
      return null;
    }
    if (r.ram > ramMax * 0.75) log.warn("Low memory available, stability problems may occur.");
    log.success(`Done compiling in ${((performance.now() - t0) / 1000).toFixed(1)} s.`);
    setStatus("Done compiling");
    return r;
  } catch (e) {
    if (e.output) log.compilerOutput(e.output, { onLocation });
    log.error(e.message);
    lastDiagnostics = (e.diagnostics || []).filter((d) => tabIndexFor(d.file) >= 0);
    showActiveDiagnostics();
    const first = lastDiagnostics.find((d) => d.severity === "error");
    if (first) goToLocation(first.file, first.line, first.column);
    setStatus("Compilation failed");
    return null;
  }
}

async function uploadImage(image, label) {
  if (busy) return;
  showTab("output");
  const port = await ports.ensurePort();
  if (!port) {
    log.warn("No port selected. Plug in the board and choose it from the list.");
    return;
  }
  const board = BOARDS[settings.board];
  setBusy(true);
  const resumeMonitor = await monitor.pause();
  log.info(`Uploading ${label} (${image.length} bytes) to ${board.name} on ${ports.label}…`);
  setStatus("Uploading…");
  setProgress(0);
  const t0 = performance.now();
  try {
    await uploadStk500(port, image, {
      ...board.upload,
      onProgress(fraction, phase) {
        setProgress(fraction);
        setStatus(`${phase}… ${Math.round(fraction * 100)}%`);
      },
      log: (m) => log.muted(m),
    });
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    log.success(`Done uploading in ${secs} s.`);
    setStatus("Upload complete");
  } catch (e) {
    log.error("Upload failed: " + e.message);
    setStatus("Upload failed");
  } finally {
    setProgress(null);
    setBusy(false);
    if (resumeMonitor) await monitor.resume();
  }
}

// ---------- Serial Monitor UI ----------
function setupMonitorUi() {
  const baud = $("mon-baud");
  for (const b of BAUD_RATES) baud.add(new Option(b + " baud", String(b)));
  baud.value = String(settings.baud);
  baud.addEventListener("change", async () => {
    settings.baud = Number(baud.value);
    persistSettings();
    await monitor.reconnect();
  });

  const ending = $("mon-ending");
  ending.value = settings.lineEnding;
  ending.addEventListener("change", () => {
    settings.lineEnding = ending.value;
    persistSettings();
  });

  for (const key of ["autoscroll", "timestamps"]) {
    const box = $("mon-" + key);
    box.checked = settings[key];
    box.addEventListener("change", () => {
      settings[key] = box.checked;
      persistSettings();
    });
  }

  $("mon-connect").addEventListener("click", async () => {
    if (monitor.connected) await monitor.disconnect();
    else await monitor.connect();
  });
  $("mon-clear").addEventListener("click", () => monitor.clear());

  const history = [];
  let historyPos = 0;
  const input = $("mon-input");
  $("mon-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!monitor.connected) await monitor.connect();
    if (!monitor.connected) return;
    const line = input.value;
    await monitor.send(line, settings.lineEnding);
    if (line && history[history.length - 1] !== line) history.push(line);
    historyPos = history.length;
    input.value = "";
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp" && historyPos > 0) input.value = history[--historyPos];
    else if (e.key === "ArrowDown" && historyPos < history.length) input.value = history[++historyPos] ?? "";
    else return;
    e.preventDefault();
  });

  monitor.addEventListener("state", () => {
    renderMonitorState();
    setStatus(monitor.connected ? `Serial Monitor connected at ${settings.baud} baud` : "Serial Monitor disconnected");
  });
  monitor.addEventListener("error", (e) => {
    setStatus(e.message);
    log.error(e.message);
  });
}

// ---------- Examples & Libraries ----------
function includeLibrary(lib) {
  const code = activeFile().code;
  const escape = (h) => h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const missing = lib.includes.filter((h) => !new RegExp(`#\\s*include\\s*[<"]${escape(h)}[>"]`).test(code));
  if (!missing.length) {
    setStatus(`${lib.displayName} is already included`);
    editor.focus();
    return;
  }
  const lines = missing.map((h) => `#include <${h}>`);
  editor.insertIncludes(lines);
  setStatus("Added " + lines.join(", "));
}

function setupExamplesAndLibraries() {
  if (!browserAvailable)
    for (const id of ["btn-examples", "btn-libraries"]) {
      $(id).disabled = true;
      $(id).title = "This copy of the IDE was built without examples.";
    }
  const browser = setupBrowser({
    onOpenExample(example, where) {
      if (!confirmDiscard()) return;
      loadSketch(makeSketch(example.files));
      const name = example.name.split("/").pop();
      log.info(`Opened the “${name}” example (${where}). It's a copy: use Save As to keep your changes.`);
      setStatus("Opened example " + name);
    },
    onInclude: includeLibrary,
  });
  $("btn-examples").addEventListener("click", () => browser.open("examples"));
  $("btn-libraries").addEventListener("click", () => browser.open("libraries"));
  $("btn-about").addEventListener("click", () => browser.open("about"));
  $("status-version").title = "About this IDE (built " + __BUILD_DATE__ + ")";
  $("status-version").addEventListener("click", () => browser.open("about"));
}

// ---------- Layout ----------
function setupSplitter() {
  const splitter = $("splitter");
  const app = $("app");
  const apply = (h) => {
    const max = window.innerHeight - 200;
    settings.bottomHeight = Math.round(Math.max(90, Math.min(max, h)));
    app.style.setProperty("--bottom-h", settings.bottomHeight + "px");
  };
  apply(settings.bottomHeight);
  splitter.addEventListener("pointerdown", (e) => {
    splitter.setPointerCapture(e.pointerId);
    splitter.classList.add("dragging");
    const startY = e.clientY;
    const startH = settings.bottomHeight;
    const move = (ev) => apply(startH + (startY - ev.clientY));
    const up = () => {
      splitter.removeEventListener("pointermove", move);
      splitter.classList.remove("dragging");
      persistSettings();
    };
    splitter.addEventListener("pointermove", move);
    splitter.addEventListener("pointerup", up, { once: true });
    splitter.addEventListener("pointercancel", up, { once: true });
  });
  window.addEventListener("resize", () => apply(settings.bottomHeight));
}

function setupShortcuts() {
  window.addEventListener(
    "keydown",
    (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      const map = {
        s: e.shiftKey ? actions.saveAs : actions.save,
        o: actions.open,
        u: actions.upload,
        r: actions.verify,
        m: e.shiftKey ? () => showTab("monitor") : null,
      };
      const fn = map[k];
      if (!fn) return;
      e.preventDefault();
      fn();
    },
    true,
  );
}

// ---------- Startup ----------
function init() {
  const boardSelect = $("board-select");
  for (const [id, b] of Object.entries(BOARDS)) boardSelect.add(new Option(b.name, id));
  boardSelect.value = settings.board;
  boardSelect.addEventListener("change", () => {
    settings.board = boardSelect.value;
    persistSettings();
    $("status-board").textContent = BOARDS[settings.board].name;
  });
  $("status-board").textContent = BOARDS[settings.board].name;
  $("status-version").textContent = "v" + __APP_VERSION__;

  $("btn-new").addEventListener("click", actions.newSketch);
  $("btn-open").addEventListener("click", actions.open);
  $("btn-save").addEventListener("click", actions.save);
  $("btn-saveas").addEventListener("click", actions.saveAs);
  $("btn-verify").addEventListener("click", actions.verify);
  $("btn-upload").addEventListener("click", actions.upload);
  $("btn-upload-hex").addEventListener("click", actions.uploadHex);
  $("btn-port").addEventListener("click", actions.selectPort);
  $("btn-add-tab").addEventListener("click", addTab);
  for (const b of document.querySelectorAll(".tabs button")) b.addEventListener("click", () => showTab(b.dataset.tab));

  setupExamplesAndLibraries();
  setupMonitorUi();
  setupSplitter();
  setupShortcuts();
  switchTab(sketch.active);
  renderMonitorState();
  showTab(settings.tab);

  if (!ports.supported) {
    const banner = $("banner");
    banner.hidden = false;
    banner.classList.add("error");
    banner.textContent = "This browser can't connect to USB boards, so uploading and the Serial Monitor are turned off. Use Google Chrome or Microsoft Edge.";
  }
  setBusy(false);

  ports.addEventListener("change", renderPort);
  ports.addEventListener("lost", () => {
    log.warn("The board was unplugged.");
    setStatus("Board unplugged");
  });
  renderPort();
  ports.init();

  log.muted(`Arduino IDE v${__APP_VERSION__} (offline). Your sketch is saved automatically in this browser.`);
  editor.focus();

  if (compilerAvailable) {
    // Load the compiler in the background so the first Verify is quick.
    setStatus("Loading compiler…");
    setTimeout(() => {
      startCompiler().then(
        (info) => {
          log.muted(`Compiler ready (GCC 7.3.0, Arduino AVR core ${info.manifest.core.version}, ${info.manifest.libraries.length} libraries) in ${(info.ms / 1000).toFixed(1)} s.`);
          if ($("status-text").textContent === "Loading compiler…") setStatus("Ready");
        },
        (e) => {
          log.error("The compiler couldn't be loaded: " + e.message);
          setStatus("Compiler unavailable");
        },
      );
    }, 50);
  }
}

init();
