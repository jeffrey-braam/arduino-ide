struct Reading { int pin; int value; };
Reading take(int pin) { return Reading{pin, analogRead(pin)}; }
void report(const Reading &r);
void setup() { Serial.begin(9600); }
void loop() { report(take(A1)); delay(500); }
void report(const Reading &r) { Serial.print(r.pin); Serial.print('='); Serial.println(r.value); }
