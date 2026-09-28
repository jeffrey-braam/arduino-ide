/*
  KY-035 Analog Hall magnetic sensor
  Printed on HiLetgo boards as HW-495

  Measures a magnetic field. The value moves up or down depending on which pole of a magnet is near.

  Wiring (check the labels on your module; pin order varies between kits):
    S (signal) -> A0
    middle pin  -> 5V
    - (minus)   -> GND

  With no magnet nearby the value sits in the middle, around 512.
*/

const int SENSOR_PIN = A0;

void setup() {
  Serial.begin(9600);
}

void loop() {
  int value = analogRead(SENSOR_PIN);  // 0 to 1023

  // Open the Serial Plotter tab to see this as a graph.
  Serial.print("magnet:");
  Serial.println(value);
  delay(50);
}
