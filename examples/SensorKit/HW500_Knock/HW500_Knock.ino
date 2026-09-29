/*
  HW-500 Knock sensor
  Same module as KY-031 in other sensor kits

  Counts knocks. Tap the sensor or the table next to it.

  Wiring (check the labels on your module; pin order varies between kits):
    S (signal)  -> pin 3
    middle pin  -> 5V
    - (minus)   -> GND
*/

const int SENSOR_PIN = 3;
long knocks = 0;
unsigned long lastKnock = 0;

void setup() {
  Serial.begin(9600);
  pinMode(SENSOR_PIN, INPUT);
}

void loop() {
  // A knock pulls the pin LOW briefly. Ignore bounces within 100 ms of the last knock.
  if (digitalRead(SENSOR_PIN) == LOW && millis() - lastKnock > 100) {
    knocks++;
    lastKnock = millis();
    Serial.print("Knock! Total: ");
    Serial.println(knocks);
  }
}
