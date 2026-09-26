# Arduino Libraries — 37-in-1 KY Sensor Kit

This covers the HiLetgo/generic "37-in-1" sensor kit (KY-001 through KY-040). Most modules need **no library at all** — they're plain analog or digital signals. Only a handful require you to install something.

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

| KY # | Module | Library required |
|---|---|---|
| KY-001 | Temperature sensor (DS18B20, digital) | OneWire + DallasTemperature |
| KY-002 | Vibration/shock switch | None |
| KY-003 | Hall magnetic sensor (digital) | None |
| KY-004 | Key switch (pushbutton) | None |
| KY-005 | Infrared transmitter | IRremote (to send codes) |
| KY-006 | Passive buzzer | None (`tone()`) |
| KY-008 | Laser transmitter | None |
| KY-009 | 2-color LED SMD module | None |
| KY-010 | Photo interrupter (light break) | None |
| KY-011 | Bi-color LED (5mm) | None |
| KY-012 | Active buzzer | None |
| KY-013 | Analog temperature sensor (thermistor) | None (simple math on the analog reading) |
| KY-015 | Temperature & humidity (DHT11) | DHT sensor library + Adafruit Unified Sensor |
| KY-016 | RGB LED module | None |
| KY-017 | Mercury tilt switch | None |
| KY-018 | Photoresistor (light sensor) | None |
| KY-019 | 5V relay module | None |
| KY-020 | Tilt switch | None |
| KY-021 | Mini reed switch | None |
| KY-022 | Infrared receiver | IRremote |
| KY-023 | Joystick (dual-axis) | None |
| KY-024 | Linear Hall sensor (analog) | None |
| KY-025 | Reed switch | None |
| KY-026 | Flame sensor | None |
| KY-027 | Magic light cup (tilt + LED) | None |
| KY-028 | Digital temperature module | None |
| KY-029 | 2-color LED (3mm) | None |
| KY-031 | Knock/hit sensor | None |
| KY-032 | Obstacle avoidance (IR) | None |
| KY-033 | Line-tracking sensor | None |
| KY-034 | 7-color flashing LED | None (self-cycling, just needs power) |
| KY-035 | Hall sensor (analog) | None |
| KY-036 | Metal touch sensor | None |
| KY-037 | Sensitive microphone (small) | None |
| KY-038 | Sound sensor (large mic, digital+analog out) | None |
| KY-039 | Heartbeat/pulse sensor | PulseSensor Playground (optional) |
| KY-040 | Rotary encoder | Encoder (optional) |

---

## 4. Suggested teaching order

1. **No-library modules first** — buttons, photoresistor, potentiometer-style analog reads. Builds `digitalRead`/`analogRead` fluency.
2. **`tone()` and buzzers** — immediate audible feedback, no library.
3. **First library install: OneWire + DallasTemperature (KY-001)** — a good "first library" because the API is simple and the payoff (an actual temperature reading) is concrete.
4. **DHT sensor library (KY-015)** — introduces reading two values from one sensor.
5. **IRremote (KY-005 / KY-022)** — more involved API, good once students are comfortable with libraries generally.
6. **Encoder / PulseSensor Playground** — save for last; these involve interrupts or signal filtering and are the most conceptually demanding.
