/*
  HW-481 Seven-colour flashing LED
  Same module as KY-034 in other sensor kits

  This LED changes colour by itself; the Arduino just switches it on and off.

  Wiring (check the labels on your module; pin order varies between kits):
    S (signal)  -> pin 7
    middle pin  -> 5V
    - (minus)   -> GND
*/

const int LED_PIN = 7;

void setup() {
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  digitalWrite(LED_PIN, HIGH);  // on: watch it cycle through its colours
  delay(8000);
  digitalWrite(LED_PIN, LOW);   // off for a moment
  delay(1000);
}
