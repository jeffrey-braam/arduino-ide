/*
  KY-015 Temperature and humidity sensor (DHT11)
  Printed on HiLetgo boards as HW-507

  Prints the temperature and humidity every two seconds.
  Uses the DHT sensor library (already included).

  Wiring (check the labels on your module; pin order varies between kits):
    S (signal)  -> pin 2
    middle pin  -> 5V
    - (minus)   -> GND
*/

#include <DHT.h>

DHT dht(2, DHT11);  // data pin, sensor type

void setup() {
  Serial.begin(9600);
  dht.begin();
}

void loop() {
  delay(2000);  // the DHT11 can only measure every couple of seconds
  float humidity = dht.readHumidity();
  float celsius = dht.readTemperature();

  if (isnan(humidity) || isnan(celsius)) {
    Serial.println("Couldn't read the sensor - check the wiring");
    return;
  }
  Serial.print("temperature:");
  Serial.print(celsius);
  Serial.print(",humidity:");
  Serial.println(humidity);
}
