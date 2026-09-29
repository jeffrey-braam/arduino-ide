/*
  HW-486 Photoresistor (light sensor)
  Same module as KY-018 in other sensor kits

  Prints the light level. Cover the sensor or shine a torch on it.

  Wiring (check the labels on your module; pin order varies between kits):
    S (signal) -> A0
    middle pin  -> 5V
    - (minus)   -> GND

  On most modules the number goes DOWN as it gets brighter.
*/

const int SENSOR_PIN = A0;

void setup() {
  Serial.begin(9600);
}

void loop() {
  int value = analogRead(SENSOR_PIN);  // 0 to 1023

  // Open the Serial Plotter tab to see this as a graph.
  Serial.print("light:");
  Serial.println(value);
  delay(50);
}
