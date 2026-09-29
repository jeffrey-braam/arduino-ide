/*
  HW-480 Two-colour LED (3 mm)
  Same module as KY-029 in other sensor kits

  Fades between red and green.

  Wiring (check the labels on your module):
    R (or S) -> pin 10   (red)
    G (middle) -> pin 11 (green)
    - (minus)  -> GND
*/

const int RED_PIN = 10;
const int GREEN_PIN = 11;

void setup() {
  pinMode(RED_PIN, OUTPUT);
  pinMode(GREEN_PIN, OUTPUT);
}

void loop() {
  // Fade from red to green and back. analogWrite sets brightness 0-255.
  for (int i = 0; i <= 255; i++) {
    analogWrite(RED_PIN, 255 - i);
    analogWrite(GREEN_PIN, i);
    delay(8);
  }
  for (int i = 255; i >= 0; i--) {
    analogWrite(RED_PIN, 255 - i);
    analogWrite(GREEN_PIN, i);
    delay(8);
  }
}
