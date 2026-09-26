// Uploads a flash image to an Optiboot (STK500v1) bootloader, as used by the Arduino Uno.
import { SerialRx, writeBytes } from "../serial/rx.js";

const STK = {
  OK: 0x10,
  INSYNC: 0x14,
  CRC_EOP: 0x20,
  GET_SYNC: 0x30,
  ENTER_PROGMODE: 0x50,
  LEAVE_PROGMODE: 0x51,
  LOAD_ADDRESS: 0x55,
  PROG_PAGE: 0x64,
  READ_PAGE: 0x74,
  READ_SIGN: 0x75,
};
const FLASH = 0x46; // 'F'

export class UploadError extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex = (arr) => Array.from(arr, (b) => b.toString(16).padStart(2, "0").toUpperCase()).join(" ");

// The Uno resets when DTR goes from off to on (same sequence avrdude uses).
async function pulseReset(port) {
  await port.setSignals({ dataTerminalReady: false, requestToSend: false });
  await sleep(250);
  await port.setSignals({ dataTerminalReady: true, requestToSend: true });
  await sleep(50);
}

// After reset, Optiboot blinks the LED for ~0.4 s without reading serial, and its UART only
// buffers ~2 bytes. Two syncs queued during the blink overflow it; it then sees a stray byte
// where it expects CRC_EOP and jumps to the sketch. So wait out the blink, then send one sync at
// a time. Optiboot keeps listening for ~1 s after the blink, which fits all four tries.
async function sync(port, rx) {
  await sleep(450);
  for (let i = 0; i < 4; i++) {
    rx.clear();
    await writeBytes(port, [STK.GET_SYNC, STK.CRC_EOP]);
    const r = await rx.read(2, 300);
    if (r && r[0] === STK.INSYNC && r[1] === STK.OK) return true;
  }
  return false;
}

async function command(port, rx, bytes, replyLen, timeoutMs = 500) {
  rx.clear();
  const msg = new Uint8Array(bytes.length + 1);
  msg.set(bytes);
  msg[bytes.length] = STK.CRC_EOP;
  await writeBytes(port, msg);
  const r = await rx.read(replyLen + 2, timeoutMs);
  if (!r) throw new UploadError("The board stopped responding (command 0x" + hex([bytes[0]]) + ").");
  if (r[0] !== STK.INSYNC || r[r.length - 1] !== STK.OK)
    throw new UploadError("The board sent an unexpected reply: " + hex(r));
  return r.slice(1, -1);
}

/**
 * @param {SerialPort} port  closed port; opened and closed here
 * @param {Uint8Array} image flash contents starting at address 0
 * @param {object} opts      board upload settings plus callbacks
 */
export async function uploadStk500(port, image, opts) {
  const {
    baudRate = 115200,
    pageSize = 128,
    maxSize = 32256,
    signature = null,
    verify = true,
    onProgress = () => {},
    log = () => {},
  } = opts;

  if (image.length > maxSize)
    throw new UploadError(`Sketch is ${image.length} bytes, but this board only has room for ${maxSize}.`);

  const pages = [];
  for (let addr = 0; addr < image.length; addr += pageSize) {
    const data = new Uint8Array(pageSize).fill(0xff);
    data.set(image.subarray(addr, addr + pageSize));
    pages.push({ addr, data });
  }

  try {
    await port.open({ baudRate });
  } catch (e) {
    throw new UploadError("Couldn't open the port. Close the Serial Monitor or any other app or tab using the board. (" + e.message + ")");
  }

  let rx = null;
  try {
    rx = new SerialRx(port);
    let synced = false;
    for (let attempt = 1; attempt <= 3 && !synced; attempt++) {
      if (attempt > 1) log("No answer from the board, resetting again (try " + attempt + " of 3)…");
      await pulseReset(port);
      synced = await sync(port, rx);
    }
    if (!synced)
      throw new UploadError("The board didn't respond. Check the board and port selection, or unplug the board and plug it back in.");

    const sig = await command(port, rx, [STK.READ_SIGN], 3);
    if (signature && hex(sig) !== hex(signature))
      throw new UploadError(`Wrong chip: the board reports ${hex(sig)} but ${hex(signature)} was expected. Check the board selection.`);

    await command(port, rx, [STK.ENTER_PROGMODE], 0);

    const steps = pages.length * (verify ? 2 : 1);
    let done = 0;
    const loadAddress = (addr) => command(port, rx, [STK.LOAD_ADDRESS, (addr >> 1) & 0xff, (addr >> 9) & 0xff], 0);

    for (const p of pages) {
      await loadAddress(p.addr);
      await command(port, rx, [STK.PROG_PAGE, pageSize >> 8, pageSize & 0xff, FLASH, ...p.data], 0, 1000);
      onProgress(++done / steps, "Writing");
    }

    if (verify) {
      for (const p of pages) {
        await loadAddress(p.addr);
        const back = await command(port, rx, [STK.READ_PAGE, pageSize >> 8, pageSize & 0xff, FLASH], pageSize, 1000);
        for (let i = 0; i < pageSize; i++) {
          if (back[i] !== p.data[i]) {
            const at = (p.addr + i).toString(16).padStart(4, "0");
            throw new UploadError(`Verification failed at address 0x${at}: wrote ${hex([p.data[i]])}, read ${hex([back[i]])}.`);
          }
        }
        onProgress(++done / steps, "Verifying");
      }
    }

    // Optiboot restarts into the new sketch after this.
    await command(port, rx, [STK.LEAVE_PROGMODE], 0).catch(() => {});
    return { bytes: image.length, pages: pages.length };
  } finally {
    if (rx) await rx.close();
    await port.close().catch(() => {});
  }
}
