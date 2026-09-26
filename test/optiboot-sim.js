// A fake Web Serial port with an Uno's Optiboot bootloader behind it, including the quirks that
// matter for uploading: reset on DTR rising edge, a ~0.4 s LED blink during which the UART only
// holds 3 bytes, a 1 s listen window, and jumping to the sketch on a malformed command.
export class FakeOptibootPort {
  constructor(opts = {}) {
    this.opts = {
      baudRate: 115200,
      flashSize: 32768,
      blinkMs: 400,
      listenMs: 1000,
      latencyMs: 1,
      signature: [0x1e, 0x95, 0x0f],
      corruptWriteAt: -1, // flash address whose written byte gets flipped, to test verification
      ...opts,
    };
    this.flash = new Uint8Array(this.opts.flashSize).fill(0xff);
    this.state = "app"; // "blink" | "boot" | "app"
    this.dtr = false;
    this.inbox = [];
    this.addr = 0;
    this.readable = null;
    this.writable = null;
    this.resets = 0;
    this.pageWrites = 0;
  }

  getInfo() {
    return { usbVendorId: 0x2341, usbProductId: 0x0043 };
  }

  async open({ baudRate }) {
    if (this.readable) throw new DOMException("The port is already open.", "InvalidStateError");
    this.baud = baudRate;
    this.readable = new ReadableStream({
      start: (c) => {
        this.ctrl = c;
      },
      cancel: () => {
        this.ctrl = null;
      },
    });
    this.writable = new WritableStream({ write: (chunk) => this.#receive(chunk) });
    this.#setDtr(true); // opening a port raises DTR, which resets an Uno
  }

  async close() {
    if (!this.readable) throw new DOMException("The port is already closed.", "InvalidStateError");
    try {
      this.ctrl?.close();
    } catch {}
    this.ctrl = null;
    this.readable = null;
    this.writable = null;
    this.#setDtr(false);
  }

  async setSignals({ dataTerminalReady }) {
    if (dataTerminalReady !== undefined) this.#setDtr(dataTerminalReady);
  }

  #setDtr(on) {
    if (on && !this.dtr) this.#reset();
    this.dtr = on;
  }

  #reset() {
    this.resets++;
    clearTimeout(this.timer);
    this.state = "blink";
    this.inbox = [];
    this.timer = setTimeout(() => {
      this.state = "boot";
      this.#armListenTimeout();
      this.#process();
    }, this.opts.blinkMs);
  }

  #armListenTimeout() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => (this.state = "app"), this.opts.listenMs);
  }

  #receive(chunk) {
    if (this.baud !== this.opts.baudRate) return; // wrong baud: bootloader sees garbage, stays silent
    for (const b of chunk) {
      if (this.state === "blink" && this.inbox.length < 3) this.inbox.push(b); // rest overrun and are lost
      else if (this.state === "boot") this.inbox.push(b);
    }
    if (this.state === "boot") {
      this.#armListenTimeout();
      this.#process();
    }
  }

  #reply(bytes) {
    setTimeout(() => {
      try {
        this.ctrl?.enqueue(new Uint8Array(bytes));
      } catch {}
    }, this.opts.latencyMs);
  }

  #exitToSketch() {
    this.state = "app";
    this.inbox = [];
    clearTimeout(this.timer);
  }

  #process() {
    while (this.state === "boot" && this.inbox.length) {
      const q = this.inbox;
      const cmd = q[0];
      let len;
      if (cmd === 0x64 || cmd === 0x74) {
        if (q.length < 3) return;
        const n = (q[1] << 8) | q[2];
        len = cmd === 0x64 ? 5 + n : 5;
      } else {
        len = { 0x41: 3, 0x55: 4, 0x42: 22, 0x45: 7 }[cmd] ?? 2;
      }
      if (q.length < len) return;
      const c = q.splice(0, len);
      // Optiboot's verifySpace(): anything but CRC_EOP triggers a watchdog reset into the sketch.
      if (c[len - 1] !== 0x20) return this.#exitToSketch();

      switch (cmd) {
        case 0x41:
          this.#reply([0x14, c[1] === 0x81 ? 4 : c[1] === 0x82 ? 4 : 3, 0x10]);
          break;
        case 0x55:
          this.addr = (c[1] | (c[2] << 8)) * 2;
          this.#reply([0x14, 0x10]);
          break;
        case 0x64: {
          const n = (c[1] << 8) | c[2];
          const data = c.slice(4, 4 + n);
          const bad = this.opts.corruptWriteAt - this.addr;
          if (bad >= 0 && bad < n) data[bad] ^= 0xff;
          this.flash.set(data, this.addr);
          this.pageWrites++;
          this.#reply([0x14, 0x10]);
          break;
        }
        case 0x74: {
          const n = (c[1] << 8) | c[2];
          this.#reply([0x14, ...this.flash.subarray(this.addr, this.addr + n), 0x10]);
          break;
        }
        case 0x75:
          this.#reply([0x14, ...this.opts.signature, 0x10]);
          break;
        case 0x51:
          this.#reply([0x14, 0x10]);
          this.#exitToSketch();
          break;
        default:
          this.#reply([0x14, 0x10]);
      }
    }
  }
}
