//! The IDE's logic, shared by the page (compiled to WebAssembly by `crates/wasm` and
//! `crates/boot`) and the build tool (`crates/build`). Nothing here touches the browser: the
//! compiler tools and the serial port are reached through the `Tools` and `Port` traits.

pub mod collate;
pub mod elf;
pub mod embed;
pub mod intelhex;
pub mod lzma;
pub mod monitor;
pub mod pack;
pub mod plotter;
pub mod ports;
pub mod preprocess;
pub mod sketch;
pub mod stk500;
pub mod toolchain;

#[cfg(test)]
pub(crate) mod test_util;
