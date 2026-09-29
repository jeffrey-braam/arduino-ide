/*
  HW-489 Infrared transmitter
  Same module as KY-005 in other sensor kits

  Sends an infrared remote-control code (NEC protocol) once a second.
  Point it at an HW-490 receiver running the HW490 example to see the codes arrive.
  Uses the IRremote library (already included).

  Wiring (check the labels on your module; pin order varies between kits):
    S (signal)  -> pin 3
    middle pin  -> 5V
    - (minus)   -> GND

  The IR light is invisible, but most phone cameras can see it flash.
*/

#include <IRremote.hpp>

const int IR_PIN = 3;  // IRremote sends on pin 3 on the Uno

void setup() {
  Serial.begin(9600);
  IrSender.begin(IR_PIN);
}

void loop() {
  uint8_t address = 0x00;
  uint8_t command = 0x45;  // try changing this number
  IrSender.sendNEC(address, command, 0);
  Serial.print("Sent command 0x");
  Serial.println(command, HEX);
  delay(1000);
}
