/*
  KY-027 Magic light cup

  The LED fades up when the module is tilted and fades down when it's upright.
  With two modules you can "pour" the light from one cup to the other.

  Wiring (check the labels on your module):
    S (tilt switch) -> pin 2
    L (LED)         -> pin 5
    +               -> 5V
    G               -> GND
*/

const int TILT_PIN = 2;
const int LED_PIN = 5;  // a PWM pin, so the LED can fade
int brightness = 0;

void setup() {
  pinMode(TILT_PIN, INPUT);
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  if (digitalRead(TILT_PIN) == LOW) {
    brightness = min(brightness + 5, 255);  // tilted: fill up
  } else {
    brightness = max(brightness - 5, 0);    // upright: drain
  }
  analogWrite(LED_PIN, brightness);
  delay(20);
}
