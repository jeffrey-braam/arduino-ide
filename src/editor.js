import { EditorView, basicSetup } from "codemirror";
import { EditorState, Compartment } from "@codemirror/state";
import { keymap, ViewPlugin, Decoration, MatchDecorator } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { completeFromList, completeAnyWord } from "@codemirror/autocomplete";
import { cpp, cppLanguage } from "@codemirror/lang-cpp";
import { oneDark } from "@codemirror/theme-one-dark";

// Arduino API names, highlighted and offered as completions.
const FUNCTIONS = [
  "setup", "loop", "pinMode", "digitalWrite", "digitalRead", "analogRead", "analogWrite", "analogReference",
  "delay", "delayMicroseconds", "millis", "micros", "tone", "noTone", "pulseIn", "pulseInLong", "shiftIn",
  "shiftOut", "attachInterrupt", "detachInterrupt", "digitalPinToInterrupt", "interrupts", "noInterrupts",
  "map", "constrain", "min", "max", "abs", "sq", "sqrt", "pow", "sin", "cos", "tan", "random", "randomSeed",
  "bitRead", "bitWrite", "bitSet", "bitClear", "bit", "lowByte", "highByte", "isDigit", "isAlpha", "isSpace",
];
const CONSTANTS = [
  "HIGH", "LOW", "INPUT", "OUTPUT", "INPUT_PULLUP", "LED_BUILTIN", "A0", "A1", "A2", "A3", "A4", "A5",
  "CHANGE", "RISING", "FALLING", "LSBFIRST", "MSBFIRST", "DEC", "HEX", "BIN", "OCT", "PROGMEM", "F",
];
const TYPES = ["boolean", "byte", "word", "String"];
const OBJECTS = ["Serial"];
const SERIAL_METHODS = [
  "begin", "end", "print", "println", "write", "available", "read", "peek", "flush", "parseInt", "parseFloat",
  "readString", "readStringUntil", "readBytes", "setTimeout", "availableForWrite",
];

const HIGHLIGHT_WORDS = [...FUNCTIONS, ...CONSTANTS, ...TYPES, ...OBJECTS];

const arduinoMatcher = new MatchDecorator({
  regexp: new RegExp("\\b(?:" + HIGHLIGHT_WORDS.join("|") + ")\\b", "g"),
  decoration: Decoration.mark({ class: "cm-arduino" }),
});
const arduinoHighlight = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = arduinoMatcher.createDeco(view);
    }
    update(u) {
      this.decorations = arduinoMatcher.updateDeco(u, this.decorations);
    }
  },
  { decorations: (v) => v.decorations },
);

const arduinoCompletions = completeFromList([
  ...FUNCTIONS.map((label) => ({ label, type: "function" })),
  ...CONSTANTS.map((label) => ({ label, type: "constant" })),
  ...TYPES.map((label) => ({ label, type: "type" })),
  ...OBJECTS.map((label) => ({ label, type: "variable" })),
  ...SERIAL_METHODS.map((m) => ({ label: "Serial." + m, type: "method" })),
]);

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

export function createEditor(parent, { doc, onChange, keys = [] }) {
  const theme = new Compartment();
  const extensions = () => [
    basicSetup,
    keymap.of([...keys, indentWithTab]),
    cpp(),
    cppLanguage.data.of({ autocomplete: arduinoCompletions }),
    cppLanguage.data.of({ autocomplete: completeAnyWord }),
    arduinoHighlight,
    indentUnit.of("  "),
    EditorState.tabSize.of(2),
    theme.of(darkQuery.matches ? oneDark : []),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) onChange(u.state.doc.toString());
    }),
  ];

  const view = new EditorView({ parent, state: EditorState.create({ doc, extensions: extensions() }) });

  darkQuery.addEventListener("change", () => {
    view.dispatch({ effects: theme.reconfigure(darkQuery.matches ? oneDark : []) });
  });

  return {
    view,
    getText: () => view.state.doc.toString(),
    // Replaces the document and clears undo history (used when opening another sketch).
    setText(text) {
      view.setState(EditorState.create({ doc: text, extensions: extensions() }));
    },
    focus: () => view.focus(),
  };
}
