/*
  KY-033 Line tracking sensor

  Tells a dark line from a light surface. Move the sensor over black tape on white paper.

  Wiring (check the labels on your module; pin order varies between kits):
    S (signal)  -> pin 3
    middle pin  -> 5V
    - (minus)   -> GND

  Hold the sensor 1-2 cm above the surface. The potentiometer adjusts the sensitivity.
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
  bool active = (state == HIGH);
  digitalWrite(LED_BUILTIN, active ? HIGH : LOW);  // the board's LED shows the sensor

  if (state != lastState) {  // only print when something changes
    Serial.println(active ? "On the line (dark)" : "Off the line (light)");
    lastState = state;
  }
  delay(10);
}
