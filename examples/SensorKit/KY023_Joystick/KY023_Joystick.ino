/*
  KY-023 Joystick

  Prints the joystick position and whether it's pressed down.

  Wiring:
    GND  -> GND
    +5V  -> 5V
    VRx  -> A0
    VRy  -> A1
    SW   -> pin 2

  Open the Serial Plotter tab and move the stick to see both axes as lines.
*/

const int X_PIN = A0;
const int Y_PIN = A1;
const int BUTTON_PIN = 2;

void setup() {
  Serial.begin(9600);
  pinMode(BUTTON_PIN, INPUT_PULLUP);  // the button connects the pin to GND when pressed
}

void loop() {
  int x = analogRead(X_PIN);  // about 512 in the middle, 0 and 1023 at the ends
  int y = analogRead(Y_PIN);
  bool pressed = digitalRead(BUTTON_PIN) == LOW;

  Serial.print("x:");
  Serial.print(x);
  Serial.print(",y:");
  Serial.print(y);
  Serial.print(",button:");
  Serial.println(pressed ? 1023 : 0);
  delay(50);
}
