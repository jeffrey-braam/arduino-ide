void setupLeds() { for (int p : LED_PINS) pinMode(p, OUTPUT); }
void blinkAll() {
  for (int p : LED_PINS) digitalWrite(p, HIGH);
  delay(BLINK_MS);
  for (int p : LED_PINS) digitalWrite(p, LOW);
  delay(BLINK_MS);
}
