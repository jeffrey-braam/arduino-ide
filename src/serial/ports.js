// Tracks which Web Serial port the IDE uses, following plug/unplug events.
import { describePort as describeUsb } from "#core";

export function describePort(port) {
  if (!port) return "No port selected";
  const { usbVendorId, usbProductId } = port.getInfo();
  return describeUsb(usbVendorId, usbProductId);
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
