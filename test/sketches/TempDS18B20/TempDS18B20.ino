#include <OneWire.h>
#include <DallasTemperature.h>
OneWire wire(2);
DallasTemperature sensors(&wire);
void setup() { Serial.begin(9600); sensors.begin(); }
void loop() {
  sensors.requestTemperatures();
  Serial.println(sensors.getTempCByIndex(0));
  delay(1000);
}
