# Arduino IDE (offline, single file)

A lightweight Arduino IDE that runs from one downloaded HTML file in Chrome/Edge — including
locked-down school Chromebooks — with no install and no network access. See `details.md` for goals.

**Status:** editor, autosave, open/save, serial monitor and `.hex` upload to an Uno work.
Compiling in the browser is not built yet.

## Build

```sh
npm install
npm run build        # -> dist/arduino-ide.html (the only file students need)
npm run watch        # rebuild on change
```

## Test

```sh
npm test                          # unit tests (hex parser, uploader against a simulated Optiboot)
node test/hardware/e2e.mjs COM3   # real Uno: uploads test sketches and checks the serial monitor
```

The hardware test **overwrites the sketch on the board**. It bridges `navigator.serial` to the COM
port via node-serialport, because automated browsers can't click through Chrome's port chooser.

`probe/chromebook-test.html` is a standalone compatibility check to run on a student Chromebook.

## Layout

- `src/` — app source (`main.js` wires the UI; `upload/stk500.js` is the Uno uploader;
  `serial/` handles ports; `monitor.js` is the Serial Monitor)
- `build/build.mjs` — bundles everything into one HTML file with esbuild
- `test/` — unit tests, Optiboot simulator, fixtures compiled with arduino-cli
