// The page's only uncompressed script: unpacks the app (src/app.js and everything it imports)
// and the Rust core's WebAssembly with a small Rust decoder (crates/boot), then runs the app.
import init, { unpack, unpackText } from "#boot";
import wasm from "#boot-wasm";

// Returns an embedded element's text and empties it so the large string can be freed.
function take(id) {
  const el = document.getElementById(id);
  const text = el.textContent;
  el.textContent = "";
  return text;
}

function fail(e) {
  const banner = document.getElementById("banner");
  banner.hidden = false;
  banner.classList.add("error");
  banner.textContent = "The IDE couldn't start (" + e.message + "). This file may be damaged: download it again.";
}

init({ module_or_path: wasm })
  .then(() => {
    globalThis.aideCoreWasm = unpack(take("core-pack")); // read by src/app.js
    const app = document.createElement("script");
    app.textContent = unpackText(take("app-pack"));
    document.body.append(app);
  })
  .catch(fail);
