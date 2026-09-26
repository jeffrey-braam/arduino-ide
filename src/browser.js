// The Examples & Libraries dialog. Its data (built-in examples, bundled libraries and their
// examples) is embedded in the page as compressed JSON and unpacked the first time it's opened.
import { unpackText } from "./embedded.js";

const $ = (id) => document.getElementById(id);
export const browserAvailable = Boolean(document.getElementById("examples-pack"));

const unpackJson = async (id) => JSON.parse(unpackText(id));
let dataPromise = null;
function loadData() {
  dataPromise ??= browserAvailable ? unpackJson("examples-pack") : Promise.resolve({ builtin: [], libraries: [] });
  return dataPromise;
}
let aboutPromise = null;
const loadAbout = () => (aboutPromise ??= unpackJson("about-pack"));

// "A <a@x>, B, C, D" -> "A, B, C and others" (e-mail addresses dropped)
function shortAuthors(text) {
  const names = text.replace(/\s*<[^>]*>/g, "").split(",").map((s) => s.trim()).filter(Boolean);
  return names.length > 3 ? names.slice(0, 3).join(", ") + " and others" : names.join(", ");
}

const el = (tag, props = {}, children = []) => {
  const e = Object.assign(document.createElement(tag), props);
  for (const c of [].concat(children)) e.append(c);
  return e;
};

/**
 * @param {{ onOpenExample: (example: { name: string, files: {name, code}[] }, where: string) => void,
 *           onInclude: (library: object) => void }} handlers
 */
export function setupBrowser({ onOpenExample, onInclude }) {
  const dialog = $("browser");
  const search = $("browser-search");
  const list = $("example-list");
  const libList = $("library-list");
  let data = null;
  let view = "examples";
  const entries = []; // { example, where, item, group, text }
  let selected = null;
  let previewFile = 0;

  function setView(v) {
    view = v;
    for (const b of dialog.querySelectorAll("[data-view]")) b.setAttribute("aria-selected", String(b.dataset.view === v));
    $("browser-examples").hidden = v !== "examples";
    $("browser-libraries").hidden = v !== "libraries";
    $("browser-about").hidden = v !== "about";
    search.hidden = v === "about";
    search.placeholder = v === "examples" ? "Search examples" : "Search libraries";
    applySearch();
  }

  // ---------- Examples ----------
  function renderExamples() {
    const addGroup = (label, examples, where, open) => {
      const items = el("div", { className: "group-items" });
      const group = el("details", { className: "ex-group", open }, [el("summary", { textContent: `${label} (${examples.length})` }), items]);
      for (const example of examples) {
        const item = el("button", { type: "button", className: "ex-item", textContent: example.name.split("/").pop(), title: example.name });
        const entry = { example, where, item, group, text: (example.name + " " + label).toLowerCase() };
        item.addEventListener("click", () => select(entry));
        item.addEventListener("dblclick", () => openEntry(entry));
        item.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            openEntry(entry);
          }
        });
        entries.push(entry);
        items.append(item);
      }
      return group;
    };

    list.replaceChildren();
    const kit = data.kit || [];
    if (kit.length) {
      list.append(el("h3", { className: "list-heading", textContent: "Sensor kit" }));
      for (const c of kit) list.append(addGroup(c.category, c.examples, `Sensor kit · ${c.category}`, true));
    }
    list.append(el("h3", { className: "list-heading", textContent: "Built-in examples" }));
    data.builtin.forEach((c, i) => list.append(addGroup(c.category, c.examples, `Built-in · ${c.category}`, !kit.length && i === 0)));
    list.append(el("h3", { className: "list-heading", textContent: "Library examples" }));
    for (const lib of data.libraries.filter((l) => l.examples.length))
      list.append(addGroup(lib.displayName, lib.examples, `${lib.displayName} library`, false));
    list.append(el("p", { className: "muted no-results", id: "examples-empty", hidden: true, textContent: "No examples match." }));
    select(entries[0]);
  }

  function select(entry) {
    if (!entry) return;
    selected?.item.classList.remove("selected");
    selected = entry;
    entry.item.classList.add("selected");
    previewFile = 0;
    renderPreview();
  }

  function renderPreview() {
    const { example, where } = selected;
    $("example-title").textContent = example.name.split("/").pop();
    $("example-where").textContent = where;
    const tabs = $("example-files");
    tabs.replaceChildren(
      ...example.files.map((f, i) => {
        const b = el("button", { type: "button", className: "file-chip", textContent: f.name });
        b.setAttribute("aria-pressed", String(i === previewFile));
        b.addEventListener("click", () => {
          previewFile = i;
          renderPreview();
        });
        return b;
      }),
    );
    tabs.hidden = example.files.length < 2;
    $("example-code").textContent = example.files[previewFile].code;
    $("example-code").scrollTop = 0;
  }

  function openEntry(entry) {
    dialog.close();
    onOpenExample(entry.example, entry.where);
  }

  // ---------- Libraries ----------
  function renderLibraries() {
    libList.replaceChildren(
      ...data.libraries.map((lib) => {
        const include = el("button", { type: "button", className: "primary", textContent: "Include" });
        include.title = "Add " + lib.includes.map((h) => `#include <${h}>`).join(", ") + " to the sketch";
        include.addEventListener("click", () => {
          dialog.close();
          onInclude(lib);
        });
        const actions = [include];
        if (lib.examples.length) {
          const ex = el("button", { type: "button", textContent: `Examples (${lib.examples.length})` });
          ex.addEventListener("click", () => {
            search.value = lib.displayName;
            setView("examples");
            const first = entries.find((e) => e.where === `${lib.displayName} library`);
            if (first) select(first);
          });
          actions.push(ex);
        }
        const card = el("article", { className: "lib-card" }, [
          el("h3", {}, [lib.displayName, el("span", { className: "lib-version", textContent: " " + lib.version })]),
          lib.author ? el("p", { className: "lib-author", textContent: "by " + shortAuthors(lib.author) }) : "",
          el("p", { textContent: lib.sentence }),
          el("p", { className: "lib-headers", textContent: lib.includes.map((h) => `#include <${h}>`).join("  ") }),
          el("div", { className: "lib-actions" }, actions),
        ]);
        card.dataset.search = [lib.displayName, lib.sentence, lib.paragraph, lib.author, ...lib.includes].join(" ").toLowerCase();
        return card;
      }),
      el("p", { className: "muted no-results", id: "libraries-empty", hidden: true, textContent: "No libraries match." }),
    );
  }

  let aboutRendered = false;

  // ---------- Search ----------
  function applySearch() {
    if (!data || view === "about") return;
    const terms = search.value.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = (text) => terms.every((t) => text.includes(t));
    if (view === "examples") {
      const shown = new Set();
      for (const e of entries) {
        const ok = matches(e.text);
        e.item.hidden = !ok;
        if (ok) shown.add(e.group);
      }
      for (const g of list.querySelectorAll(".ex-group")) {
        g.hidden = !shown.has(g);
        if (terms.length && shown.has(g)) g.open = true;
      }
      $("examples-empty").hidden = shown.size > 0;
      if (selected?.item.hidden) select(entries.find((e) => !e.item.hidden));
    } else {
      let any = false;
      for (const card of libList.querySelectorAll(".lib-card")) {
        card.hidden = !matches(card.dataset.search);
        any ||= !card.hidden;
      }
      $("libraries-empty").hidden = any;
    }
  }

  // ---------- Wiring ----------
  // The views list different things, so switching starts a fresh search.
  for (const b of dialog.querySelectorAll("[data-view]"))
    b.addEventListener("click", () => {
      search.value = "";
      setView(b.dataset.view);
    });
  search.addEventListener("input", applySearch);
  $("browser-close").addEventListener("click", () => dialog.close());
  $("example-open").addEventListener("click", () => selected && openEntry(selected));
  // Clicking the dimmed backdrop (the dialog element itself, outside its content) closes it.
  dialog.addEventListener("click", (e) => e.target === dialog && dialog.close());

  return {
    async open(v = "examples") {
      dialog.showModal();
      search.value = "";
      setView(v);
      if (v === "about") $("browser-close").focus();
      else search.focus();
      if (!data) {
        $("example-code").textContent = "Loading…";
        data = await loadData();
        renderExamples();
        renderLibraries();
        applySearch();
      }
      if (v === "about" && !aboutRendered) {
        aboutRendered = true;
        renderAbout($("browser-about"), await loadAbout(), data.libraries);
      }
    },
  };
}

// ---------- About ----------
// One collapsible entry per component; the license texts are only put in the page when opened.
function licenseEntry({ name, version, license, use, note, texts }) {
  const details = el("details", { className: "license-entry" }, [
    el("summary", {}, [
      el("span", { className: "lic-name", textContent: name }),
      version ? el("span", { className: "lic-version", textContent: version }) : "",
      el("span", { className: "lic-license", textContent: license }),
    ]),
  ]);
  details.addEventListener(
    "toggle",
    () => {
      const body = [];
      if (use) body.push(el("p", { textContent: use }));
      if (note) body.push(el("p", { className: "muted", textContent: note }));
      for (const t of texts) body.push(el("h4", { textContent: t.title }), el("pre", { className: "license-text", textContent: t.text }));
      details.append(el("div", { className: "license-body" }, body));
    },
    { once: true },
  );
  return details;
}

function renderAbout(root, about, libraries) {
  const shared = (ids) => ids.map((id) => about.texts[id]).filter(Boolean);
  const section = (title, intro, entries) =>
    el("section", { className: "about-section" }, [el("h3", { textContent: title }), intro ? el("p", { className: "muted", textContent: intro }) : "", ...entries]);

  root.replaceChildren(
    el("header", { className: "about-head" }, [
      el("h2", { textContent: "Arduino IDE (offline)" }),
      el("p", { className: "muted", textContent: `Version ${about.app.version}, built ${about.app.date}` }),
      el("p", {
        textContent:
          "Everything runs inside this browser tab: the editor, the compiler and the uploader. The page is locked so it can't contact the internet; nothing you write leaves this computer.",
      }),
    ]),
    el("section", { className: "about-section gpl-notice" }, [
      el("h3", { textContent: "Free software and your right to the source code" }),
      el("p", {
        textContent:
          "This IDE includes the GNU Compiler Collection (GCC) and GNU binutils. They are free software, released under the GNU General Public License, version 3 (GPL): you may use, study, share and change them. " +
          "Whoever gives you a copy of this file must also make the complete source code of those programs available to you. The exact sources it was built from are listed below. To get a copy, ask the person who gave you this file (for example, your teacher).",
      }),
      el("p", { textContent: "The other parts of the IDE, and their licenses, are listed below. Open any entry to read its full license." }),
      about.compilerSources
        ? el("details", { className: "license-entry" }, [
            el("summary", {}, [el("span", { className: "lic-name", textContent: "Exact sources of the compiler tools" })]),
            el("div", { className: "license-body" }, [el("pre", { className: "license-text", textContent: about.compilerSources })]),
          ])
        : "",
    ]),
    section(
      "Compiler and Arduino core",
      "",
      about.components.map((c) => licenseEntry({ name: c.name, version: c.version, license: c.license, use: c.use, note: c.note, texts: shared(c.texts) })),
    ),
    section(
      "Arduino libraries",
      libraries.length ? "" : "Library details aren't included in this copy of the IDE.",
      libraries.map((l) =>
        licenseEntry({
          name: l.displayName,
          version: l.version,
          license: l.license,
          use: [l.sentence, l.author ? "By " + l.author.replace(/\s*<[^>]*>/g, "") : ""].filter(Boolean).join(" "),
          note: l.licenseNote,
          texts: [...l.licenseTexts, ...shared(l.sharedTexts)],
        }),
      ),
    ),
    section(
      "Code editor",
      "The editor is CodeMirror 6 and the small packages it's built from.",
      about.packages.map((p) => licenseEntry({ name: p.name, version: p.version, license: p.license, texts: [{ title: "License", text: p.text }] })),
    ),
  );
}
