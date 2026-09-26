String name = "Uno";
void setup() {
  Serial.begin(9600);
  float v = analogRead(A0) * (5.0 / 1023.0);
  String msg = "Hello " + name + ", voltage=" + String(v, 2);
  Serial.println(msg);
  char buf[12];
  dtostrf(sqrt(v) * PI, 6, 3, buf);
  Serial.println(buf);
}
void loop() {}
