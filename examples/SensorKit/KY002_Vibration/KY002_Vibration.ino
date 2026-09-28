/*
  KY-002 Vibration switch
  Printed on HiLetgo boards as HW-513

  Lights the board's LED and prints a message while the module is shaken.

  Wiring (check the labels on your module; pin order varies between kits):
    S (signal)  -> pin 3
    middle pin  -> 5V
    - (minus)   -> GND
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
    Serial.println(active ? "Shaking!" : "Still");
    lastState = state;
  }
  delay(10);
}
