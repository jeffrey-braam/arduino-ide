# Arduino Libraries — 37-in-1 KY Sensor Kit

This covers the HiLetgo/generic "37-in-1" sensor kit (KY-001 through KY-040). Most modules need **no library at all** — they're plain analog or digital signals. Only a handful require you to install something.

**HiLetgo boards are printed with HW- numbers, not KY- numbers.** Use the **HW #** column in section 3 to find a board's KY number (for example, the rotary encoder is printed HW-040 and is the KY-040). The two-color LEDs and the two microphones look alike, so check the LED or microphone size as well as the number.

---

## 1. Libraries to install (via Library Manager)

Open **Sketch → Include Library → Manage Libraries...** in the Arduino IDE and search for these by name.

| Library | Install this exact name | Needed for |
|---|---|---|
| OneWire | `OneWire` (by Paul Stoffregen) | KY-001 digital temperature sensor (DS18B20) |
| DallasTemperature | `DallasTemperature` (by Miles Burton) | Works together with OneWire for KY-001 |
| DHT sensor library | `DHT sensor library` (by Adafruit) | KY-015 temperature & humidity sensor |
| Adafruit Unified Sensor | `Adafruit Unified Sensor` | Required dependency of the DHT library above — the IDE will prompt you to install it automatically |
| IRremote | `IRremote` (by Armin Joachimsmeyer) | KY-005 IR transmitter and KY-022 IR receiver |
| PulseSensor Playground | `PulseSensor Playground` | KY-039 heartbeat/pulse sensor (optional — you can also just use `analogRead()` and plot the raw waveform, which is often more instructive for students) |
| Encoder | `Encoder` (by Paul Stoffregen) | KY-040 rotary encoder (optional — makes clean step-counting much easier than hand-rolled interrupt code) |

**That's the full external list: 5 required, 2 optional.**

---

## 2. Built-in / core libraries (already in the Arduino IDE)

These ship with the IDE — no installation needed. This specific kit doesn't strictly require any of them, but they're worth knowing since you'll likely add components beyond the kit (LCDs, extra motors, Bluetooth, etc.):

| Library | What it's for |
|---|---|
| `Wire.h` | I2C communication — needed the moment you add an I2C LCD, OLED, or RTC module |
| `SPI.h` | SPI communication — needed for SD card modules, RFID readers, some displays |
| `Servo.h` | Servo motor control |
| `SoftwareSerial.h` | Serial communication on non-default pins — needed for HC-05/06 Bluetooth modules or GPS |
| `EEPROM.h` | Reading/writing to the board's persistent memory |

No core function needs a library at all for basic digital/analog work — `pinMode()`, `digitalRead()`, `digitalWrite()`, `analogRead()`, `analogWrite()`, and `tone()` are all built into the language itself.

---

## 3. Per-module library reference

| KY # | HW # (HiLetgo) | Module | Library required |
|---|---|---|---|
| KY-001 | HW-506 | Temperature sensor (DS18B20, digital) | OneWire + DallasTemperature |
| KY-002 | HW-513 | Vibration/shock switch | None |
| KY-003 | HW-492 | Hall magnetic sensor (digital) | None |
| KY-004 | HW-483 | Key switch (pushbutton) | None |
| KY-005 | HW-489 | Infrared transmitter | IRremote (to send codes) |
| KY-006 | HW-508 | Passive buzzer | None (`tone()`) |
| KY-008 | HW-493 | Laser transmitter | None |
| KY-009 | HW-478 | 2-color LED SMD module | None |
| KY-010 | HW-487 | Photo interrupter (light break) | None |
| KY-011 | HW-477 | 2-color LED (5mm) | None |
| KY-012 | HW-512 | Active buzzer | None |
| KY-013 | HW-498 | Analog temperature sensor (thermistor) | None (simple math on the analog reading) |
| KY-015 | HW-507 | Temperature & humidity (DHT11) | DHT sensor library + Adafruit Unified Sensor |
| KY-016 | HW-479 | RGB LED module | None |
| KY-017 | HW-505 | Mercury tilt switch | None |
| KY-018 | HW-486 | Photoresistor (light sensor) | None |
| KY-019 | HW-482 | 5V relay module | None |
| KY-020 | HW-501 | Tilt switch | None |
| KY-021 | HW-497 | Mini reed switch | None |
| KY-022 | HW-490 | Infrared receiver | IRremote |
| KY-023 | HW-504 | Joystick (dual-axis) | None |
| KY-024 | HW-509 | Linear Hall sensor (analog) | None |
| KY-025 | HW-484 | Reed switch | None |
| KY-026 | HW-491 | Flame sensor | None |
| KY-027 | HW-499 | Magic light cup (tilt + LED) | None |
| KY-028 | HW-503 | Digital temperature module | None |
| KY-029 | HW-480 | 2-color LED (3mm) | None |
| KY-031 | HW-500 | Knock/hit sensor | None |
| KY-032 | HW-488 | Obstacle avoidance (IR) | None |
| KY-033 | HW-511 | Line-tracking sensor | None |
| KY-034 | HW-481 | 7-color flashing LED | None (self-cycling, just needs power) |
| KY-035 | HW-495 | Hall sensor (analog) | None |
| KY-036 | HW-494 | Metal touch sensor | None |
| KY-037 | HW-485 | High-sensitivity sound sensor (large mic, digital+analog out) | None |
| KY-038 | HW-496 | Sound sensor (small mic, digital+analog out) | None |
| KY-039 | HW-502 | Heartbeat/pulse sensor | PulseSensor Playground (optional) |
| KY-040 | HW-040 | Rotary encoder | Encoder (optional) |

---

## 4. Suggested teaching order

1. **No-library modules first** — buttons, photoresistor, potentiometer-style analog reads. Builds `digitalRead`/`analogRead` fluency.
2. **`tone()` and buzzers** — immediate audible feedback, no library.
3. **First library install: OneWire + DallasTemperature (KY-001)** — a good "first library" because the API is simple and the payoff (an actual temperature reading) is concrete.
4. **DHT sensor library (KY-015)** — introduces reading two values from one sensor.
5. **IRremote (KY-005 / KY-022)** — more involved API, good once students are comfortable with libraries generally.
6. **Encoder / PulseSensor Playground** — save for last; these involve interrupts or signal filtering and are the most conceptually demanding.
