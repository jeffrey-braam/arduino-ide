/*
  HW-491 Flame sensor
  Same module as KY-026 in other sensor kits

  Detects infrared light from a flame (or a TV remote pointed at it).

  Wiring (check the labels on your module):
    AO (analog)  -> A0
    G  (ground)  -> GND
    +  (power)   -> 5V
    DO (digital) -> pin 3
  Turn the small screw on the blue potentiometer to set when DO switches.

  Test it with a lighter only with your teacher's permission.
*/

const int ANALOG_PIN = A0;
const int DIGITAL_PIN = 3;

void setup() {
  Serial.begin(9600);
  pinMode(DIGITAL_PIN, INPUT);
  pinMode(LED_BUILTIN, OUTPUT);
}

void loop() {
  int level = analogRead(ANALOG_PIN);        // 0 to 1023
  int triggered = digitalRead(DIGITAL_PIN);  // HIGH or LOW, set by the potentiometer
  digitalWrite(LED_BUILTIN, triggered);

  // "name:value" pairs can be graphed in the Serial Plotter tab.
  Serial.print("flame:");
  Serial.print(level);
  Serial.print(",digital:");
  Serial.println(triggered * 1023);
  delay(50);
}
