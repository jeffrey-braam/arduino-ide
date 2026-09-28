# Sensor Kit Inventory

Fill this out from the actual boards in the kit. Claude will use it to identify each module, match it
to its KY equivalent, and update `arduino-sensor-libraries.md` and the example sketches.

**Tips**
- Copy text exactly as printed, even if it looks like gibberish (for example `HW-040`, `S + -`, `DO AO`).
- Leave a cell blank if you're not sure. Blank is better than a guess.
- The **Pins** column matters most for wiring: list the pin labels in order, left to right.
- Boards with no number at all go in the second table.

---

## About the kit

- **Brand / seller:** HiLetgo
- **Name on the box or listing:** HiLetgo 37 sensors assortment kit
- **Number of boards in the kit:** 37 (36 with an HW- number, plus the obstacle-avoidance board)
- **Anything else in the box** (cables, breadboard, board, and so on): nothing else

---

## Boards with an HW- number

| # | HW number | KY match | Other text printed on the board | Pins, left to right | What's on it (describe what you see) | Notes |
|---|---|---|---|---|---|---|
| example | HW-040 | KY-040 Rotary encoder | CLK DT SW | CLK, DT, SW, +, GND | Knob that clicks when turned and pushes down | |
| 1 | HW-482 | KY-019 Relay | ON LED, R1, Q1 | S, +, - | Large blue box with current and voltage numbers | |
| 2 |  | KY-032 Obstacle avoidance (IR); should be HW-488 | PLED, SLED, GND, EN, +, OUT, R1, R2, R3, R4, RX | GND, +, OUT, EN | 2 blue potientiometers with a light and camera | box has it labeled "avoid" |
| 3 | HW-494 | KY-036 Metal touch sensor |  | A0, G, +, D0 | One transistor connected by only 2 pins, BAOTER3296 |   |
| 4 | HW-500 | KY-031 Knock sensor |  | | plastic box with metal piece inside | Labeled "Light Blocking" |
| 5 | HW-506 | KY-001 Temperature sensor (DS18B20) | R1, L+ | S, +, - | Single transistor | |
| 6 | HW-513 | KY-002 Vibration / shock switch | S1, R1 | | | |
| 7 | HW-512 | KY-012 Active buzzer | | +, - | | |
| 8 | HW-481 | KY-034 7-color flashing LED | | +, - | Single LED | |
| 9 | HW-487 | KY-010 Photo interrupter (light blocking) | R Hr T Lcup | | | V0.3.0 |
| 10 | HW-493 | KY-008 Laser | R1 S | S, - | | |
| 11 | HW-499 | KY-027 Magic light cup | CupA S1 | L, -, S, + | | |
| 12 | HW-505 | KY-017 Mercury tilt switch | | | | |
| 13 | HW-511 | KY-033 Line tracking | | | | |
| 14 | HW-480 | KY-029 Two-color LED (3mm) | | | | |
| 15 | HW-486 | KY-018 Photoresistor | | | | |
| 16 | HW-492 | KY-003 Hall magnetic sensor (digital) | | | | |
| 17 | HW-498 | KY-013 Analog temperature (thermistor) | | | | |
| 18 | HW-504 | KY-023 Joystick | | | | |
| 19 | HW-040 | KY-040 Rotary encoder | | | | |
| 20 | HW-479 | KY-016 RGB LED | | | | |
| 21 | HW-485 | KY-037 Microphone, large (high sensitivity) | | | | |
| 22 | HW-491 | KY-026 Flame sensor | | | | |
| 23 | HW-497 | KY-021 Mini reed switch | | | | |
| 24 | HW-503 | KY-028 Digital temperature | | | | |
| 25 | HW-509 | KY-024 Linear Hall sensor | | | | |
| 26 | HW-478 | KY-009 RGB LED (SMD) | | | | |
| 27 | HW-484 | KY-025 Reed switch | | | | |
| 28 | HW-490 | KY-022 IR receiver | | | | |
| 29 | HW-502 | KY-039 Heartbeat sensor | | | | |
| 30 | HW-496 | KY-038 Microphone, small | | | | |
| 31 | HW-508 | KY-006 Passive buzzer | | | | |
| 32 | HW-477 | KY-011 Two-color LED (5mm) | | | | |
| 33 | HW-483 | KY-004 Push button | | | | |
| 34 | HW-489 | KY-005 IR transmitter | | | | |
| 35 | HW-495 | KY-035 Analog Hall sensor | | | | |
| 36 | HW-501 | KY-020 Tilt switch (ball) | | | | |
| 37 | HW-507 | KY-015 Temperature & humidity (DHT11) | | | | |
| 38 | |  | | | | |
| 39 | |  | | | | |
| 40 | |  | | | | |

---

## Boards with no HW number

| # | Other text printed on the board | Pins, left to right | What's on it (describe what you see) | Notes |
|---|---|---|---|---|
| example | KY-008 | S, (blank), - | Small metal tube with a red lens on the end | Might be the laser |
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |
| 4 | | | | |
| 5 | | | | |

---

## Anything else

Missing pieces, damaged boards, or questions:

- All 37 KY modules in `arduino-sensor-libraries.md` are accounted for: each HW- number matches exactly one KY- number.
  The **KY match** column was filled in from published HW-to-KY lists for this kit (sources below), then checked
  against the pins and descriptions above where those were filled in.
- **Row 2 (no HW number found):** this is the KY-032 obstacle-avoidance board. In this kit it is normally HW-488, and
  it's the only number missing from the HW-477 to HW-513 run (HW-510 isn't in the kit). The number may be on the back.
- **Row 4 (HW-500) vs. row 9 (HW-487):** HW-500 is the knock sensor (a spring inside a plastic case), even though it
  was stored in the compartment labeled "Light Blocking". HW-487 is the actual light-blocking board (a black U-shaped
  slot). The text recorded for HW-487 ("R Hr T Lcup") sounds more like a light cup board, so it's worth a second look.
- **Two-color LEDs:** HW-477 has the 5mm LED (KY-011) and HW-480 has the 3mm LED (KY-029). You can tell them apart by LED size.
- **Microphones:** HW-485 has the large microphone (KY-037) and HW-496 has the small one (KY-038).
- Sources: [IoT Project Kit, HiLetgo 37-in-1](https://www.iotprojectkit.com/sensor-assortments/hiletgo-37-in-1/),
  [renttalent.dk module list](https://blog.renttalent.dk/2020/12/identifying-geekcriet-modules-from-37.html),
  [USC Makers component kit](https://viterbimakers.usc.edu/docs/docs/components/).
