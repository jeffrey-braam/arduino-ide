/*
  KY-008 Laser transmitter

  Switches the laser on and off every second.

  Wiring (check the labels on your module; pin order varies between kits):
    S (signal)  -> pin 7
    middle pin  -> 5V
    - (minus)   -> GND

  Never point the laser at anyone's eyes.
*/

const int LASER_PIN = 7;

void setup() {
  pinMode(LASER_PIN, OUTPUT);
}

void loop() {
  digitalWrite(LASER_PIN, HIGH);  // on
  delay(1000);
  digitalWrite(LASER_PIN, LOW);   // off
  delay(1000);
}
