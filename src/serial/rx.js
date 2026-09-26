// Buffers bytes from a SerialPort's readable stream so callers can await exact byte counts.
export class SerialRx {
  constructor(port) {
    this.buf = [];
    this.waiters = [];
    this.error = null;
    this.reader = port.readable.getReader();
    this.done = this.#loop();
  }

  async #loop() {
    try {
      for (;;) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value && value.length) {
          for (const b of value) this.buf.push(b);
          this.#wake();
        }
      }
    } catch (e) {
      this.error = e;
    } finally {
      this.reader.releaseLock();
      this.#wake();
    }
  }

  #wake() {
    const w = this.waiters;
    this.waiters = [];
    w.forEach((f) => f());
  }

  clear() {
    this.buf.length = 0;
  }

  // Resolves with exactly n bytes, or null if they don't arrive within timeoutMs.
  async read(n, timeoutMs) {
    const deadline = performance.now() + timeoutMs;
    while (this.buf.length < n) {
      if (this.error) throw this.error;
      const left = deadline - performance.now();
      if (left <= 0) return null;
      await new Promise((resolve) => {
        const t = setTimeout(resolve, left);
        this.waiters.push(() => {
          clearTimeout(t);
          resolve();
        });
      });
    }
    return this.buf.splice(0, n);
  }

  async close() {
    try {
      await this.reader.cancel();
    } catch {}
    await this.done;
  }
}

export async function writeBytes(port, bytes) {
  const w = port.writable.getWriter();
  try {
    await w.write(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  } finally {
    w.releaseLock();
  }
}
