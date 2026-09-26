unsigned long n = 0;
void setup() { Serial.begin(9600); Serial.println("SerialEcho ready"); }
void loop() {
  while (Serial.available()) { String s = Serial.readStringUntil('\n'); Serial.print("echo:"); Serial.println(s); }
  static unsigned long last = 0;
  if (millis() - last >= 1000) { last = millis(); Serial.print("tick "); Serial.println(n++); }
}
