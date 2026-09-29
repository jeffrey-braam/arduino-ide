/*
  HW-506 Temperature sensor (DS18B20)
  Same module as KY-001 in other sensor kits

  Prints the temperature in Celsius once a second.
  Uses the OneWire and DallasTemperature libraries (already included).

  Wiring (check the labels on your module; pin order varies between kits):
    S (signal)  -> pin 2
    middle pin  -> 5V
    - (minus)   -> GND
*/

#include <OneWire.h>
#include <DallasTemperature.h>

OneWire oneWire(2);                 // the data pin
DallasTemperature sensors(&oneWire);

void setup() {
  Serial.begin(9600);
  sensors.begin();
}

void loop() {
  sensors.requestTemperatures();             // ask the sensor to measure
  float celsius = sensors.getTempCByIndex(0);

  if (celsius == DEVICE_DISCONNECTED_C) {
    Serial.println("No sensor found - check the wiring");
  } else {
    Serial.print("temperature:");
    Serial.println(celsius);
  }
  delay(1000);
}
