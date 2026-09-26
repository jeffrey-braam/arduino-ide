/*
  KY-040 Rotary encoder

  Counts clicks as you turn the knob, and resets to zero when you press it.
  Uses the Encoder library (already included).

  Wiring:
    CLK -> pin 2
    DT  -> pin 3
    SW  -> pin 4
    +   -> 5V
    GND -> GND
*/

#include <Encoder.h>

Encoder knob(2, 3);  // CLK and DT: pins 2 and 3 can use interrupts, so no clicks are missed
const int BUTTON_PIN = 4;
long lastPosition = 0;

void setup() {
  Serial.begin(9600);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  Serial.println("Turn the knob");
}

void loop() {
  long position = knob.read() / 4;  // most KY-040s give 4 counts per click

  if (digitalRead(BUTTON_PIN) == LOW) {
    knob.write(0);
    position = 0;
  }
  if (position != lastPosition) {
    Serial.print("Position: ");
    Serial.println(position);
    lastPosition = position;
  }
}
