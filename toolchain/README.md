# Compiler tools (built from source)

`build.sh` builds the four programs the IDE runs in the browser, as WebAssembly:

| Tool | Source | Role |
|---|---|---|
| `cc1plus` | GCC 7.3.0 + Arduino's AVR patches | C++ compiler (sketch → assembly) |
| `avr-as` | GNU binutils 2.42 | assembler |
| `avr-ld` | GNU binutils 2.42 | linker |
| `avr-objcopy` | GNU binutils 2.42 | ELF → Intel HEX |

GCC matches the Arduino IDE's `avr-gcc 7.3.0-atmel3.6.1-arduino7`: the official `gcc-7.3.0`
release with Arduino's `atmel-patches-gcc.7.3.0-arduino2.patch`, configured the same way (minus
LTO, plugins and docs, which the browser compiler doesn't use).

All downloads are pinned by SHA-256; the GNU tarballs' hashes were pinned after checking their
release signatures (`build.sh verify_signatures`).

## Building

On Linux or WSL (Ubuntu 24.04 tested), about an hour on a 12-thread machine:

```sh
sudo apt install build-essential m4 flex bison texinfo curl git python3 xz-utils bzip2 patch gnupg binutils-avr
toolchain/build.sh            # or one phase: fetch | emsdk | deps | gcc_build | binutils_build | write_sources
```

The build tree goes to `~/aide-toolchain` (override with `WORK=`); results go to `toolchain/out/`,
along with `SOURCES.md` (exact inputs) and `SHA256SUMS`. Then run `node build/prepare-compiler.mjs`
and `npm run build` as usual.

## Why the build needs a few workarounds

These are build settings only; no GCC or binutils source is changed.

- **`--host=i686-pc-linux-gnu` with `CC=emcc`**: these releases' `config.sub` predates Emscripten;
  32-bit Linux has the same type sizes as wasm32.
- **`ac_cv_func_psignal=yes`**: configure can't link-test `psignal()` under Emscripten, so
  libiberty would define a conflicting copy.
- **GCC's generator programs are built natively** (`CC_FOR_BUILD=gcc`) with `-std=gnu++98
  -include algorithm`: GCC 7 predates C++17, and `system.h` decides whether to include
  `<algorithm>` from a check made against the WebAssembly compiler.
- **`--with-as=/usr/bin/avr-as`** (Ubuntu's `binutils-avr`, 2.26 + Atmel patches): GCC's configure
  runs the target assembler to choose features such as COMDAT groups and mergeable string
  sections. Arduino's compiler was configured against the same binutils release; without it, GCC
  falls back to older, larger output.
- **`ld` reads its default scripts from `ldscripts/`** next to the program, so the IDE ships the
  `avr5.*` scripts from this build and runs each tool as `/<tool>`.

## Checking the result

`node test/compiler/asm-compare.mjs` compiles every test sketch and library example with this
`cc1plus` and with the Arduino IDE's native `avr-g++`, and checks the assembly is identical.

## License

GCC and binutils are GPL-3.0-or-later; GMP, MPFR and MPC are LGPL-3.0-or-later. If you distribute
the IDE, also offer the sources listed in `out/SOURCES.md` (and this script).
