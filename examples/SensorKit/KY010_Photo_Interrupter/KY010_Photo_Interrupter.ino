/*
  KY-010 Photo interrupter (light gate)

  Counts how many times something passes through the slot.

  Wiring (check the labels on your module; pin order varies between kits):
    S (signal)  -> pin 3
    middle pin  -> 5V
    - (minus)   -> GND
*/

const int SENSOR_PIN = 3;
int lastState = LOW;
long count = 0;

void setup() {
  Serial.begin(9600);
  pinMode(SENSOR_PIN, INPUT);
}

void loop() {
  int state = digitalRead(SENSOR_PIN);
  if (state == HIGH && lastState == LOW) {  // the beam just got blocked
    count++;
    Serial.print("Count: ");
    Serial.println(count);
  }
  lastState = state;
  delay(5);
}
