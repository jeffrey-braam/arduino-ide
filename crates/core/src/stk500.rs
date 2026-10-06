//! Uploads a flash image to an Optiboot (STK500v1) bootloader, as used by the Arduino Uno.
//! The serial port, timers and progress reporting are behind the `Port` trait: Web Serial in the
//! page (crates/wasm), a simulated board in the tests.

#![allow(async_fn_in_trait)]

use serde::Deserialize;

const OK: u8 = 0x10;
const INSYNC: u8 = 0x14;
const CRC_EOP: u8 = 0x20;
const GET_SYNC: u8 = 0x30;
const ENTER_PROGMODE: u8 = 0x50;
const LEAVE_PROGMODE: u8 = 0x51;
const LOAD_ADDRESS: u8 = 0x55;
const PROG_PAGE: u8 = 0x64;
const READ_PAGE: u8 = 0x74;
const READ_SIGN: u8 = 0x75;
const FLASH: u8 = 0x46; // 'F'

pub trait Port {
    type Error;
    /// Opens the port at `baud_rate` (which raises DTR, resetting an Uno).
    async fn open(&mut self, baud_rate: u32) -> Result<(), Self::Error>;
    /// Closes the port; never fails.
    async fn close(&mut self);
    async fn set_signals(&mut self, dtr: bool, rts: bool) -> Result<(), Self::Error>;
    async fn write(&mut self, bytes: &[u8]) -> Result<(), Self::Error>;
    /// Exactly `n` bytes, or None if they don't arrive within `timeout_ms`.
    async fn read(&mut self, n: usize, timeout_ms: u32) -> Result<Option<Vec<u8>>, Self::Error>;
    /// Drops bytes received but not read yet.
    fn clear(&mut self);
    async fn sleep(&mut self, ms: u32);
    fn progress(&mut self, fraction: f64, phase: &str);
    fn log(&mut self, message: &str);
    fn describe(error: &Self::Error) -> String;
}

/// A board's upload settings (`upload` in src/boards.js).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UploadOptions {
    pub baud_rate: u32,
    pub page_size: usize,
    pub max_size: usize,
    pub signature: Option<Vec<u8>>,
    pub verify: bool,
}

impl Default for UploadOptions {
    fn default() -> Self {
        UploadOptions { baud_rate: 115200, page_size: 128, max_size: 32256, signature: None, verify: true }
    }
}

#[derive(Debug, PartialEq)]
pub enum UploadFailure<E> {
    /// Something to tell the student (wrong board, no answer, ...).
    Upload(String),
    /// The port itself failed (e.g. the board was unplugged).
    Port(E),
}

impl<E> From<E> for UploadFailure<E> {
    fn from(e: E) -> Self {
        UploadFailure::Port(e)
    }
}

#[derive(Debug, PartialEq)]
pub struct UploadSummary {
    pub bytes: usize,
    pub pages: usize,
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02X}")).collect::<Vec<_>>().join(" ")
}

fn fail<T, E>(message: String) -> Result<T, UploadFailure<E>> {
    Err(UploadFailure::Upload(message))
}

// The Uno resets when DTR goes from off to on (same sequence avrdude uses).
async fn pulse_reset<P: Port>(port: &mut P) -> Result<(), P::Error> {
    port.set_signals(false, false).await?;
    port.sleep(250).await;
    port.set_signals(true, true).await?;
    port.sleep(50).await;
    Ok(())
}

// After reset, Optiboot blinks the LED for ~0.4 s without reading serial, and its UART only
// buffers ~2 bytes. Two syncs queued during the blink overflow it; it then sees a stray byte
// where it expects CRC_EOP and jumps to the sketch. So wait out the blink, then send one sync at
// a time. Optiboot keeps listening for ~1 s after the blink, which fits all four tries.
async fn sync<P: Port>(port: &mut P) -> Result<bool, P::Error> {
    port.sleep(450).await;
    for _ in 0..4 {
        port.clear();
        port.write(&[GET_SYNC, CRC_EOP]).await?;
        if port.read(2, 300).await? == Some(vec![INSYNC, OK]) {
            return Ok(true);
        }
    }
    Ok(false)
}

async fn command<P: Port>(port: &mut P, bytes: &[u8], reply_len: usize, timeout_ms: u32) -> Result<Vec<u8>, UploadFailure<P::Error>> {
    port.clear();
    let mut msg = bytes.to_vec();
    msg.push(CRC_EOP);
    port.write(&msg).await?;
    let Some(r) = port.read(reply_len + 2, timeout_ms).await? else {
        return fail(format!("The board stopped responding (command 0x{}).", hex(&bytes[..1])));
    };
    if r[0] != INSYNC || r[r.len() - 1] != OK {
        return fail(format!("The board sent an unexpected reply: {}", hex(&r)));
    }
    Ok(r[1..r.len() - 1].to_vec())
}

/// Opens the (closed) port, uploads `image` (flash contents from address 0) and closes it again.
pub async fn upload<P: Port>(port: &mut P, image: &[u8], opts: &UploadOptions) -> Result<UploadSummary, UploadFailure<P::Error>> {
    if image.len() > opts.max_size {
        return fail(format!("Sketch is {} bytes, but this board only has room for {}.", image.len(), opts.max_size));
    }
    let page_size = opts.page_size;
    let pages: Vec<(usize, Vec<u8>)> = image
        .chunks(page_size)
        .enumerate()
        .map(|(i, chunk)| {
            let mut data = vec![0xff; page_size];
            data[..chunk.len()].copy_from_slice(chunk);
            (i * page_size, data)
        })
        .collect();

    if let Err(e) = port.open(opts.baud_rate).await {
        return fail(format!("Couldn't open the port. Close the Serial Monitor or any other app or tab using the board. ({})", P::describe(&e)));
    }
    let result = program(port, &pages, image.len(), opts).await;
    port.close().await;
    result
}

async fn program<P: Port>(port: &mut P, pages: &[(usize, Vec<u8>)], bytes: usize, opts: &UploadOptions) -> Result<UploadSummary, UploadFailure<P::Error>> {
    let mut synced = false;
    for attempt in 1..=3 {
        if synced {
            break;
        }
        if attempt > 1 {
            port.log(&format!("No answer from the board, resetting again (try {attempt} of 3)…"));
        }
        pulse_reset(port).await?;
        synced = sync(port).await?;
    }
    if !synced {
        return fail("The board didn't respond. Check the board and port selection, or unplug the board and plug it back in.".into());
    }

    let sig = command(port, &[READ_SIGN], 3, 500).await?;
    if let Some(expected) = &opts.signature {
        if &sig != expected {
            return fail(format!("Wrong chip: the board reports {} but {} was expected. Check the board selection.", hex(&sig), hex(expected)));
        }
    }

    command(port, &[ENTER_PROGMODE], 0, 500).await?;

    let size = [(opts.page_size >> 8) as u8, (opts.page_size & 0xff) as u8];
    let steps = pages.len() * if opts.verify { 2 } else { 1 };
    let mut done = 0;
    async fn load_address<P: Port>(port: &mut P, addr: usize) -> Result<Vec<u8>, UploadFailure<P::Error>> {
        command(port, &[LOAD_ADDRESS, ((addr >> 1) & 0xff) as u8, ((addr >> 9) & 0xff) as u8], 0, 500).await
    }

    for (addr, data) in pages {
        load_address(port, *addr).await?;
        let mut cmd = vec![PROG_PAGE, size[0], size[1], FLASH];
        cmd.extend_from_slice(data);
        command(port, &cmd, 0, 1000).await?;
        done += 1;
        port.progress(done as f64 / steps as f64, "Writing");
    }

    if opts.verify {
        for (addr, data) in pages {
            load_address(port, *addr).await?;
            let back = command(port, &[READ_PAGE, size[0], size[1], FLASH], opts.page_size, 1000).await?;
            if let Some(i) = (0..opts.page_size).find(|&i| back[i] != data[i]) {
                return fail(format!("Verification failed at address 0x{:04x}: wrote {}, read {}.", addr + i, hex(&data[i..=i]), hex(&back[i..=i])));
            }
            done += 1;
            port.progress(done as f64 / steps as f64, "Verifying");
        }
    }

    // Optiboot restarts into the new sketch after this.
    let _ = command(port, &[LEAVE_PROGMODE], 0, 500).await;
    Ok(UploadSummary { bytes, pages: pages.len() })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::intelhex::parse_intel_hex;
    use crate::test_util::block_on;
    use std::collections::VecDeque;

    #[derive(Debug, Clone, Copy, PartialEq)]
    enum State {
        Blink,
        Boot,
        App,
    }

    #[derive(Clone, Copy)]
    enum Timer {
        BlinkEnd,
        ListenEnd,
    }

    struct Sim {
        baud_rate: u32,
        blink_ms: f64,
        listen_ms: f64,
        latency_ms: f64,
        signature: Vec<u8>,
        corrupt_write_at: Option<usize>,
    }

    impl Default for Sim {
        fn default() -> Self {
            Sim { baud_rate: 115200, blink_ms: 400.0, listen_ms: 1000.0, latency_ms: 1.0, signature: vec![0x1e, 0x95, 0x0f], corrupt_write_at: None }
        }
    }

    /// A serial port with an Uno's Optiboot bootloader behind it, in virtual time, including the
    /// quirks that matter for uploading: reset on DTR rising edge, a ~0.4 s LED blink during
    /// which the UART only holds 3 bytes, a 1 s listen window, and jumping to the sketch on a
    /// malformed command.
    struct FakeOptiboot {
        sim: Sim,
        flash: Vec<u8>,
        state: State,
        dtr: bool,
        open_baud: Option<u32>,
        inbox: Vec<u8>,
        addr: usize,
        now: f64,
        timer: Option<(f64, Timer)>,
        rx: VecDeque<(f64, u8)>,
        resets: usize,
        page_writes: usize,
        progress: Vec<(f64, String)>,
    }

    impl FakeOptiboot {
        fn new(sim: Sim) -> Self {
            FakeOptiboot { sim, flash: vec![0xff; 32768], state: State::App, dtr: false, open_baud: None, inbox: vec![], addr: 0, now: 0.0, timer: None, rx: VecDeque::new(), resets: 0, page_writes: 0, progress: vec![] }
        }

        fn flash_matches(&self, image: &[u8]) -> bool {
            &self.flash[..image.len()] == image
        }

        fn set_dtr(&mut self, on: bool) {
            if on && !self.dtr {
                self.resets += 1;
                self.state = State::Blink;
                self.inbox.clear();
                self.timer = Some((self.now + self.sim.blink_ms, Timer::BlinkEnd));
            }
            self.dtr = on;
        }

        // Runs the board until `to`.
        fn advance(&mut self, to: f64) {
            while let Some((at, timer)) = self.timer {
                if at > to {
                    break;
                }
                self.now = self.now.max(at);
                self.timer = None;
                match timer {
                    Timer::BlinkEnd => {
                        self.state = State::Boot;
                        self.arm_listen();
                        self.process();
                    }
                    Timer::ListenEnd => self.state = State::App,
                }
            }
            self.now = self.now.max(to);
        }

        fn arm_listen(&mut self) {
            self.timer = Some((self.now + self.sim.listen_ms, Timer::ListenEnd));
        }

        fn arrived(&self) -> usize {
            self.rx.iter().take_while(|(at, _)| *at <= self.now).count()
        }

        fn reply(&mut self, bytes: &[u8]) {
            let at = self.now + self.sim.latency_ms;
            self.rx.extend(bytes.iter().map(|&b| (at, b)));
        }

        fn exit_to_sketch(&mut self) {
            self.state = State::App;
            self.inbox.clear();
            self.timer = None;
        }

        fn receive(&mut self, chunk: &[u8]) {
            if self.open_baud != Some(self.sim.baud_rate) {
                return; // wrong baud: the bootloader sees garbage and stays silent
            }
            for &b in chunk {
                match self.state {
                    State::Blink if self.inbox.len() < 3 => self.inbox.push(b), // the rest overrun and are lost
                    State::Boot => self.inbox.push(b),
                    _ => {}
                }
            }
            if self.state == State::Boot {
                self.arm_listen();
                self.process();
            }
        }

        fn process(&mut self) {
            while self.state == State::Boot && !self.inbox.is_empty() {
                let q = &self.inbox;
                let cmd = q[0];
                let len = if cmd == 0x64 || cmd == 0x74 {
                    if q.len() < 3 {
                        return;
                    }
                    let n = ((q[1] as usize) << 8) | q[2] as usize;
                    if cmd == 0x64 { 5 + n } else { 5 }
                } else {
                    match cmd {
                        0x41 => 3,
                        0x55 => 4,
                        0x42 => 22,
                        0x45 => 7,
                        _ => 2,
                    }
                };
                if q.len() < len {
                    return;
                }
                let c: Vec<u8> = self.inbox.drain(..len).collect();
                // Optiboot's verifySpace(): anything but CRC_EOP triggers a watchdog reset into the sketch.
                if c[len - 1] != 0x20 {
                    return self.exit_to_sketch();
                }
                match cmd {
                    0x55 => {
                        self.addr = (c[1] as usize | (c[2] as usize) << 8) * 2;
                        self.reply(&[0x14, 0x10]);
                    }
                    0x64 => {
                        let n = ((c[1] as usize) << 8) | c[2] as usize;
                        let mut data = c[4..4 + n].to_vec();
                        if let Some(bad) = self.sim.corrupt_write_at.and_then(|a| a.checked_sub(self.addr)).filter(|&b| b < n) {
                            data[bad] ^= 0xff;
                        }
                        self.flash[self.addr..self.addr + n].copy_from_slice(&data);
                        self.page_writes += 1;
                        self.reply(&[0x14, 0x10]);
                    }
                    0x74 => {
                        let n = ((c[1] as usize) << 8) | c[2] as usize;
                        let mut r = vec![0x14];
                        r.extend_from_slice(&self.flash[self.addr..self.addr + n]);
                        r.push(0x10);
                        self.reply(&r);
                    }
                    0x75 => {
                        let mut r = vec![0x14];
                        r.extend_from_slice(&self.sim.signature.clone());
                        r.push(0x10);
                        self.reply(&r);
                    }
                    0x51 => {
                        self.reply(&[0x14, 0x10]);
                        self.exit_to_sketch();
                    }
                    _ => self.reply(&[0x14, 0x10]),
                }
            }
        }
    }

    impl Port for FakeOptiboot {
        type Error = String;

        async fn open(&mut self, baud_rate: u32) -> Result<(), String> {
            if self.open_baud.is_some() {
                return Err("The port is already open.".into());
            }
            self.open_baud = Some(baud_rate);
            self.set_dtr(true); // opening a port raises DTR, which resets an Uno
            Ok(())
        }

        async fn close(&mut self) {
            self.open_baud = None;
            self.rx.clear();
            self.set_dtr(false);
        }

        async fn set_signals(&mut self, dtr: bool, _rts: bool) -> Result<(), String> {
            self.set_dtr(dtr);
            Ok(())
        }

        async fn write(&mut self, bytes: &[u8]) -> Result<(), String> {
            self.receive(bytes);
            Ok(())
        }

        async fn read(&mut self, n: usize, timeout_ms: u32) -> Result<Option<Vec<u8>>, String> {
            let deadline = self.now + timeout_ms as f64;
            loop {
                if self.arrived() >= n {
                    return Ok(Some(self.rx.drain(..n).map(|(_, b)| b).collect()));
                }
                let next_reply = self.rx.get(n - 1).map(|(at, _)| *at);
                let next_timer = self.timer.map(|(at, _)| at);
                let next = [next_reply, next_timer].into_iter().flatten().filter(|&t| t > self.now).fold(f64::INFINITY, f64::min);
                if next > deadline {
                    self.advance(deadline);
                    return Ok(if self.arrived() >= n { Some(self.rx.drain(..n).map(|(_, b)| b).collect()) } else { None });
                }
                self.advance(next);
            }
        }

        fn clear(&mut self) {
            let n = self.arrived();
            self.rx.drain(..n);
        }

        async fn sleep(&mut self, ms: u32) {
            let to = self.now + ms as f64;
            self.advance(to);
        }

        fn progress(&mut self, fraction: f64, phase: &str) {
            self.progress.push((fraction, phase.to_string()));
        }

        fn log(&mut self, _message: &str) {}

        fn describe(error: &String) -> String {
            error.clone()
        }
    }

    fn blink() -> Vec<u8> {
        parse_intel_hex(include_str!("../../../test/fixtures/Blink.ino.hex")).unwrap()
    }

    fn uno() -> UploadOptions {
        UploadOptions { signature: Some(vec![0x1e, 0x95, 0x0f]), ..UploadOptions::default() }
    }

    fn upload_err(port: &mut FakeOptiboot, image: &[u8]) -> String {
        match block_on(upload(port, image, &uno())) {
            Err(UploadFailure::Upload(m)) => m,
            other => panic!("expected an upload error, got {other:?}"),
        }
    }

    #[test]
    fn uploads_and_verifies_blink_on_an_uno_like_bootloader() {
        let mut port = FakeOptiboot::new(Sim::default());
        let image = blink();
        let r = block_on(upload(&mut port, &image, &uno())).unwrap();
        assert_eq!(r, UploadSummary { bytes: 922, pages: 8 });
        assert!(port.flash_matches(&image));
        assert_eq!(port.page_writes, 8);
        assert_eq!(port.open_baud, None, "port is closed afterwards");
        assert_eq!(port.progress.last().unwrap().0, 1.0);
        assert_eq!(port.state, State::App, "board restarts into the sketch");
    }

    #[test]
    fn works_whatever_the_bootloaders_blink_length() {
        for blink_ms in [0.0, 150.0, 400.0, 500.0] {
            let mut port = FakeOptiboot::new(Sim { blink_ms, ..Sim::default() });
            block_on(upload(&mut port, &blink(), &uno())).unwrap();
            assert!(port.flash_matches(&blink()), "blink_ms={blink_ms}");
        }
    }

    #[test]
    fn fills_a_full_32256_byte_sketch() {
        let big: Vec<u8> = (0..32256).map(|i| (i * 7) as u8).collect();
        let mut port = FakeOptiboot::new(Sim::default());
        block_on(upload(&mut port, &big, &uno())).unwrap();
        assert!(port.flash_matches(&big));
    }

    #[test]
    fn refuses_a_sketch_that_is_too_big() {
        let mut port = FakeOptiboot::new(Sim::default());
        assert!(upload_err(&mut port, &vec![0; 32257]).contains("only has room for 32256"));
        assert_eq!(port.resets, 0, "doesn't touch the board");
    }

    #[test]
    fn detects_a_verification_mismatch() {
        let mut port = FakeOptiboot::new(Sim { corrupt_write_at: Some(300), ..Sim::default() });
        assert!(upload_err(&mut port, &blink()).contains("Verification failed at address 0x012c"));
    }

    #[test]
    fn reports_the_wrong_chip() {
        let mut port = FakeOptiboot::new(Sim { signature: vec![0x1e, 0x98, 0x01], ..Sim::default() });
        assert!(upload_err(&mut port, &blink()).starts_with("Wrong chip: the board reports 1E 98 01"));
    }

    #[test]
    fn gives_up_cleanly_when_the_board_never_answers() {
        let mut port = FakeOptiboot::new(Sim { baud_rate: 57600, ..Sim::default() }); // bootloader at a different speed
        assert!(upload_err(&mut port, &blink()).contains("didn't respond"));
        assert_eq!(port.resets, 4, "opening the port plus three reset pulses");
        assert_eq!(port.open_baud, None, "port is closed afterwards");
    }

    #[test]
    fn reports_a_busy_port() {
        let mut port = FakeOptiboot::new(Sim::default());
        block_on(port.open(9600)).unwrap();
        assert!(upload_err(&mut port, &blink()).starts_with("Couldn't open the port"));
    }
}
