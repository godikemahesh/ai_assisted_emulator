// Shared constants for the 8086 emulator engine.

/** 1 MiB of physical memory: the full 20-bit 8086 address space (00000h–FFFFFh). */
export const MEMORY_SIZE = 0x100000;

/** 16-bit general registers in 8086 encoding order (ModR/M "reg" field values 0–7). */
export const REG16 = ['AX', 'CX', 'DX', 'BX', 'SP', 'BP', 'SI', 'DI'];

/** 8-bit registers in 8086 encoding order. AL..BL are low halves, AH..BH are high halves. */
export const REG8 = ['AL', 'CL', 'DL', 'BL', 'AH', 'CH', 'DH', 'BH'];

/** Segment registers in 8086 encoding order. */
export const SREG = ['ES', 'CS', 'SS', 'DS'];
export const SEG = { ES: 0, CS: 1, SS: 2, DS: 3 };

/**
 * Where programs are placed when they are loaded.
 * Code, data and stack live in different segments so students can see
 * segment:offset -> physical address translation in action.
 */
export const DEFAULT_SEGMENTS = Object.freeze({ CS: 0x1000, DS: 0x2000, ES: 0x2000, SS: 0x3000 });
export const DEFAULT_SP = 0xfffe;

/** Bit positions of the flags inside the 16-bit FLAGS register. */
export const FLAG_BITS = Object.freeze({
  CF: 0, PF: 2, AF: 4, ZF: 6, SF: 7, TF: 8, IF: 9, DF: 10, OF: 11,
});

/** Display order, most significant first (as drawn in most 8086 textbooks). */
export const FLAG_ORDER = ['OF', 'DF', 'IF', 'TF', 'SF', 'ZF', 'AF', 'PF', 'CF'];

export const FLAG_NAMES = Object.freeze({
  CF: 'Carry', PF: 'Parity', AF: 'Auxiliary carry', ZF: 'Zero', SF: 'Sign',
  TF: 'Trap', IF: 'Interrupt enable', DF: 'Direction', OF: 'Overflow',
});

/** Bit 1 of FLAGS is reserved and always reads as 1 on the 8086. */
export const FLAGS_RESERVED = 0x0002;

/** Safety limit so an infinite loop cannot freeze the browser. */
export const DEFAULT_MAX_STEPS = 100000;

/** Maximum number of trace entries kept in memory. */
export const MAX_TRACE = 5000;

export const MASK = { 8: 0xff, 16: 0xffff };
export const SIGN = { 8: 0x80, 16: 0x8000 };
