/*
  HW-492 Hall magnetic sensor
  Same module as KY-003 in other sensor kits

  Detects a magnet held near the sensor.

  Wiring (check the labels on your module; pin order varies between kits):
    S (signal)  -> pin 3
    middle pin  -> 5V
    - (minus)   -> GND

  Try both poles of the magnet: this sensor only reacts to one of them.
*/

const int SENSOR_PIN = 3;
int lastState = -1;

void setup() {
  Serial.begin(9600);
  pinMode(SENSOR_PIN, INPUT);
  pinMode(LED_BUILTIN, OUTPUT);
}

void loop() {
  int state = digitalRead(SENSOR_PIN);
  bool active = (state == LOW);
  digitalWrite(LED_BUILTIN, active ? HIGH : LOW);  // the board's LED shows the sensor

  if (state != lastState) {  // only print when something changes
    Serial.println(active ? "Magnet detected" : "No magnet");
    lastState = state;
  }
  delay(10);
}
