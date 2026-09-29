/*
  HW-490 Infrared receiver
  Same module as KY-022 in other sensor kits

  Prints the code of each button you press on an infrared remote control.
  Uses the IRremote library (already included).

  Wiring (check the labels on your module; pin order varies between kits):
    S (signal)  -> pin 2
    middle pin  -> 5V
    - (minus)   -> GND
*/

#include <IRremote.hpp>

const int IR_PIN = 2;

void setup() {
  Serial.begin(9600);
  IrReceiver.begin(IR_PIN, ENABLE_LED_FEEDBACK);  // the board's LED blinks on each signal
  Serial.println("Point a remote at the receiver and press a button");
}

void loop() {
  if (IrReceiver.decode()) {
    Serial.print("Button code: 0x");
    Serial.println(IrReceiver.decodedIRData.command, HEX);
    IrReceiver.resume();  // get ready for the next button
  }
}
