# Compiler tool sources

The WebAssembly tools in this directory were built by `toolchain/build.sh` from:

| File | SHA-256 | From |
|---|---|---|
| gcc-7.3.0.tar.xz | `832ca6ae04636adbb430e865a1451adf6979ab44ca1c8374f61fba65645ce15c` | https://ftp.gnu.org/gnu/gcc/gcc-7.3.0/gcc-7.3.0.tar.xz |
| binutils-2.42.tar.xz | `f6e4d41fd5fc778b06b7891457b3620da5ecea1006c6a4a41ae998109f85a800` | https://ftp.gnu.org/gnu/binutils/binutils-2.42.tar.xz |
| gmp-6.1.0.tar.bz2 | `498449a994efeba527885c10405993427995d3f86b8768d8cdf8d9dd7c6b73e8` | https://ftp.gnu.org/gnu/gmp/gmp-6.1.0.tar.bz2 |
| mpfr-3.1.4.tar.bz2 | `d3103a80cdad2407ed581f3618c4bed04e0c92d1cf771a65ead662cc397f7775` | https://ftp.gnu.org/gnu/mpfr/mpfr-3.1.4.tar.bz2 |
| mpc-1.0.3.tar.gz | `617decc6ea09889fb08ede330917a00b16809b8db88c29c31bfbb49cbf88ecc3` | https://ftp.gnu.org/gnu/mpc/mpc-1.0.3.tar.gz |
| atmel-patches-gcc.7.3.0-arduino2.patch | `96782c75dd11e994e1ab9250c41fc5cd81ba65bbcf44383cd9d660d01cc85f97` | https://raw.githubusercontent.com/arduino/toolchain-avr/368b87a73e3677071fa44f2182c1ea4cc6a90557/avr-gcc-patches/atmel-patches-gcc.7.3.0-arduino2.patch |

Local patches: 
(see `toolchain/patches/`; none means the sources were used as released).

Compiled with emcc (Emscripten gcc/clang-like replacement + linker emulating GNU ld) 6.0.10 (d6c521a7f05449857c76bd99e396895583cf2083).

GCC and binutils are licensed under the GNU GPL version 3 or later; GMP, MPFR and MPC under
the GNU LGPL version 3 or later.
