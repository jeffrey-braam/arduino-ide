// Tracks which Web Serial port the IDE uses, following plug/unplug events.
const VENDORS = {
  0x2341: "Arduino",
  0x2a03: "Arduino",
  0x1a86: "CH340 USB serial",
  0x0403: "FTDI USB serial",
  0x10c4: "CP210x USB serial",
  0x067b: "PL2303 USB serial",
};
const PRODUCTS = {
  "2341:0043": "Arduino Uno",
  "2341:0001": "Arduino Uno",
  "2a03:0043": "Arduino Uno",
  "2341:0243": "Arduino Uno",
};

const hex4 = (n) => n.toString(16).padStart(4, "0");

export function describePort(port) {
  if (!port) return "No port selected";
  const { usbVendorId: vid, usbProductId: pid } = port.getInfo();
  if (vid === undefined) return "Serial port";
  const id = hex4(vid) + ":" + hex4(pid ?? 0);
  return (PRODUCTS[id] || VENDORS[vid] || "USB serial device") + " (" + id + ")";
}

export class PortManager extends EventTarget {
  port = null;

  get supported() {
    return typeof navigator !== "undefined" && "serial" in navigator;
  }

  get label() {
    return describePort(this.port);
  }

  async init() {
    if (!this.supported) return;
    navigator.serial.addEventListener("connect", (e) => {
      if (!this.port) this.#select(e.target);
    });
    navigator.serial.addEventListener("disconnect", (e) => {
      if (e.target === this.port) {
        this.port = null;
        this.#emit("lost");
      }
    });
    try {
      const ports = await navigator.serial.getPorts();
      if (ports.length) this.#select(ports[ports.length - 1]);
    } catch {}
  }

  // Shows Chrome's port chooser. Resolves with the port, or null if the user cancelled.
  async request() {
    try {
      const port = await navigator.serial.requestPort();
      this.#select(port);
      return port;
    } catch (e) {
      if (e && e.name === "NotFoundError") return null;
      throw e;
    }
  }

  async ensurePort() {
    return this.port || this.request();
  }

  #select(port) {
    this.port = port;
    this.#emit("change");
  }

  #emit(type) {
    this.dispatchEvent(new Event(type));
    if (type !== "change") this.dispatchEvent(new Event("change"));
  }
}
