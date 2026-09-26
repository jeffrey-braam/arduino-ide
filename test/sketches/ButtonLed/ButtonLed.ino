const int BUTTON = 2;
void setup() {
  pinMode(BUTTON, INPUT_PULLUP);
  pinMode(LED_BUILTIN, OUTPUT);
}
void loop() {
  digitalWrite(LED_BUILTIN, digitalRead(BUTTON) == LOW ? HIGH : LOW);
}
