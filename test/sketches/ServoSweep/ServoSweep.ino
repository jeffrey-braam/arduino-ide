#include <Servo.h>
Servo s;
void setup() { s.attach(9); }
void loop() {
  for (int a = 0; a <= 180; a++) { s.write(a); delay(10); }
  for (int a = 180; a >= 0; a--) { s.write(a); delay(10); }
}
