# Arduino IDE (offline, single file)

A lightweight Arduino IDE that runs from one downloaded HTML file in Chrome/Edge — including
locked-down school Chromebooks — with no install and no network access. See `details.md` for goals.

**Status:** editor with tabs, autosave, open/save, examples and libraries browser, About/licenses,
in-browser compiling (Verify/Upload), Serial Monitor, Serial Plotter and upload to an Uno all work. The page's Content-Security-Policy blocks all network access.

The IDE's logic is written in Rust (`crates/`) and runs in the page as WebAssembly: sketch
preprocessing, the compile pipeline, the Uno uploader, the data formats, and the build tool.
JavaScript is left only where the browser requires it: the CodeMirror editor, the page's UI,
Web Serial, and running the Emscripten-built GCC tools.

## Build

Needs [Rust](https://rustup.rs) with the `wasm32-unknown-unknown` target, the
[wasm-bindgen CLI](https://github.com/wasm-bindgen/wasm-bindgen/releases) at the version pinned in
`crates/wasm/Cargo.toml`, Node.js (for esbuild, CodeMirror and running the GCC tools),
[arduino-cli](https://arduino.github.io/arduino-cli/) and `xz` (XZ Utils; Git for Windows includes
it, or set `XZ` to its path), only on the machine that builds the file; students just get the HTML. The WebAssembly compiler tools are committed in `toolchain/out/`; to rebuild them from source, see `toolchain/README.md` (Linux/WSL).

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.129   # or download the prebuilt release
npm install
arduino-cli core install arduino:avr@1.8.8
arduino-cli lib install OneWire DallasTemperature "DHT sensor library" "Adafruit Unified Sensor" \
  IRremote "PulseSensor Playground" Encoder Servo LiquidCrystal CapacitiveSensor
cargo aide wasm                   # Rust core -> WebAssembly (build/cache/wasm/)
cargo aide prepare-compiler       # precompiles core + libraries -> build/cache/compiler-pack.bin.lzma
cargo aide prepare-examples       # built-in + library examples that compile for the Uno
cargo aide build                  # -> dist/arduino-ide.html (~5 MB, the only file students need)
```

`cargo aide build --watch` rebuilds on changes. The bundled libraries are listed in
`crates/build/src/prepare_compiler.rs` (`LIBRARIES`).

## Test

```sh
cargo test --workspace             # Rust unit tests: preprocessor, uploader (simulated board), formats, build tool
npm test                           # the above, plus the real compiler and the upload path in Node
node test/compiler/compare.mjs     # every library example: browser compiler vs arduino-cli
node test/compiler/asm-compare.mjs # browser cc1plus vs Arduino's native avr-g++: identical assembly
node test/ui/examples-tabs.mjs     # the built page: examples, libraries, tabs, autosave, About
node test/ui/plotter.mjs           # Serial Plotter and Serial Monitor with a simulated board
node test/hardware/e2e.mjs COM3    # real Uno: uploads, compiles in the page, serial monitor
```

The hardware test **overwrites the sketch on the board**. It bridges `navigator.serial` to the COM
port via node-serialport, because automated browsers can't click through Chrome's port chooser.

`probe/chromebook-test.html` is a standalone compatibility check to run on a student Chromebook.

## For students

`docs/student-guide.pdf` is a one-page guide to share with the IDE (regenerate it from
`docs/student-guide.html` with `node build/make-guide.mjs`). `examples/SensorKit/` has a starter
sketch for each module of the 37-in-1 sensor kit, named by the HW- number printed on the board
(`kit-inventory.md` and `arduino-sensor-libraries.md` give the matching KY- numbers); they appear
first in the Examples browser. `docs/getting-started-with-arduino.docx` is a longer handout on what
an Arduino is, how it works, and what the kit's modules can do.

## How compiling works

The page embeds GCC 7.3.0 with Arduino's patches (`cc1plus`) and GNU binutils 2.42 (`as`, `ld`,
`objcopy`), built from source to WebAssembly by `toolchain/build.sh`, plus headers and the Arduino core/libraries precompiled with the matching native
avr-gcc. A worker runs cc1plus → as → ld → objcopy on the sketch; `.ino` files get Arduino-style
prototypes and `#include <Arduino.h>` (`crates/core/src/preprocess.rs`). The Rust core decides what
to run (`crates/core/src/toolchain.rs`); `src/compiler/toolchain.js` only starts the Emscripten tools for it. Output is ~10% larger than
the Arduino IDE's because link-time optimisation isn't available.

To keep the file small, everything but a tiny boot script is stored LZMA-compressed (`xz --format=lzma`,
decoded by `crates/core/src/lzma.rs`) and written into the page as 7-bit text rather than base64
(`crates/core/src/embed.rs`): the app (JavaScript plus the Rust core's WebAssembly), the compiler
pack, the examples and the About data. The boot script carries a 30 KB WebAssembly decoder
(`crates/boot`) that unpacks the app.

## Licenses

GCC and binutils are GPL-3.0-or-later (GMP/MPFR/MPC: LGPL-3.0-or-later). Anyone distributing the
built HTML must also offer the corresponding source: the tarballs and patch listed in
`toolchain/out/SOURCES.md`, plus `toolchain/build.sh`.
The Arduino core and avr-libc are LGPL/BSD; bundled libraries keep their own licenses. The Rust
crates compiled into the page are MIT/Apache-2.0; the About tab lists them with the npm packages.

## Layout

- `crates/core/` — the IDE's logic in Rust: `preprocess.rs`, `toolchain.rs` (compile pipeline),
  `stk500.rs` (Uno uploader), `intelhex.rs`, `elf.rs`, `pack.rs`, `lzma.rs`, `embed.rs`,
  `monitor.rs`, `plotter.rs`, `sketch.rs`, `ports.rs`
- `crates/wasm/`, `crates/boot/` — the core's WebAssembly bindings for the page; the boot decoder
- `crates/build/` — the build tool (`cargo aide …`): page bundle, compiler pack, examples
- `src/` — browser glue in JavaScript (`main.js` wires the UI; `editor.js` is CodeMirror;
  `compiler/` runs the GCC tools in a worker; `upload/stk500.js` and `serial/` connect Web Serial;
  `monitor.js` and `plotter.js` are the Serial Monitor and Plotter)
- `build/` — Node helpers: `node-toolchain.mjs` (the compiler in Node), `check-examples.mjs`,
  `make-guide.mjs` (student guide PDF)
- `toolchain/` — `build.sh` builds GCC/binutils to WebAssembly from source; results in `out/`
- `test/` — compiler and upload tests in Node, Optiboot simulator, sketches, compiler comparisons,
  UI and hardware tests
