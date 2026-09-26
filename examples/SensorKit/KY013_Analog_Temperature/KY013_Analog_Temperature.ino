/*
  KY-013 Analog temperature sensor (thermistor)

  Works out the temperature from the thermistor's resistance and prints it.

  Wiring (check the labels on your module; pin order varies between kits):
    S (signal)  -> pin A0
    middle pin  -> 5V
    - (minus)   -> GND

  Some KY-013 boards are labelled the other way round. If the temperature goes DOWN when
  you warm the sensor, swap the wires on the outer two pins.
*/

const int SENSOR_PIN = A0;
const float SERIES_RESISTOR = 10000.0;  // the 10k resistor on the module

// Steinhart-Hart coefficients for the kit's 10k thermistor
const float C1 = 0.001129148, C2 = 0.000234125, C3 = 0.0000000876741;

void setup() {
  Serial.begin(9600);
}

void loop() {
  int raw = analogRead(SENSOR_PIN);
  if (raw == 0) raw = 1;  // avoid dividing by zero
  float resistance = SERIES_RESISTOR * (1023.0 / raw - 1.0);
  float logR = log(resistance);
  float kelvin = 1.0 / (C1 + C2 * logR + C3 * logR * logR * logR);
  float celsius = kelvin - 273.15;

  Serial.print("temperature:");
  Serial.println(celsius);
  delay(500);
}
