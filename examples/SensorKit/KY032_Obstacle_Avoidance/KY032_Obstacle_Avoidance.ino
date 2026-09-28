/*
  KY-032 Infrared obstacle avoidance sensor
  Printed on HiLetgo boards as HW-488

  Detects an object in front of the sensor. Move your hand towards it.

  Wiring (check the labels on your module):
    OUT -> pin 3
    +   -> 5V
    GND -> GND
    EN  -> leave unconnected (or remove the jumper on some modules to use it)

  Adjust the potentiometers to change the detection distance.
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
  bool obstacle = (state == LOW);  // LOW means something is in front
  digitalWrite(LED_BUILTIN, obstacle);
  if (state != lastState) {
    Serial.println(obstacle ? "Obstacle!" : "Clear");
    lastState = state;
  }
  delay(10);
}
