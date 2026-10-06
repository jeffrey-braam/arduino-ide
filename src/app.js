// Entry point of the app bundle: loads the Rust core (unpacked by src/boot.js), then starts the IDE.
import { loadCore } from "./core.js";

const wasm = globalThis.aideCoreWasm;
delete globalThis.aideCoreWasm;

loadCore(wasm)
  .then(() => import("./main.js"))
  .catch((e) => {
    const banner = document.getElementById("banner");
    banner.hidden = false;
    banner.classList.add("error");
    banner.textContent = "The IDE couldn't start (" + e.message + "). Try reloading the page, or download the file again.";
  });
