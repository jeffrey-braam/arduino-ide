// Uploads a flash image to an Optiboot (STK500v1) bootloader, as used by the Arduino Uno. The
// protocol is in Rust (crates/core/src/stk500.rs); this file gives it the Web Serial port.
import { SerialRx, writeBytes } from "../serial/rx.js";
import { uploadStk500 as upload } from "#core";

export class UploadError extends Error {}

/**
 * @param {SerialPort} port  closed port; opened and closed here
 * @param {Uint8Array} image flash contents starting at address 0
 * @param {object} opts      board upload settings plus onProgress(fraction, phase) and log(message)
 */
export async function uploadStk500(port, image, opts) {
  const { onProgress = () => {}, log = () => {}, ...settings } = opts;
  let rx = null;
  const transport = {
    async open(baudRate) {
      await port.open({ baudRate });
      rx = new SerialRx(port);
    },
    async close() {
      if (rx) await rx.close();
      rx = null;
      await port.close().catch(() => {});
    },
    setSignals: (dtr, rts) => port.setSignals({ dataTerminalReady: dtr, requestToSend: rts }),
    write: (bytes) => writeBytes(port, bytes),
    read: async (n, timeoutMs) => {
      const r = await rx.read(n, timeoutMs);
      return r && Uint8Array.from(r);
    },
    clear: () => rx.clear(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    progress: onProgress,
    log,
  };
  try {
    return await upload(transport, image, settings);
  } catch (e) {
    throw e?.name === "UploadError" ? new UploadError(e.message) : e;
  }
}
