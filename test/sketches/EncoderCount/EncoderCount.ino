#include <Encoder.h>
Encoder knob(2, 3);
long last = -999;
void setup() { Serial.begin(9600); }
void loop() {
  long pos = knob.read();
  if (pos != last) { last = pos; Serial.println(pos); }
}
