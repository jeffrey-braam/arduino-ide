#include <DHT.h>
DHT dht(2, DHT11);
void setup() { Serial.begin(9600); dht.begin(); }
void loop() {
  float h = dht.readHumidity(), t = dht.readTemperature();
  if (isnan(h) || isnan(t)) { Serial.println("read failed"); return; }
  Serial.print(t); Serial.print(" C  "); Serial.print(h); Serial.println(" %");
  delay(2000);
}
