// Entry point of the app bundle: loads the Rust core, then starts the IDE.
import wasm from "#core-wasm";
import { loadCore } from "./core.js";

loadCore(wasm)
  .then(() => import("./main.js"))
  .catch((e) => {
    const banner = document.getElementById("banner");
    banner.hidden = false;
    banner.classList.add("error");
    banner.textContent = "The IDE couldn't start (" + e.message + "). Try reloading the page, or download the file again.";
  });
