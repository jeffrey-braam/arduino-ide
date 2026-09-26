/*
  KY-039 Heartbeat sensor

  Shows the light passing through your fingertip. Each heartbeat makes a small bump in the graph.

  Wiring (check the labels on your module; pin order varies between kits):
    S (signal)  -> pin A0
    middle pin  -> 5V
    - (minus)   -> GND

  Rest a fingertip gently between the LED and the sensor, keep very still, and open the
  Serial Plotter tab. Room light affects it a lot: try shading your hand.
*/

const int SENSOR_PIN = A0;
float smooth = 0;

void setup() {
  Serial.begin(9600);
  smooth = analogRead(SENSOR_PIN);
}

void loop() {
  int raw = analogRead(SENSOR_PIN);
  smooth = smooth * 0.9 + raw * 0.1;  // smoothing hides flicker so the pulse stands out

  Serial.print("pulse:");
  Serial.println(smooth);
  delay(20);
}
