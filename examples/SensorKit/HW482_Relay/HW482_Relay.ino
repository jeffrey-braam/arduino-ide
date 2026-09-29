/*
  HW-482 Relay
  Same module as KY-019 in other sensor kits

  Switches the relay on and off every two seconds. You'll hear it click and see its LED.

  Wiring (check the labels on your module; pin order varies between kits):
    S (signal)  -> pin 7
    middle pin  -> 5V
    - (minus)   -> GND

  Only switch low voltages (batteries, small motors) with the relay in class. Never mains power.
*/

const int RELAY_PIN = 7;

void setup() {
  Serial.begin(9600);
  pinMode(RELAY_PIN, OUTPUT);
}

void loop() {
  digitalWrite(RELAY_PIN, HIGH);
  Serial.println("Relay ON");
  delay(2000);
  digitalWrite(RELAY_PIN, LOW);
  Serial.println("Relay OFF");
  delay(2000);
}
