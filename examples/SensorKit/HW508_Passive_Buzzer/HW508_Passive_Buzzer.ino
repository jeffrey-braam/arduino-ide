/*
  HW-508 Passive buzzer
  Same module as KY-006 in other sensor kits

  Plays a short tune with tone(). A passive buzzer can play different pitches;
  the active buzzer (HW-512) can only beep.

  Wiring (check the labels on your module; pin order varies between kits):
    S (signal)  -> pin 8
    middle pin  -> 5V
    - (minus)   -> GND
*/

const int BUZZER_PIN = 8;

// Notes of the tune in hertz (0 = rest) and how long each lasts in milliseconds.
int melody[] = { 262, 294, 330, 262, 262, 294, 330, 262, 330, 349, 392, 0, 330, 349, 392 };
int lengths[] = { 250, 250, 250, 250, 250, 250, 250, 250, 250, 250, 500, 50, 250, 250, 500 };
const int NOTES = sizeof(melody) / sizeof(melody[0]);

void setup() {
  for (int i = 0; i < NOTES; i++) {
    if (melody[i] > 0) tone(BUZZER_PIN, melody[i], lengths[i]);
    delay(lengths[i] * 1.3);  // a small gap between notes
  }
  noTone(BUZZER_PIN);
}

void loop() {
  // The tune plays once. Press the reset button on the Arduino to hear it again.
}
