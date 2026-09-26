export const BOARDS = {
  uno: {
    name: "Arduino Uno",
    fqbn: "arduino:avr:uno",
    mcu: "atmega328p",
    fcpu: 16000000,
    upload: {
      protocol: "stk500v1",
      baudRate: 115200,
      pageSize: 128,
      maxSize: 32256, // 32 KB flash minus the 512-byte Optiboot bootloader
      signature: [0x1e, 0x95, 0x0f],
    },
  },
};

export const DEFAULT_BOARD = "uno";
