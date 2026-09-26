#!/usr/bin/env bash
# Builds the in-browser compiler tools from source: GCC 7.3.0 (cc1plus, with Arduino's AVR
# patches, as in the Arduino IDE's avr-gcc 7.3.0-atmel3.6.1-arduino7) and GNU binutils 2.42
# (as, ld, objcopy), compiled to WebAssembly with Emscripten.
#
# Runs on Linux (e.g. WSL Ubuntu 24.04). Needs: gcc g++ make m4 flex bison texinfo curl git binutils-avr
# python3 xz bzip2 patch gnupg.
#
# Usage: toolchain/build.sh [fetch|emsdk|deps|gcc|binutils|all]   (default: all)
# Output: toolchain/out/{cc1plus,avr-as,avr-ld,avr-objcopy}.{mjs,wasm} and toolchain/out/SOURCES.md
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="${WORK:-$HOME/aide-toolchain}"      # build tree; keep it on a Linux filesystem for speed
OUT="$HERE/out"
JOBS="${JOBS:-$(nproc)}"
SRC="$WORK/src"
PREFIX="$WORK/wasm-deps"

EMSDK_VERSION=6.0.10
ARDUINO_TOOLCHAIN_COMMIT=368b87a73e3677071fa44f2182c1ea4cc6a90557

# name|url|sha256 (hashes pinned after verifying the GNU release signatures on 2026-09-26)
SOURCES=(
  "gcc-7.3.0.tar.xz|https://ftp.gnu.org/gnu/gcc/gcc-7.3.0/gcc-7.3.0.tar.xz|832ca6ae04636adbb430e865a1451adf6979ab44ca1c8374f61fba65645ce15c"
  "binutils-2.42.tar.xz|https://ftp.gnu.org/gnu/binutils/binutils-2.42.tar.xz|f6e4d41fd5fc778b06b7891457b3620da5ecea1006c6a4a41ae998109f85a800"
  "gmp-6.1.0.tar.bz2|https://ftp.gnu.org/gnu/gmp/gmp-6.1.0.tar.bz2|498449a994efeba527885c10405993427995d3f86b8768d8cdf8d9dd7c6b73e8"
  "mpfr-3.1.4.tar.bz2|https://ftp.gnu.org/gnu/mpfr/mpfr-3.1.4.tar.bz2|d3103a80cdad2407ed581f3618c4bed04e0c92d1cf771a65ead662cc397f7775"
  "mpc-1.0.3.tar.gz|https://ftp.gnu.org/gnu/mpc/mpc-1.0.3.tar.gz|617decc6ea09889fb08ede330917a00b16809b8db88c29c31bfbb49cbf88ecc3"
  "atmel-patches-gcc.7.3.0-arduino2.patch|https://raw.githubusercontent.com/arduino/toolchain-avr/$ARDUINO_TOOLCHAIN_COMMIT/avr-gcc-patches/atmel-patches-gcc.7.3.0-arduino2.patch|96782c75dd11e994e1ab9250c41fc5cd81ba65bbcf44383cd9d660d01cc85f97"
)

log() { printf '\n=== %s\n' "$*"; }

fetch() {
  mkdir -p "$SRC"
  for entry in "${SOURCES[@]}"; do
    IFS='|' read -r name url sha <<<"$entry"
    [ -f "$SRC/$name" ] || { log "Downloading $name"; curl -fL --retry 3 -o "$SRC/$name.tmp" "$url" && mv "$SRC/$name.tmp" "$SRC/$name"; }
    if [[ "$sha" == SHA_* ]]; then
      echo "UNPINNED $name $(sha256sum "$SRC/$name" | cut -d' ' -f1)"
    else
      echo "$sha  $SRC/$name" | sha256sum -c --quiet || { echo "Checksum mismatch for $name" >&2; exit 1; }
    fi
  done
}

# One-off: checks the GNU tarballs against their detached signatures (used to pin the hashes).
verify_signatures() {
  [ -f "$SRC/gnu-keyring.gpg" ] || curl -fsSL -o "$SRC/gnu-keyring.gpg" https://ftp.gnu.org/gnu/gnu-keyring.gpg
  for entry in "${SOURCES[@]}"; do
    IFS='|' read -r name url _ <<<"$entry"
    [[ "$url" == https://ftp.gnu.org/* ]] || continue
    curl -fsSL -o "$SRC/$name.sig" "$url.sig"
    gpgv --keyring "$SRC/gnu-keyring.gpg" "$SRC/$name.sig" "$SRC/$name" 2>&1 | grep -E "Good signature|BAD|Can't" || true
  done
}

emsdk() {
  if [ ! -d "$WORK/emsdk" ]; then
    git clone --depth 1 --branch "$EMSDK_VERSION" https://github.com/emscripten-core/emsdk.git "$WORK/emsdk"
  fi
  (cd "$WORK/emsdk" && ./emsdk install "$EMSDK_VERSION" && ./emsdk activate "$EMSDK_VERSION" >/dev/null)
}

activate_emsdk() {
  # shellcheck disable=SC1091
  source "$WORK/emsdk/emsdk_env.sh" >/dev/null 2>&1
  emcc --version | head -1
}

extract() { # tarball dir
  rm -rf "$WORK/$2"
  mkdir -p "$WORK/$2"
  tar -xf "$SRC/$1" -C "$WORK/$2" --strip-components=1
}

# Autoconf's config.sub in these old releases doesn't know Emscripten, so the host is described as
# 32-bit Linux (wasm32 has the same int/long/pointer sizes) and the compilers are set to emcc.
HOST=i686-pc-linux-gnu
BUILD=x86_64-pc-linux-gnu
HOST_CFLAGS="-O2 -g0 -w"

# GMP, MPFR and MPC: arbitrary-precision maths libraries GCC uses for constant folding.
deps() {
  activate_emsdk
  log "GMP"
  extract gmp-6.1.0.tar.bz2 gmp
  (cd "$WORK/gmp" && emconfigure ./configure --host=none --build=$BUILD --prefix="$PREFIX" \
      --disable-assembly --disable-shared --enable-static CC_FOR_BUILD=gcc CFLAGS="$HOST_CFLAGS" >/dev/null \
    && emmake make -j"$JOBS" >/dev/null && emmake make install >/dev/null)
  log "MPFR"
  extract mpfr-3.1.4.tar.bz2 mpfr
  (cd "$WORK/mpfr" && emconfigure ./configure --host=$HOST --build=$BUILD --prefix="$PREFIX" \
      --with-gmp="$PREFIX" --disable-shared --enable-static CFLAGS="$HOST_CFLAGS" >/dev/null \
    && emmake make -j"$JOBS" >/dev/null && emmake make install >/dev/null)
  log "MPC"
  extract mpc-1.0.3.tar.gz mpc
  (cd "$WORK/mpc" && emconfigure ./configure --host=$HOST --build=$BUILD --prefix="$PREFIX" \
      --with-gmp="$PREFIX" --with-mpfr="$PREFIX" --disable-shared --enable-static CFLAGS="$HOST_CFLAGS" >/dev/null \
    && emmake make -j"$JOBS" >/dev/null && emmake make install >/dev/null)
  ls -la "$PREFIX/lib"
}

# Emscripten link settings shared by all tools: an ES module factory with a callable main(), an
# in-memory filesystem, and memory that grows as needed.
EM_LDFLAGS="-O2 -sMODULARIZE=1 -sEXPORT_ES6=1 -sINVOKE_RUN=0 -sEXIT_RUNTIME=1 -sFORCE_FILESYSTEM=1 \
  -sEXPORTED_RUNTIME_METHODS=callMain,FS -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=16MB \
  -sMAXIMUM_MEMORY=2GB -sSTACK_SIZE=8MB -sENVIRONMENT=web,worker,node"

# GCC 7.3.0 + Arduino's AVR patches, configured like Arduino's gcc.build.bash (minus the parts
# a single-translation-unit browser compiler doesn't need: LTO, plugins, docs).
gcc_build() {
  # GCC's configure runs the target assembler to decide which features to emit (COMDAT groups,
  # mergeable string sections, ...). Arduino's compiler was configured against binutils 2.26 with
  # Atmel's patches; Ubuntu's binutils-avr is that same release, so the output matches.
  [ -x /usr/bin/avr-as ] || { echo "Install binutils-avr (apt install binutils-avr) first." >&2; exit 1; }
  activate_emsdk
  log "GCC: unpack and patch"
  extract gcc-7.3.0.tar.xz gcc
  (cd "$WORK/gcc" && patch -p1 -s < "$SRC/atmel-patches-gcc.7.3.0-arduino2.patch")
  for p in "$HERE"/patches/gcc/*.patch; do
    [ -e "$p" ] && (cd "$WORK/gcc" && patch -p1 -s < "$p" && echo "applied $(basename "$p")")
  done

  log "GCC: configure"
  rm -rf "$WORK/gcc-build" && mkdir -p "$WORK/gcc-build" && cd "$WORK/gcc-build"
  # Emscripten's libc declares psignal() but configure can't link-test it, so libiberty would
  # define its own with an incompatible signature.
  export ac_cv_func_psignal=yes
  CC=emcc CXX=em++ AR=emar RANLIB=emranlib \
  CFLAGS="$HOST_CFLAGS" CXXFLAGS="$HOST_CFLAGS -std=gnu++98" \
  CC_FOR_BUILD=gcc CXX_FOR_BUILD=g++ CFLAGS_FOR_BUILD="-O2 -w" CXXFLAGS_FOR_BUILD="-O2 -w -std=gnu++98" \
    ../gcc/configure --build=$BUILD --host=$HOST --target=avr \
      --with-as=/usr/bin/avr-as --with-ld=/usr/bin/avr-ld \
      --enable-languages=c,c++ --enable-fixed-point --with-avrlibc=yes --with-dwarf2 \
      --disable-nls --disable-libssp --disable-libada --disable-shared --disable-doc \
      --disable-lto --disable-plugin --disable-bootstrap --without-isl \
      --with-gmp="$PREFIX" --with-mpfr="$PREFIX" --with-mpc="$PREFIX" >/dev/null

  log "GCC: build host libraries and generators"
  make -j"$JOBS" all-build-libiberty all-build-libcpp all-build-fixincludes \
    all-libiberty all-libcpp all-libdecnumber all-libbacktrace all-zlib configure-gcc >/dev/null

  # Building inside gcc/ directly skips the variables the top-level Makefile passes down, so the
  # native compiler for GCC's generator programs has to be named here. GCC 7 predates C++17, and
  # decides whether to include <algorithm> from a check against the WebAssembly compiler, not g++.
  # The same goes for the host flags: gcc/Makefile's own CFLAGS have -O2 stripped.
  local for_build=(CC_FOR_BUILD=gcc CXX_FOR_BUILD=g++ "CFLAGS_FOR_BUILD=-O2 -w" "CXXFLAGS_FOR_BUILD=-O2 -w -std=gnu++98 -include algorithm"
    "CFLAGS=$HOST_CFLAGS" "CXXFLAGS=$HOST_CFLAGS -std=gnu++98")
  log "GCC: build cc1plus"
  make -C gcc -j"$JOBS" cc1plus "${for_build[@]}" >/dev/null
  rm -f gcc/cc1plus gcc/cc1plus.wasm
  make -C gcc cc1plus "${for_build[@]}" LDFLAGS="$EM_LDFLAGS" >/dev/null

  mkdir -p "$OUT"
  cp gcc/cc1plus "$OUT/cc1plus.mjs"
  cp gcc/cc1plus.wasm "$OUT/cc1plus.wasm"
  ls -la "$OUT"
}

# GNU binutils 2.42 for AVR: the assembler, linker and objcopy.
binutils_build() {
  activate_emsdk
  log "binutils: unpack"
  extract binutils-2.42.tar.xz binutils
  for p in "$HERE"/patches/binutils/*.patch; do
    [ -e "$p" ] && (cd "$WORK/binutils" && patch -p1 -s < "$p" && echo "applied $(basename "$p")")
  done

  log "binutils: configure"
  rm -rf "$WORK/binutils-build" && mkdir -p "$WORK/binutils-build" && cd "$WORK/binutils-build"
  export ac_cv_func_psignal=yes # same libiberty issue as in gcc_build
  CC=emcc CXX=em++ AR=emar RANLIB=emranlib CFLAGS="$HOST_CFLAGS" CXXFLAGS="$HOST_CFLAGS" \
  CC_FOR_BUILD=gcc CFLAGS_FOR_BUILD="-O2 -w" \
    ../binutils/configure --build=$BUILD --host=$HOST --target=avr \
      --disable-nls --disable-werror --disable-shared --enable-static --disable-plugins \
      --disable-gdb --disable-gdbserver --disable-sim --disable-gprof --disable-gprofng \
      --disable-libctf --without-zstd --without-debuginfod --disable-readline >/dev/null

  log "binutils: build"
  make -j"$JOBS" all-gas all-ld all-binutils >/dev/null

  # Relink the three tools as Emscripten modules. The settings go through EMCC_CFLAGS because
  # libtool drops link flags it doesn't recognise.
  log "binutils: link WebAssembly modules"
  rm -f gas/as-new* ld/ld-new* binutils/objcopy binutils/objcopy.wasm
  EMCC_CFLAGS="$EM_LDFLAGS" make -C gas as-new >/dev/null
  EMCC_CFLAGS="$EM_LDFLAGS" make -C ld ld-new >/dev/null
  EMCC_CFLAGS="$EM_LDFLAGS" make -C binutils objcopy >/dev/null

  mkdir -p "$OUT"
  cp gas/as-new "$OUT/avr-as.mjs" && cp gas/as-new.wasm "$OUT/avr-as.wasm"
  cp ld/ld-new "$OUT/avr-ld.mjs" && cp ld/ld-new.wasm "$OUT/avr-ld.wasm"
  cp binutils/objcopy "$OUT/avr-objcopy.mjs" && cp binutils/objcopy.wasm "$OUT/avr-objcopy.wasm"
  # This ld reads its default linker scripts from files rather than having them built in.
  mkdir -p "$OUT/ldscripts" && cp ld/ldscripts/avr5.* "$OUT/ldscripts/"
  ls -la "$OUT" "$OUT/ldscripts"
}

# Records exactly what the tools were built from (for the GPL's corresponding-source requirement).
write_sources() {
  activate_emsdk >/dev/null
  mkdir -p "$OUT"
  {
    echo "# Compiler tool sources"
    echo
    echo "The WebAssembly tools in this directory were built by \`toolchain/build.sh\` from:"
    echo
    echo "| File | SHA-256 | From |"
    echo "|---|---|---|"
    for entry in "${SOURCES[@]}"; do
      IFS='|' read -r name url sha <<<"$entry"
      echo "| $name | \`$sha\` | $url |"
    done
    echo
    echo "Local patches: $(ls "$HERE"/patches/*/*.patch 2>/dev/null | xargs -n1 basename 2>/dev/null | tr '\n' ' ' || true)"
    echo "(see \`toolchain/patches/\`; none means the sources were used as released)."
    echo
    echo "Compiled with $(emcc --version | head -1)."
    echo "GCC configured against $(avr-as --version | head -1) (Ubuntu package binutils-avr $(dpkg-query -W -f='${Version}' binutils-avr 2>/dev/null))."
    echo
    echo "GCC and binutils are licensed under the GNU GPL version 3 or later; GMP, MPFR and MPC under"
    echo "the GNU LGPL version 3 or later."
  } > "$OUT/SOURCES.md"
  (cd "$OUT" && sha256sum ./*.wasm ./*.mjs > SHA256SUMS)
  cat "$OUT/SOURCES.md"
}

all() {
  fetch
  emsdk
  deps
  gcc_build
  binutils_build
  write_sources
}

"${@:-all}"
