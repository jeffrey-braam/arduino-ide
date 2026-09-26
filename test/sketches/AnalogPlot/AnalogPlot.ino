void setup() { Serial.begin(9600); }
void loop() {
  int raw = analogRead(A0);
  int percent = map(raw, 0, 1023, 0, 100);
  Serial.print("light:"); Serial.println(percent);
  delay(50);
}
