// Serial Monitor: reads text from the board and sends lines to it.
export const BAUD_RATES = [300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 74880, 115200, 230400, 250000];

const MAX_CHARS = 300000; // trim the oldest output beyond this to keep the page responsive
const TRIM_TO = 200000;

function timestamp() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)} -> `;
}

export class SerialMonitor extends EventTarget {
  constructor(ports, { out, settings }) {
    super();
    this.ports = ports;
    this.out = out;
    this.settings = settings; // { baud, timestamps, autoscroll } — read live
    this.text = document.createTextNode("");
    out.appendChild(this.text);
    this.port = null;
    this.reader = null;
    this.loop = null;
    this.pending = "";
    this.atLineStart = true;
    this.flushQueued = false;
    this.encoder = new TextEncoder();
  }

  get connected() {
    return this.port !== null;
  }

  async connect() {
    if (this.connected) return;
    const port = await this.ports.ensurePort();
    if (!port) return;
    try {
      await port.open({ baudRate: this.settings.baud });
    } catch (e) {
      this.#emit("error", "Couldn't open the port: " + e.message + ". Is another tab or app using it?");
      return;
    }
    this.port = port;
    this.decoder = new TextDecoder();
    this.loop = this.#readLoop();
    this.#emit("state");
  }

  async disconnect() {
    if (!this.connected) return;
    const port = this.port;
    try {
      await this.reader?.cancel();
    } catch {}
    await this.loop;
    try {
      await port.close();
    } catch {}
    this.port = null;
    this.#emit("state");
  }

  // Closes the port for an upload; resolves true if it was open so resume() can reopen it.
  async pause() {
    const was = this.connected;
    await this.disconnect();
    return was;
  }

  async resume() {
    await this.connect();
  }

  async reconnect() {
    if (!this.connected) return;
    await this.disconnect();
    await this.connect();
  }

  async send(line, ending) {
    if (!this.connected) return false;
    const w = this.port.writable.getWriter();
    try {
      await w.write(this.encoder.encode(line + ending));
    } finally {
      w.releaseLock();
    }
    return true;
  }

  clear() {
    this.text.data = "";
    this.atLineStart = true;
  }

  async #readLoop() {
    const port = this.port;
    let lastError = null;
    // Non-fatal errors (framing, overrun, break) leave port.readable set to a fresh stream,
    // so keep reading. A fatal error such as unplugging sets it to null.
    while (port.readable) {
      this.reader = port.readable.getReader();
      try {
        for (;;) {
          const { value, done } = await this.reader.read();
          if (done) return; // cancelled by disconnect()
          if (value) this.#append(this.decoder.decode(value, { stream: true }));
        }
      } catch (e) {
        lastError = e;
      } finally {
        this.reader.releaseLock();
        this.reader = null;
      }
    }
    this.#emit("error", "Serial connection lost" + (lastError ? ": " + lastError.message : "") + ".");
    this.port = null;
    try {
      await port.close();
    } catch {}
    this.#emit("state");
  }

  #append(chunk) {
    chunk = chunk.replace(/\r/g, ""); // println sends \r\n; the \r would show as a stray space
    if (this.settings.timestamps) {
      let out = "";
      for (const ch of chunk) {
        if (this.atLineStart) out += timestamp();
        out += ch;
        this.atLineStart = ch === "\n";
      }
      chunk = out;
    } else if (chunk) {
      this.atLineStart = chunk.endsWith("\n");
    }
    this.pending += chunk;
    if (!this.flushQueued) {
      this.flushQueued = true;
      requestAnimationFrame(() => this.#flush());
    }
  }

  #flush() {
    this.flushQueued = false;
    this.text.appendData(this.pending);
    this.pending = "";
    if (this.text.length > MAX_CHARS) this.text.deleteData(0, this.text.length - TRIM_TO);
    if (this.settings.autoscroll) this.out.scrollTop = this.out.scrollHeight;
  }

  #emit(type, message) {
    const e = new Event(type);
    e.message = message;
    this.dispatchEvent(e);
  }
}
