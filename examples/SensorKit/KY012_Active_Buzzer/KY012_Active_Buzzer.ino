/*
  KY-012 Active buzzer
  Printed on HiLetgo boards as HW-512

  Beeps in a pattern. An active buzzer makes its own sound when switched on,
  so it only needs digitalWrite (for different notes, use the KY-006 passive buzzer).

  Wiring (check the labels on your module; pin order varies between kits):
    S (signal)  -> pin 8
    middle pin  -> 5V
    - (minus)   -> GND
*/

const int BUZZER_PIN = 8;

void beep(int ms) {
  digitalWrite(BUZZER_PIN, HIGH);
  delay(ms);
  digitalWrite(BUZZER_PIN, LOW);
  delay(ms);
}

void setup() {
  pinMode(BUZZER_PIN, OUTPUT);
}

void loop() {
  beep(100);
  beep(100);
  beep(300);
  delay(1500);
}
