import { createEditor } from "./editor.js";
import { PortManager } from "./serial/ports.js";
import { SerialMonitor, BAUD_RATES } from "./monitor.js";
import { uploadStk500 } from "./upload/stk500.js";
import { parseIntelHex } from "./upload/intelhex.js";
import { BOARDS, DEFAULT_BOARD } from "./boards.js";
import { OutputLog } from "./log.js";
import * as storage from "./storage.js";
import * as files from "./files.js";
import { compilerAvailable, compile } from "./compiler.js";

const $ = (id) => document.getElementById(id);

const DEFAULT_CODE = `void setup() {
  // put your setup code here, to run once:

}

void loop() {
  // put your main code here, to run repeatedly:

}
`;

function newSketchName() {
  const d = new Date();
  return "sketch_" + d.toLocaleString("en", { month: "short" }).toLowerCase() + d.getDate() + ".ino";
}

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

const restored = storage.loadSketch();
const sketch = {
  name: restored?.name || newSketchName(),
  code: restored?.code ?? DEFAULT_CODE,
  savedCode: restored?.savedCode ?? DEFAULT_CODE, // last version written to a file, for the unsaved marker
  handle: null, // file handle for Save; not persisted across reloads
};

let busy = false;
const log = new OutputLog($("output"));
const ports = new PortManager();
const monitor = new SerialMonitor(ports, { out: $("mon-out"), settings });

// ---------- Editor & autosave ----------
let autosaveTimer = 0;
function autosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    storage.saveSketch({ name: sketch.name, code: sketch.code, savedCode: sketch.savedCode });
  }, 400);
}

function renderName() {
  const el = $("sketch-name");
  el.textContent = sketch.name;
  el.classList.toggle("dirty", sketch.code !== sketch.savedCode);
  document.title = sketch.name + " — Arduino IDE";
}

const editor = createEditor($("editor"), {
  doc: sketch.code,
  onChange(text) {
    sketch.code = text;
    renderName();
    autosave();
  },
});

function loadIntoEditor({ name, code, handle }) {
  sketch.name = name;
  sketch.code = code;
  sketch.savedCode = code;
  sketch.handle = handle;
  editor.setText(code);
  renderName();
  autosave();
  editor.focus();
}

const isDirty = () => sketch.code !== sketch.savedCode;
const confirmDiscard = () => !isDirty() || confirm(`“${sketch.name}” has unsaved changes. Discard them?`);

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

const actions = {
  newSketch: () =>
    runFileAction(async () => {
      if (!confirmDiscard()) return;
      loadIntoEditor({ name: newSketchName(), code: DEFAULT_CODE, handle: null });
      setStatus("New sketch");
    }),

  open: () =>
    runFileAction(async () => {
      if (!confirmDiscard()) return;
      const f = await files.openSketchFile();
      if (!f) return;
      loadIntoEditor({ name: f.name, code: f.text, handle: f.handle });
      setStatus("Opened " + f.name);
    }),

  save: () =>
    runFileAction(async () => {
      if (!sketch.handle) return actions.saveAs();
      const code = sketch.code;
      await files.writeToHandle(sketch.handle, code);
      sketch.savedCode = code;
      renderName();
      autosave();
      setStatus("Saved " + sketch.name);
    }),

  saveAs: () =>
    runFileAction(async () => {
      const code = sketch.code;
      const suggested = /\.\w+$/.test(sketch.name) ? sketch.name : sketch.name + ".ino";
      const r = await files.saveAs(suggested, code);
      if (!r) return;
      sketch.name = r.name;
      sketch.handle = r.handle;
      sketch.savedCode = code;
      renderName();
      autosave();
      setStatus(r.handle ? "Saved " + r.name : "Downloaded " + r.name);
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
    showTab("output");
    if (!compilerAvailable) return log.warn("Compiling isn't included in this version yet. Use “Upload .hex” to upload an already-compiled sketch.");
    setBusy(true);
    try {
      await compile(sketch.code, BOARDS[settings.board]);
    } catch (e) {
      log.error(e.message);
    } finally {
      setBusy(false);
    }
  },

  async upload() {
    if (busy) return;
    showTab("output");
    if (!compilerAvailable) return log.warn("Compiling isn't included in this version yet. Use “Upload .hex” to upload an already-compiled sketch.");
    let image;
    setBusy(true);
    try {
      image = (await compile(sketch.code, BOARDS[settings.board])).image;
    } catch (e) {
      log.error(e.message);
      return;
    } finally {
      setBusy(false);
    }
    await uploadImage(image, sketch.name);
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
  $("status-version").title = "Built " + __BUILD_DATE__;

  $("btn-new").addEventListener("click", actions.newSketch);
  $("btn-open").addEventListener("click", actions.open);
  $("btn-save").addEventListener("click", actions.save);
  $("btn-saveas").addEventListener("click", actions.saveAs);
  $("btn-verify").addEventListener("click", actions.verify);
  $("btn-upload").addEventListener("click", actions.upload);
  $("btn-upload-hex").addEventListener("click", actions.uploadHex);
  $("btn-port").addEventListener("click", actions.selectPort);
  for (const b of document.querySelectorAll(".tabs button")) b.addEventListener("click", () => showTab(b.dataset.tab));

  setupMonitorUi();
  setupSplitter();
  setupShortcuts();
  renderName();
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
}

init();
