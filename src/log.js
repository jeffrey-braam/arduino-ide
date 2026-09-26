// The Output panel: timestamped build/upload messages.
export class OutputLog {
  constructor(pre) {
    this.pre = pre;
  }

  clear() {
    this.pre.textContent = "";
  }

  #add(text, cls) {
    const line = document.createElement("div");
    if (cls) line.className = cls;
    line.textContent = text;
    this.pre.appendChild(line);
    this.pre.scrollTop = this.pre.scrollHeight;
  }

  info(text) { this.#add(text); }
  muted(text) { this.#add(text, "muted"); }
  success(text) { this.#add(text, "success"); }
  warn(text) { this.#add(text, "warn"); }
  error(text) { this.#add(text, "error"); }
}
