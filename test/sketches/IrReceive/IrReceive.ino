#include <IRremote.hpp>
void setup() { Serial.begin(9600); IrReceiver.begin(2, ENABLE_LED_FEEDBACK); }
void loop() {
  if (IrReceiver.decode()) { IrReceiver.printIRResultShort(&Serial); IrReceiver.resume(); }
}
