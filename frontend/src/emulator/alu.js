// Arithmetic/logic unit: computes results and the flags they produce.
// Every function returns { result, flags } and never touches CPU state itself.

import { MASK, SIGN } from './constants.js';

/** PF is set when the LOW 8 bits of the result contain an even number of 1 bits. */
export function parity(value) {
  let v = value & 0xff;
  let ones = 0;
  while (v) {
    ones += v & 1;
    v >>= 1;
  }
  return ones % 2 === 0;
}

/** Sign, zero and parity flags, which almost every arithmetic/logic result sets. */
export function szp(result, size) {
  return { SF: (result & SIGN[size]) !== 0, ZF: result === 0, PF: parity(result) };
}

/** a + b + carryIn (ADD, ADC, INC). */
export function add(a, b, carryIn, size) {
  const raw = a + b + carryIn;
  const result = raw & MASK[size];
  return {
    result,
    flags: {
      CF: raw > MASK[size], // unsigned overflow out of the top bit
      AF: ((a ^ b ^ result) & 0x10) !== 0, // carry out of bit 3 (used by BCD)
      OF: ((a ^ result) & (b ^ result) & SIGN[size]) !== 0, // signed overflow
      ...szp(result, size),
    },
  };
}

/** a - b - borrowIn (SUB, SBB, CMP, DEC, NEG). */
export function sub(a, b, borrowIn, size) {
  const raw = a - b - borrowIn;
  const result = raw & MASK[size];
  return {
    result,
    flags: {
      CF: raw < 0, // unsigned borrow
      AF: ((a ^ b ^ result) & 0x10) !== 0, // borrow into bit 4
      OF: ((a ^ b) & (a ^ result) & SIGN[size]) !== 0, // signed overflow
      ...szp(result, size),
    },
  };
}

/** AND, OR, XOR, TEST: CF and OF are cleared. AF is undefined on the 8086; this emulator clears it. */
export function logic(op, a, b, size) {
  let result;
  if (op === 'AND' || op === 'TEST') result = a & b;
  else if (op === 'OR') result = a | b;
  else result = a ^ b;
  result &= MASK[size];
  return { result, flags: { CF: false, OF: false, AF: false, ...szp(result, size) } };
}

/**
 * SHL/SAL, SHR, SAR by `count`.
 * CF = last bit shifted out. OF is only defined for count = 1 (otherwise left unchanged).
 * AF is undefined for shifts and is left unchanged. A count of 0 changes nothing.
 */
export function shift(op, value, count, size) {
  if (count === 0) return { result: value, flags: {} };
  const msb = SIGN[size];
  let v = value;
  let cf = false;
  // After size+1 shifts the result is stable, so the loop never needs more than 32 iterations.
  for (let i = 0; i < Math.min(count, 32); i++) {
    if (op === 'SHL') {
      cf = (v & msb) !== 0;
      v = (v << 1) & MASK[size];
    } else if (op === 'SHR') {
      cf = (v & 1) !== 0;
      v >>= 1;
    } else {
      cf = (v & 1) !== 0;
      v = (v >> 1) | (v & msb);
    }
  }
  const flags = { CF: cf, ...szp(v, size) };
  if (count === 1) {
    if (op === 'SHL') flags.OF = ((v & msb) !== 0) !== cf;
    else if (op === 'SHR') flags.OF = (value & msb) !== 0;
    else flags.OF = false;
  }
  return { result: v, flags };
}
