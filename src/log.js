// The Output panel: timestamped build/upload messages. Compiler output is classified by the
// Rust core (crates/core/src/toolchain.rs).
import { outputLines } from "#core";

export class OutputLog {
  constructor(pre) {
    this.pre = pre;
  }

  #add(text, cls, onClick) {
    const line = document.createElement("div");
    if (cls) line.className = cls;
    line.textContent = text;
    if (onClick) {
      line.classList.add("link");
      line.title = "Click to go to this line";
      line.addEventListener("click", onClick);
    }
    this.pre.appendChild(line);
    this.pre.scrollTop = this.pre.scrollHeight;
  }

  // Compiler output: colours errors/warnings and makes messages about the sketch clickable.
  compilerOutput(text, { onLocation } = {}) {
    for (const l of outputLines(text)) this.#add(l.text, l.class, l.file && onLocation ? () => onLocation(l.file, l.line, l.column) : null);
  }

  info(text) { this.#add(text); }
  muted(text) { this.#add(text, "muted"); }
  success(text) { this.#add(text, "success"); }
  warn(text) { this.#add(text, "warn"); }
  error(text) { this.#add(text, "error"); }
}
