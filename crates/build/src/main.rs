//! The build tool: `cargo aide <command>`.
//!
//!   wasm               builds the Rust core to WebAssembly (build/cache/wasm/)
//!   build [--watch] [--no-compiler]
//!                      bundles everything into dist/arduino-ide.html
//!   prepare-compiler   precompiles the Arduino core + libraries -> build/cache/compiler-pack.bin.lzma
//!   prepare-examples   built-in + library examples that compile for the Uno -> build/cache/examples.json.lzma

mod bundle;
mod prepare_compiler;
mod prepare_examples;
mod util;

use std::process::ExitCode;

const USAGE: &str = "Usage: cargo aide <wasm | build [--watch] [--no-compiler] | prepare-compiler | prepare-examples>";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let flag = |f: &str| args.iter().any(|a| a == f);
    let result = match args.first().map(String::as_str) {
        Some("wasm") => bundle::build_wasm(),
        Some("build") => bundle::run(flag("--watch"), flag("--no-compiler")),
        Some("prepare-compiler") => prepare_compiler::run(),
        Some("prepare-examples") => prepare_examples::run(),
        _ => {
            eprintln!("{USAGE}");
            return ExitCode::FAILURE;
        }
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::FAILURE
        }
    }
}
