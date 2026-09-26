#include "config.h"
void setup() { Serial.begin(BAUD); setupLeds(); }
void loop() { blinkAll(); }
