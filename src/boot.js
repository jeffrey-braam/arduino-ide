// The page's only uncompressed script: unpacks the app (src/app.js and everything it imports)
// with a small Rust decoder (crates/boot) and runs it.
import init, { unpackText } from "#boot";
import wasm from "#boot-wasm";

function fail(e) {
  const banner = document.getElementById("banner");
  banner.hidden = false;
  banner.classList.add("error");
  banner.textContent = "The IDE couldn't start (" + e.message + "). This file may be damaged: download it again.";
}

init({ module_or_path: wasm })
  .then(() => {
    const pack = document.getElementById("app-pack");
    const app = document.createElement("script");
    app.textContent = unpackText(pack.textContent);
    pack.textContent = ""; // free the large string
    document.body.append(app);
  })
  .catch(fail);
