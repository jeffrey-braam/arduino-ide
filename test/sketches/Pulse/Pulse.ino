#define USE_ARDUINO_INTERRUPTS true
#include <PulseSensorPlayground.h>
PulseSensorPlayground pulse;
void setup() { Serial.begin(115200); pulse.analogInput(A0); pulse.setThreshold(550); pulse.begin(); }
void loop() {
  if (pulse.sawStartOfBeat()) { Serial.print("BPM: "); Serial.println(pulse.getBeatsPerMinute()); }
  delay(20);
}
