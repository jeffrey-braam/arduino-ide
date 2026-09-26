import { EditorView, basicSetup } from "codemirror";
import { EditorState, Compartment } from "@codemirror/state";
import { keymap, ViewPlugin, Decoration, MatchDecorator } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { completeFromList, completeAnyWord } from "@codemirror/autocomplete";
import { cpp, cppLanguage } from "@codemirror/lang-cpp";
import { oneDark } from "@codemirror/theme-one-dark";
import { setDiagnostics, lintGutter } from "@codemirror/lint";

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

export function createEditor(parent, { doc, onChange }) {
  const theme = new Compartment();
  const extensions = () => [
    basicSetup,
    keymap.of([indentWithTab]),
    cpp(),
    cppLanguage.data.of({ autocomplete: arduinoCompletions }),
    cppLanguage.data.of({ autocomplete: completeAnyWord }),
    arduinoHighlight,
    lintGutter(),
    indentUnit.of("  "),
    EditorState.tabSize.of(2),
    theme.of(darkQuery.matches ? oneDark : []),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) onChange(u.state.doc.toString());
    }),
  ];

  const view = new EditorView({ parent, state: EditorState.create({ doc, extensions: extensions() }) });
  const applyTheme = () => view.dispatch({ effects: theme.reconfigure(darkQuery.matches ? oneDark : []) });
  darkQuery.addEventListener("change", applyTheme);

  // One editor state per open file (tab), so each keeps its own undo history and cursor.
  const states = new Map();
  let currentKey = null;

  return {
    // Shows the file `key`, creating its state from `text` the first time.
    show(key, text) {
      if (currentKey !== null) states.set(currentKey, view.state);
      currentKey = key;
      view.setState(states.get(key) ?? EditorState.create({ doc: text, extensions: extensions() }));
      applyTheme(); // a stored state may predate a light/dark switch
    },
    // Forgets every stored state (another sketch was opened).
    reset() {
      states.clear();
      currentKey = null;
    },
    forget(key) {
      states.delete(key);
    },
    rename(oldKey, newKey) {
      if (states.has(oldKey)) states.set(newKey, states.get(oldKey));
      states.delete(oldKey);
      if (currentKey === oldKey) currentKey = newKey;
    },
    focus: () => view.focus(),

    // Adds #include lines after the includes already at the top of the file (or at line 1).
    insertIncludes(lines) {
      const doc = view.state.doc;
      let after = 0; // line number of the last leading #include, 0 if none
      for (let n = 1; n <= doc.lines; n++) {
        const text = doc.line(n).text.trim();
        if (/^#\s*include\b/.test(text)) after = n;
        else if (text && !text.startsWith("//") && !text.startsWith("/*") && !text.startsWith("*")) break;
      }
      const at = after ? doc.line(after).to : 0;
      const insert = after ? "\n" + lines.join("\n") : lines.join("\n") + "\n\n";
      view.dispatch({ changes: { from: at, insert }, selection: { anchor: at + insert.length }, scrollIntoView: true });
      view.focus();
    },

    // Compiler messages as underlines + gutter markers. items: { line, column, severity, message }
    showDiagnostics(items) {
      const doc = view.state.doc;
      const diagnostics = items
        .filter((d) => d.line >= 1 && d.line <= doc.lines)
        .map((d) => {
          const line = doc.line(d.line);
          const from = Math.min(line.to, line.from + Math.max(0, d.column - 1));
          // Underline the word at the column, or the whole line if there isn't one.
          const word = view.state.wordAt(from);
          const [start, end] = word && word.from >= line.from ? [word.from, word.to] : [line.from, line.to];
          const to = end > start ? end : Math.min(line.to, start + 1);
          return { from: start, to, severity: d.severity === "note" ? "info" : d.severity, message: d.message };
        });
      view.dispatch(setDiagnostics(view.state, diagnostics));
    },

    goTo(lineNumber, column = 1) {
      const doc = view.state.doc;
      const line = doc.line(Math.min(Math.max(1, lineNumber), doc.lines));
      const pos = Math.min(line.to, line.from + Math.max(0, column - 1));
      view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }) });
      view.focus();
    },
  };
}
