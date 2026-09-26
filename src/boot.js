// The page's only uncompressed script: unpacks the app (src/main.js and everything it imports)
// and runs it.
import { unpackText } from "./embedded.js";

try {
  const app = document.createElement("script");
  app.textContent = unpackText("app-pack");
  document.body.append(app);
} catch (e) {
  const banner = document.getElementById("banner");
  banner.hidden = false;
  banner.classList.add("error");
  banner.textContent = "The IDE couldn't start (" + e.message + "). This file may be damaged: download it again.";
}
