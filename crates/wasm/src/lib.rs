//! aide-core for the page (the app and the compiler worker) and for Node (build scripts and
//! tests). JavaScript keeps only what needs the browser: the editor, the DOM, Web Serial, and
//! running the Emscripten compiler tools, which this code drives through small JS objects.

use aide_core::stk500::{self, Port, UploadFailure, UploadOptions};
use aide_core::toolchain::{self, BuildError, SketchFile, ToolInstance, Tools};
use aide_core::{embed, intelhex, lzma, monitor, pack, plotter, ports, preprocess, sketch};
use js_sys::{Array, Object, Promise, Reflect, Uint8Array};
use serde::Serialize;
use std::rc::Rc;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::{future_to_promise, JsFuture};

fn to_js<T: Serialize>(value: &T) -> JsValue {
    value.serialize(&serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true)).expect("plain data converts")
}

fn set(obj: &JsValue, key: &str, value: impl Into<JsValue>) {
    Reflect::set(obj, &key.into(), &value.into()).expect("setting a property on a plain object");
}

/// An Error with a name the JavaScript side checks (`e.name === "CompileError"`).
fn named_error(name: &str, message: &str) -> js_sys::Error {
    let e = js_sys::Error::new(message);
    e.set_name(name);
    e
}

fn error_message(e: &JsValue) -> String {
    Reflect::get(e, &"message".into()).ok().and_then(|m| m.as_string()).unwrap_or_else(|| e.as_string().unwrap_or_else(|| format!("{e:?}")))
}

// ---------- Data formats ----------

/// The (still compressed) bytes of an embedded pack, from its element's text.
#[wasm_bindgen(js_name = decodeEmbedded)]
pub fn decode_text(text: &str) -> Result<Vec<u8>, JsError> {
    embed::decode_text(text).map_err(JsError::new)
}

#[wasm_bindgen]
pub fn unlzma(data: &[u8]) -> Result<Vec<u8>, JsError> {
    Ok(lzma::unlzma(data)?)
}

/// Decodes an embedded pack and decompresses it to text.
#[wasm_bindgen(js_name = unpackText)]
pub fn unpack_text(text: &str) -> Result<String, JsError> {
    let bytes = lzma::unlzma(&embed::decode_text(text).map_err(JsError::new)?)?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

#[wasm_bindgen(js_name = parseIntelHex)]
pub fn parse_intel_hex(text: &str) -> Result<Vec<u8>, JsError> {
    Ok(intelhex::parse_intel_hex(text)?)
}

// ---------- Editor, tabs, ports, monitor ----------

/// Checks a new tab name. Returns { name } or { error }.
#[wasm_bindgen(js_name = validateTabName)]
pub fn validate_tab_name(input: &str, existing: Vec<String>) -> JsValue {
    let out: JsValue = Object::new().into();
    match sketch::validate_tab_name(input, &existing) {
        Ok(name) => set(&out, "name", name),
        Err(error) => set(&out, "error", error),
    }
    out
}

/// Tab order for opened files ({ name, code }[]), as indexes.
#[wasm_bindgen(js_name = orderOpenedFiles)]
pub fn order_opened_files(files: JsValue) -> Result<Vec<u32>, JsError> {
    let files: Vec<SketchFile> = serde_wasm_bindgen::from_value(files)?;
    let pairs: Vec<(String, String)> = files.into_iter().map(|f| (f.name, f.code)).collect();
    Ok(sketch::order_opened_files(&pairs).into_iter().map(|i| i as u32).collect())
}

#[wasm_bindgen(js_name = describePort)]
pub fn describe_port(vid: Option<u16>, pid: Option<u16>) -> String {
    ports::describe_port(vid, pid)
}

/// [{ label, value }] for one line of serial output; empty if it holds no data.
#[wasm_bindgen(js_name = parsePlotLine)]
pub fn parse_plot_line(line: &str) -> Array {
    plotter::parse_plot_line(line)
        .into_iter()
        .map(|v| {
            let o: JsValue = Object::new().into();
            set(&o, "label", v.label);
            set(&o, "value", v.value);
            o
        })
        .collect()
}

/// Compiler output as [{ text, class, file, line, column }] for the Output panel.
#[wasm_bindgen(js_name = outputLines)]
pub fn output_lines(text: &str) -> JsValue {
    to_js(&toolchain::output_lines(text))
}

#[wasm_bindgen]
pub struct MonitorStream {
    inner: monitor::MonitorStream,
    lines: Vec<String>,
}

#[wasm_bindgen]
impl MonitorStream {
    #[wasm_bindgen(constructor)]
    pub fn new() -> MonitorStream {
        MonitorStream { inner: monitor::MonitorStream::new(), lines: vec![] }
    }

    /// Adds a received chunk; returns the text to show. Completed lines wait in takeLines().
    pub fn push(&mut self, chunk: &str, timestamps: bool, stamp: &str) -> String {
        let (shown, lines) = self.inner.push(chunk, timestamps, stamp);
        self.lines.extend(lines);
        shown
    }

    #[wasm_bindgen(js_name = takeLines)]
    pub fn take_lines(&mut self) -> Vec<String> {
        std::mem::take(&mut self.lines)
    }

    #[wasm_bindgen(js_name = resetLines)]
    pub fn reset_lines(&mut self) {
        self.inner.reset_lines();
    }

    pub fn clear(&mut self) {
        self.inner.clear();
    }
}

impl Default for MonitorStream {
    fn default() -> Self {
        Self::new()
    }
}

// ---------- Compiler ----------

/// The C++ the compiler sees for a sketch's .ino files ({ name, code }[], main first):
/// { cpp, prototypes }.
#[wasm_bindgen(js_name = preprocessSketch)]
pub fn preprocess_sketch(files: JsValue) -> Result<JsValue, JsError> {
    let files: Vec<SketchFile> = serde_wasm_bindgen::from_value(files)?;
    let inos: Vec<preprocess::InoFile> = files.iter().map(|f| preprocess::InoFile { name: &f.name, code: &f.code }).collect();
    let r = preprocess::preprocess_sketch(&inos);
    let out: JsValue = Object::new().into();
    set(&out, "cpp", r.cpp);
    set(&out, "prototypes", r.prototypes.into_iter().map(JsValue::from).collect::<Array>());
    Ok(out)
}

#[wasm_bindgen]
extern "C" {
    /// { instantiate(tool): Promise<instance>, log(message), now(): number } (src/compiler/toolchain.js)
    pub type JsTools;
    #[wasm_bindgen(method, catch)]
    fn instantiate(this: &JsTools, tool: &str) -> Result<Promise, JsValue>;
    #[wasm_bindgen(method)]
    fn log(this: &JsTools, message: &str);
    #[wasm_bindgen(method)]
    fn now(this: &JsTools) -> f64;

    /// An Emscripten tool instance: { writeFile, callMain, readFile, output }
    pub type JsToolInstance;
    #[wasm_bindgen(method, catch, js_name = writeFile)]
    fn write_file(this: &JsToolInstance, path: &str, data: &Uint8Array) -> Result<(), JsValue>;
    #[wasm_bindgen(method, catch, js_name = callMain)]
    fn call_main(this: &JsToolInstance, args: Array) -> Result<i32, JsValue>;
    #[wasm_bindgen(method, js_name = readFile)]
    fn read_file(this: &JsToolInstance, path: &str) -> JsValue;
    #[wasm_bindgen(method)]
    fn output(this: &JsToolInstance) -> Array;
}

struct ToolsAdapter(JsTools);
struct InstanceAdapter(JsToolInstance);

impl ToolInstance for InstanceAdapter {
    type Error = JsValue;

    fn write_file(&mut self, path: &str, data: &[u8]) -> Result<(), JsValue> {
        // SAFETY: the view is only used during this synchronous call, which copies it into the
        // tool's filesystem and doesn't call back into this module (so memory can't grow).
        let view = unsafe { Uint8Array::view(data) };
        self.0.write_file(path, &view)
    }

    fn call_main(&mut self, args: &[String]) -> Result<i32, JsValue> {
        self.0.call_main(args.iter().map(|a| JsValue::from_str(a)).collect())
    }

    fn read_file(&mut self, path: &str) -> Option<Vec<u8>> {
        let v = self.0.read_file(path);
        v.dyn_ref::<Uint8Array>().map(|a| a.to_vec())
    }

    fn output(&mut self) -> Vec<String> {
        self.0.output().iter().filter_map(|l| l.as_string()).collect()
    }
}

impl Tools for ToolsAdapter {
    type Error = JsValue;
    type Instance = InstanceAdapter;

    async fn instantiate(&mut self, tool: &str) -> Result<InstanceAdapter, JsValue> {
        let instance = JsFuture::from(self.0.instantiate(tool)?).await?;
        Ok(InstanceAdapter(instance.unchecked_into()))
    }

    fn log(&mut self, message: &str) {
        self.0.log(message);
    }

    fn now(&self) -> f64 {
        self.0.now()
    }
}

/// The compiler's files and libraries, unpacked from the compressed compiler pack.
#[wasm_bindgen]
pub struct Toolchain {
    inner: Rc<toolchain::Toolchain>,
}

#[wasm_bindgen]
impl Toolchain {
    #[wasm_bindgen(constructor)]
    pub fn new(pack_lzma: &[u8]) -> Result<Toolchain, JsError> {
        let data = lzma::unlzma(pack_lzma)?;
        let pack = pack::Pack::read(data).map_err(|e| JsError::new(&e))?;
        let inner = toolchain::Toolchain::new(pack).map_err(|e| JsError::new(&e))?;
        Ok(Toolchain { inner: Rc::new(inner) })
    }

    #[wasm_bindgen(js_name = manifestJson)]
    pub fn manifest_json(&self) -> String {
        self.inner.manifest_json().to_string()
    }

    /// A copy of one of the pack's files, or undefined.
    pub fn file(&self, path: &str) -> Option<Vec<u8>> {
        self.inner.file(path).map(<[u8]>::to_vec)
    }

    /// Builds a sketch ({ name, code }[], main .ino first). Resolves with
    /// { hex, image, flash, ram, libraries, warnings, output, assembly, timings }; rejects with a
    /// CompileError carrying `diagnostics` and `output`.
    pub fn build(&self, files: JsValue, tools: JsTools, keep_assembly: bool) -> Promise {
        let inner = self.inner.clone();
        future_to_promise(async move {
            let files: Vec<SketchFile> = serde_wasm_bindgen::from_value(files)?;
            match inner.build(&files, &mut ToolsAdapter(tools), keep_assembly).await {
                Ok(r) => {
                    let out = to_js(&r);
                    set(&out, "image", Uint8Array::from(&r.image[..]));
                    Ok(out)
                }
                Err(BuildError::Compile(e)) => {
                    let err = named_error("CompileError", &e.message);
                    set(&err, "diagnostics", to_js(&e.diagnostics));
                    set(&err, "output", e.output);
                    Err(err.into())
                }
                Err(BuildError::Tool(e)) => Err(e),
            }
        })
    }
}

// ---------- Upload ----------

#[wasm_bindgen]
extern "C" {
    /// A Web Serial port with buffered reads (src/upload/stk500.js).
    pub type JsTransport;
    #[wasm_bindgen(method, catch)]
    fn open(this: &JsTransport, baud_rate: u32) -> Result<Promise, JsValue>;
    #[wasm_bindgen(method)]
    fn close(this: &JsTransport) -> Promise;
    #[wasm_bindgen(method, catch, js_name = setSignals)]
    fn set_signals(this: &JsTransport, dtr: bool, rts: bool) -> Result<Promise, JsValue>;
    #[wasm_bindgen(method, catch)]
    fn write(this: &JsTransport, bytes: Uint8Array) -> Result<Promise, JsValue>;
    #[wasm_bindgen(method, catch)]
    fn read(this: &JsTransport, n: u32, timeout_ms: u32) -> Result<Promise, JsValue>;
    #[wasm_bindgen(method)]
    fn clear(this: &JsTransport);
    #[wasm_bindgen(method)]
    fn sleep(this: &JsTransport, ms: u32) -> Promise;
    #[wasm_bindgen(method)]
    fn progress(this: &JsTransport, fraction: f64, phase: &str);
    #[wasm_bindgen(method)]
    fn log(this: &JsTransport, message: &str);
}

struct PortAdapter(JsTransport);

impl Port for PortAdapter {
    type Error = JsValue;

    async fn open(&mut self, baud_rate: u32) -> Result<(), JsValue> {
        JsFuture::from(self.0.open(baud_rate)?).await.map(drop)
    }

    async fn close(&mut self) {
        let _ = JsFuture::from(self.0.close()).await;
    }

    async fn set_signals(&mut self, dtr: bool, rts: bool) -> Result<(), JsValue> {
        JsFuture::from(self.0.set_signals(dtr, rts)?).await.map(drop)
    }

    async fn write(&mut self, bytes: &[u8]) -> Result<(), JsValue> {
        // A copy: the port's writer may still hold the data after this call.
        JsFuture::from(self.0.write(Uint8Array::from(bytes))?).await.map(drop)
    }

    async fn read(&mut self, n: usize, timeout_ms: u32) -> Result<Option<Vec<u8>>, JsValue> {
        let r = JsFuture::from(self.0.read(n as u32, timeout_ms)?).await?;
        Ok(r.dyn_ref::<Uint8Array>().map(|a| a.to_vec()))
    }

    fn clear(&mut self) {
        self.0.clear();
    }

    async fn sleep(&mut self, ms: u32) {
        let _ = JsFuture::from(self.0.sleep(ms)).await;
    }

    fn progress(&mut self, fraction: f64, phase: &str) {
        self.0.progress(fraction, phase);
    }

    fn log(&mut self, message: &str) {
        self.0.log(message);
    }

    fn describe(error: &JsValue) -> String {
        error_message(error)
    }
}

/// Uploads a flash image to an Uno's bootloader. `options`: the board's upload settings.
/// Resolves with { bytes, pages }; rejects with an UploadError, or the port's own error.
#[wasm_bindgen(js_name = uploadStk500)]
pub fn upload_stk500(transport: JsTransport, image: Vec<u8>, options: JsValue) -> Promise {
    future_to_promise(async move {
        let opts: UploadOptions = serde_wasm_bindgen::from_value(options)?;
        match stk500::upload(&mut PortAdapter(transport), &image, &opts).await {
            Ok(r) => {
                let out: JsValue = Object::new().into();
                set(&out, "bytes", r.bytes as u32);
                set(&out, "pages", r.pages as u32);
                Ok(out)
            }
            Err(UploadFailure::Upload(message)) => Err(named_error("UploadError", &message).into()),
            Err(UploadFailure::Port(e)) => Err(e),
        }
    })
}
