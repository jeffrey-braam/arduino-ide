# Arduino IDE (offline, single file)

A lightweight Arduino IDE that runs from one downloaded HTML file in Chrome/Edge — including
locked-down school Chromebooks — with no install and no network access. See `details.md` for goals.

**Status:** editor, autosave, open/save, in-browser compiling (Verify/Upload), serial monitor and
upload to an Uno all work. The page's Content-Security-Policy blocks all network access.

## Build

Needs Node.js and [arduino-cli](https://arduino.github.io/arduino-cli/) (only on the machine that
builds the file; students just get the HTML).

```sh
npm install
arduino-cli core install arduino:avr@1.8.8
arduino-cli lib install OneWire DallasTemperature "DHT sensor library" "Adafruit Unified Sensor" \
  IRremote "PulseSensor Playground" Encoder Servo
node build/prepare-compiler.mjs   # precompiles core + libraries -> build/cache/compiler-pack.bin.gz
npm run build                     # -> dist/arduino-ide.html (~8.5 MB, the only file students need)
```

The bundled libraries are listed in `build/prepare-compiler.mjs` (`LIBRARIES`).

## Test

```sh
npm test                           # unit tests: preprocessor, compiler, hex parser, uploader
node test/compiler/compare.mjs     # every library example: browser compiler vs arduino-cli
node test/hardware/e2e.mjs COM3    # real Uno: uploads, compiles in the page, serial monitor
```

The hardware test **overwrites the sketch on the board**. It bridges `navigator.serial` to the COM
port via node-serialport, because automated browsers can't click through Chrome's port chooser.

`probe/chromebook-test.html` is a standalone compatibility check to run on a student Chromebook.

## How compiling works

The page embeds GCC 7.3.0 (`cc1plus`) and GNU binutils (`as`, `ld`, `objcopy`) compiled to
WebAssembly, plus headers and the Arduino core/libraries precompiled with the matching native
avr-gcc. A worker runs cc1plus → as → ld → objcopy on the sketch; `.ino` files get Arduino-style
prototypes and `#include <Arduino.h>` (`src/compiler/preprocess.js`). Output is ~10% larger than
the Arduino IDE's because link-time optimisation isn't available.

## Licenses

The WebAssembly tools come from `@horang-corp/avr-gcc-wasm` (GCC and binutils, GPL-3.0). Anyone
distributing the built HTML must also make the corresponding GCC/binutils source available.
The Arduino core and avr-libc are LGPL/BSD; bundled libraries keep their own licenses.

## Layout

- `src/` — app (`main.js` wires the UI; `compiler/` is the in-browser toolchain;
  `upload/stk500.js` is the Uno uploader; `serial/` handles ports; `monitor.js` is the Serial Monitor)
- `build/` — `prepare-compiler.mjs` (compiler pack) and `build.mjs` (single-file bundle)
- `test/` — unit tests, Optiboot simulator, sketches, compiler comparison, hardware test
