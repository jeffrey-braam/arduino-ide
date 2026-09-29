/*
  HW-478 RGB LED (SMD)
  Same module as KY-009 in other sensor kits

  Cycles the LED through red, green, blue and mixed colours.

  Wiring (check the labels on your module):
    R -> pin 9
    G -> pin 10
    B -> pin 11
    - -> GND

  If your module only has two colour pins, use the HW477 example instead.
*/

const int RED_PIN = 9;
const int GREEN_PIN = 10;
const int BLUE_PIN = 11;

void setColor(int red, int green, int blue) {
  analogWrite(RED_PIN, red);    // 0 = off, 255 = full brightness
  analogWrite(GREEN_PIN, green);
  analogWrite(BLUE_PIN, blue);
}

void setup() {
  pinMode(RED_PIN, OUTPUT);
  pinMode(GREEN_PIN, OUTPUT);
  pinMode(BLUE_PIN, OUTPUT);
}

void loop() {
  setColor(255, 0, 0);    delay(700);  // red
  setColor(0, 255, 0);    delay(700);  // green
  setColor(0, 0, 255);    delay(700);  // blue
  setColor(255, 255, 0);  delay(700);  // yellow
  setColor(0, 255, 255);  delay(700);  // cyan
  setColor(255, 0, 255);  delay(700);  // magenta
  setColor(255, 255, 255); delay(700); // white
}
