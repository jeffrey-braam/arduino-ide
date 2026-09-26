# Arduino IDE — Project Details

> Edit this file freely. Fill in as much or as little as you like, then ask Claude to read it and build.
> Delete any prompts/sections that don't apply.

## Overview
<!-- What is this project? One or two sentences. e.g. "A lightweight desktop IDE for writing, compiling, and uploading Arduino sketches." -->
Super lightweight desktop IDE contained in a single file that can be opened on a Chromebook under school district network restrictions that can write, compile and upload arduino sketches via usb.


## Goals
<!-- What should it do? What problem does it solve? -->
Students' chromebooks are restricted by network admin and free online IDEs are typically blocked. I need a file I can have them download from Google Classroom that they can run on their chromebooks and perform the same functions as the Arduino.cc IDE.

## Target Platform
<!-- Windows / macOS / Linux / Web? Desktop app, browser app, VS Code extension, CLI? -->
Windows / macOS / ChromeOS / Linux

## Tech Stack
<!-- Language, UI framework, libraries. Leave blank if you want a recommendation. -->
- Language:
- UI framework:
- Build/compile backend (e.g. arduino-cli):

## Features
### Must have
- [X] Single-page web app using HTML/JS with a code editor for sketch text
- [X] Code editor with syntax highlighting
- [X] Compile sketches
- [X] Upload to board over serial
- [X] Board / port selection
- [X] Serial monitor

### Nice to have
- Ability to store files locally on chromebook
- No need for internet connection
- Compile client-side using WASM build of avr-gcc/arduino-cli

### Out of scope
-

## Supported Boards
<!-- e.g. Uno, Nano, Mega, ESP32, ESP8266, RP2040... -->
- Uno 3 (at minimum as these are the boards I have in my classroom)

## UI / Look & Feel
<!-- Layout, theme (dark/light), inspiration, sketches or references. -->
Work on UI after general build completion


## Constraints & Preferences
<!-- Anything I should know: performance targets, offline use, no external deps, code style, etc. -->
Running on school network chromebooks so no downloads are allowed, offline use would be ideal, nothing requiring external calls or requests


## Notes / Open Questions
<!-- Anything else. -->

