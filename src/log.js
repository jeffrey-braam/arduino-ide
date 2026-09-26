// The Output panel: timestamped build/upload messages.
export class OutputLog {
  constructor(pre) {
    this.pre = pre;
  }

  clear() {
    this.pre.textContent = "";
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
    for (const raw of text.split("\n")) {
      if (!raw.trim()) continue;
      const line = raw.replace(/\/build\/sketch\//g, "");
      const m = line.match(/^([^:\s]+):(\d+):(\d+): (fatal error|error|warning|note):/);
      const kind = m?.[4] || "";
      const cls = kind.endsWith("error") ? "error" : kind === "warning" ? "warn" : "muted";
      this.#add(line, cls, m && onLocation ? () => onLocation(m[1], +m[2], +m[3]) : null);
    }
  }

  info(text) { this.#add(text); }
  muted(text) { this.#add(text, "muted"); }
  success(text) { this.#add(text, "success"); }
  warn(text) { this.#add(text, "warn"); }
  error(text) { this.#add(text, "error"); }
}
