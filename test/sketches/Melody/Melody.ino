// Calls playNote() before it is defined: needs the IDE's automatic prototypes.
int notes[] = {262, 294, 330, 349, 392};
void setup() {
  for (int i = 0; i < 5; i++) playNote(notes[i], 200);
}
void loop() {}
void playNote(int freq, int ms) {
  tone(8, freq, ms);
  delay(ms * 1.3);
}
